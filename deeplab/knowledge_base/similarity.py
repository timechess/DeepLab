import hashlib
import json
import os
import threading
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import numpy as np

from deeplab.knowledge_base.embedding import (
    get_embedding_cache_root,
    get_embedding_model_name,
)

_INDEX_LOCK = threading.Lock()


def _load_faiss() -> Any:
    try:
        import faiss
    except ModuleNotFoundError as exc:
        raise RuntimeError(
            "缺少 faiss-cpu 依赖，请安装后重试（例如: uv add faiss-cpu）。"
        ) from exc
    return faiss


def _index_paths() -> tuple[Path, Path]:
    model_name = get_embedding_model_name()
    digest = hashlib.sha1(model_name.encode("utf-8")).hexdigest()[:16]
    root = get_embedding_cache_root()
    return (
        root / f".deeplab_question_index_{digest}.faiss",
        root / f".deeplab_question_index_{digest}.meta.json",
    )


def _now_iso() -> str:
    return datetime.now(tz=UTC).isoformat()


def _normalize_questions_for_index(
    questions: list[dict[str, Any]],
    *,
    expected_dim: int | None = None,
) -> tuple[list[dict[str, Any]], int]:
    valid: list[dict[str, Any]] = []
    dim = expected_dim
    for item in questions:
        embedding = item.get("embedding")
        if not isinstance(embedding, list):
            continue
        if dim is None:
            if len(embedding) == 0:
                continue
            dim = len(embedding)
        if len(embedding) != dim:
            continue
        question_id = str(item.get("id", "")).strip()
        question_text = str(item.get("question", "")).strip()
        if not question_id or not question_text:
            continue
        try:
            vector = [float(value) for value in embedding]
        except (TypeError, ValueError):
            continue
        valid.append(
            {
                "id": question_id,
                "question": question_text,
                "embedding": vector,
            }
        )
    return valid, int(dim or 0)


def _questions_signature(valid_questions: list[dict[str, Any]]) -> str:
    hasher = hashlib.sha1()
    for item in valid_questions:
        hasher.update(str(item["id"]).encode("utf-8"))
        hasher.update(b"\x1f")
        hasher.update(str(item["question"]).encode("utf-8"))
        hasher.update(b"\x1f")
        vector = np.asarray(item["embedding"], dtype=np.float32)
        hasher.update(vector.tobytes())
        hasher.update(b"\x1e")
    return hasher.hexdigest()


def _write_text_atomic(path: Path, content: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temp_path = path.with_name(f"{path.name}.tmp")
    temp_path.write_text(content, encoding="utf-8")
    os.replace(temp_path, path)


def _write_json_atomic(path: Path, payload: dict[str, Any]) -> None:
    serialized = json.dumps(payload, ensure_ascii=False, indent=2)
    _write_text_atomic(path, serialized)


def _persist_index_locked(
    *,
    valid_questions: list[dict[str, Any]],
    dim: int,
) -> dict[str, Any]:
    index_path, meta_path = _index_paths()
    model_name = get_embedding_model_name()
    signature = _questions_signature(valid_questions)
    metadata: dict[str, Any] = {
        "modelName": model_name,
        "dim": dim if valid_questions else 0,
        "total": len(valid_questions),
        "signature": signature,
        "updatedAt": _now_iso(),
        "items": [
            {"id": item["id"], "question": item["question"]}
            for item in valid_questions
        ],
    }

    if not valid_questions:
        if index_path.exists():
            index_path.unlink()
        _write_json_atomic(meta_path, metadata)
        return metadata

    matrix = np.asarray([item["embedding"] for item in valid_questions], dtype=np.float32)
    faiss = _load_faiss()
    index = faiss.IndexFlatIP(dim)
    index.add(matrix)

    index_path.parent.mkdir(parents=True, exist_ok=True)
    temp_index_path = index_path.with_name(f"{index_path.name}.tmp")
    faiss.write_index(index, str(temp_index_path))
    os.replace(temp_index_path, index_path)
    _write_json_atomic(meta_path, metadata)
    return metadata


def rebuild_persistent_question_index(questions: list[dict[str, Any]]) -> dict[str, Any]:
    valid_questions, dim = _normalize_questions_for_index(questions)
    with _INDEX_LOCK:
        metadata = _persist_index_locked(
            valid_questions=valid_questions,
            dim=dim,
        )
        index_path, meta_path = _index_paths()
        return {
            "modelName": metadata["modelName"],
            "dim": int(metadata["dim"]),
            "total": int(metadata["total"]),
            "updatedAt": str(metadata["updatedAt"]),
            "indexPath": str(index_path),
            "metadataPath": str(meta_path),
        }


def _load_index_bundle_locked(
    *,
    expected_dim: int,
) -> dict[str, Any] | None:
    index_path, meta_path = _index_paths()
    if not meta_path.exists():
        return None

    try:
        raw_meta = json.loads(meta_path.read_text(encoding="utf-8"))
    except Exception:
        return None
    if not isinstance(raw_meta, dict):
        return None

    raw_items = raw_meta.get("items")
    if not isinstance(raw_items, list):
        return None

    items: list[dict[str, str]] = []
    for raw_item in raw_items:
        if not isinstance(raw_item, dict):
            continue
        question_id = str(raw_item.get("id", "")).strip()
        question_text = str(raw_item.get("question", "")).strip()
        if not question_id or not question_text:
            continue
        items.append({"id": question_id, "question": question_text})
    signature = str(raw_meta.get("signature", "")).strip()
    if not signature:
        return None

    if not items:
        return {"index": None, "items": [], "signature": signature}
    if not index_path.exists():
        return None

    faiss = _load_faiss()
    try:
        index = faiss.read_index(str(index_path))
    except Exception:
        return None
    if int(index.ntotal) != len(items):
        return None
    if int(index.d) != expected_dim:
        return None

    return {"index": index, "items": items, "signature": signature}


def search_similar_questions(
    *,
    query_embeddings: list[list[float]],
    questions: list[dict[str, Any]],
    top_k: int,
) -> list[list[dict[str, Any]]]:
    if not query_embeddings:
        return []

    dim = len(query_embeddings[0])
    if dim <= 0:
        return [[] for _ in query_embeddings]
    for embedding in query_embeddings:
        if len(embedding) != dim:
            raise ValueError("query_embeddings 维度不一致，无法执行 Faiss 检索。")
    valid_questions, _ = _normalize_questions_for_index(
        questions,
        expected_dim=dim,
    )
    expected_signature = _questions_signature(valid_questions)

    queries = np.asarray(query_embeddings, dtype=np.float32)

    with _INDEX_LOCK:
        bundle = _load_index_bundle_locked(expected_dim=dim)
        if bundle is None or str(bundle.get("signature", "")) != expected_signature:
            _persist_index_locked(valid_questions=valid_questions, dim=dim)
            bundle = _load_index_bundle_locked(expected_dim=dim)
            if bundle is None:
                raise RuntimeError("Faiss 持久化索引加载失败。")

        index = bundle.get("index")
        items = bundle.get("items", [])
        if index is None or not isinstance(items, list) or not items:
            return [[] for _ in query_embeddings]

        result_top_k = min(max(top_k, 1), len(items))
        scores, indices = index.search(queries, result_top_k)

    merged: list[list[dict[str, Any]]] = []
    for row_scores, row_indices in zip(scores.tolist(), indices.tolist(), strict=True):
        row: list[dict[str, Any]] = []
        for score, idx in zip(row_scores, row_indices, strict=True):
            if idx < 0 or idx >= len(items):
                continue
            question = items[idx]
            row.append(
                {
                    "id": str(question["id"]),
                    "question": str(question["question"]),
                    "score": float(score),
                }
            )
        merged.append(row)
    return merged
