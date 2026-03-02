import hashlib
import os
import threading
import time
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import numpy as np

DEFAULT_EMBEDDING_MODEL = os.getenv(
    "KNOWLEDGE_EMBEDDING_MODEL",
    "BAAI/bge-small-en-v1.5",
)
EMBEDDING_CACHE_PATH = os.getenv("FASTEMBED_CACHE_PATH")

_CURRENT_EMBEDDING_MODEL = DEFAULT_EMBEDDING_MODEL
_EMBEDDER: Any | None = None
_EMBEDDER_MODEL_NAME: str | None = None
_STATE_LOCK = threading.Lock()


def get_embedding_cache_root() -> Path:
    return Path(EMBEDDING_CACHE_PATH or "/tmp/deeplab-fastembed-cache")


def _now_iso() -> str:
    return datetime.now(tz=UTC).isoformat()


def _normalize_model_name(model_name: str) -> str:
    normalized = str(model_name).strip()
    if not normalized:
        raise ValueError("embedding 模型名不能为空。")
    return normalized


def _marker_file_path(model_name: str | None = None) -> Path:
    digest_source = _normalize_model_name(model_name or _CURRENT_EMBEDDING_MODEL)
    digest = hashlib.sha1(digest_source.encode("utf-8")).hexdigest()[:16]
    root = get_embedding_cache_root()
    return root / f".deeplab_model_ready_{digest}.marker"


def _is_marked_downloaded(model_name: str | None = None) -> bool:
    return _marker_file_path(model_name).exists()


def _base_state_for_model(model_name: str) -> dict[str, Any]:
    downloaded = _is_marked_downloaded(model_name)
    return {
        "modelName": model_name,
        "downloaded": downloaded,
        "downloading": False,
        "progress": 100 if downloaded else 0,
        "message": "模型已就绪。" if downloaded else "模型未下载。",
        "error": None,
        "updatedAt": _now_iso(),
    }


_DOWNLOAD_STATE: dict[str, Any] = _base_state_for_model(_CURRENT_EMBEDDING_MODEL)


def get_embedding_model_name() -> str:
    with _STATE_LOCK:
        return _CURRENT_EMBEDDING_MODEL


def set_embedding_model_name(model_name: str) -> dict[str, Any]:
    global _CURRENT_EMBEDDING_MODEL
    global _EMBEDDER
    global _EMBEDDER_MODEL_NAME

    normalized = _normalize_model_name(model_name)
    with _STATE_LOCK:
        current_model = _CURRENT_EMBEDDING_MODEL
        if normalized == current_model:
            current_state_model = str(_DOWNLOAD_STATE.get("modelName", "")).strip()
            if not current_state_model:
                _DOWNLOAD_STATE.clear()
                _DOWNLOAD_STATE.update(_base_state_for_model(current_model))
            return dict(_DOWNLOAD_STATE)

        if _DOWNLOAD_STATE.get("downloading"):
            raise ValueError("embedding 模型下载中，暂不支持切换模型。")

        _CURRENT_EMBEDDING_MODEL = normalized
        _EMBEDDER = None
        _EMBEDDER_MODEL_NAME = None

        _DOWNLOAD_STATE.clear()
        _DOWNLOAD_STATE.update(_base_state_for_model(normalized))
        return dict(_DOWNLOAD_STATE)


async def sync_embedding_model_from_runtime_settings() -> str:
    from deeplab.runtime_settings import (
        DEFAULT_KNOWLEDGE_EMBEDDING_MODEL,
        KNOWLEDGE_EMBEDDING_MODEL_ENV_KEYS,
        resolve_setting_value,
    )

    configured = await resolve_setting_value(
        key="knowledge_embedding_model",
        env_keys=KNOWLEDGE_EMBEDDING_MODEL_ENV_KEYS,
        default=DEFAULT_KNOWLEDGE_EMBEDDING_MODEL,
    )
    set_embedding_model_name(configured or DEFAULT_KNOWLEDGE_EMBEDDING_MODEL)
    return get_embedding_model_name()


def get_embedding_download_status() -> dict[str, Any]:
    with _STATE_LOCK:
        current_model = _CURRENT_EMBEDDING_MODEL
        current_state_model = str(_DOWNLOAD_STATE.get("modelName", "")).strip()
        if (
            not _DOWNLOAD_STATE.get("downloading")
            or current_state_model != current_model
        ):
            _DOWNLOAD_STATE.clear()
            _DOWNLOAD_STATE.update(_base_state_for_model(current_model))
        return dict(_DOWNLOAD_STATE)


def is_embedding_model_ready() -> bool:
    model_name = get_embedding_model_name()
    return _is_marked_downloaded(model_name)


def assert_embedding_model_ready() -> None:
    model_name = get_embedding_model_name()
    if not _is_marked_downloaded(model_name):
        raise ValueError(
            f"本地 embedding 模型尚未下载（当前：{model_name}），请先到系统设置页面完成下载。"
        )


def _mark_downloaded(model_name: str) -> None:
    marker = _marker_file_path(model_name)
    marker.parent.mkdir(parents=True, exist_ok=True)
    marker.write_text(f"{model_name}\n", encoding="utf-8")


def _create_embedder(model_name: str) -> Any:
    try:
        from fastembed import TextEmbedding
    except ModuleNotFoundError as exc:
        raise RuntimeError(
            "缺少 fastembed 依赖，请安装后重试（例如: uv add fastembed faiss-cpu）。"
        ) from exc

    kwargs: dict[str, Any] = {"model_name": model_name}
    if EMBEDDING_CACHE_PATH:
        kwargs["cache_dir"] = EMBEDDING_CACHE_PATH
    return TextEmbedding(**kwargs)


def _get_embedder() -> Any:
    global _EMBEDDER
    global _EMBEDDER_MODEL_NAME

    with _STATE_LOCK:
        model_name = _CURRENT_EMBEDDING_MODEL
        if _EMBEDDER is not None and _EMBEDDER_MODEL_NAME == model_name:
            return _EMBEDDER

    embedder = _create_embedder(model_name)
    with _STATE_LOCK:
        if _CURRENT_EMBEDDING_MODEL != model_name:
            # 模型在创建过程中被切换，使用最新模型重新加载。
            latest_model = _CURRENT_EMBEDDING_MODEL
            if _EMBEDDER is not None and _EMBEDDER_MODEL_NAME == latest_model:
                return _EMBEDDER
            embedder = _create_embedder(latest_model)
            model_name = latest_model

        _EMBEDDER = embedder
        _EMBEDDER_MODEL_NAME = model_name
        return _EMBEDDER


def _normalize_vector(vector: np.ndarray) -> list[float]:
    vec = np.asarray(vector, dtype=np.float32).reshape(-1)
    norm = float(np.linalg.norm(vec))
    if norm <= 0:
        raise ValueError("embedding 向量范数为 0，无法归一化。")
    normalized = vec / norm
    return [float(x) for x in normalized.tolist()]


def _progress_ticker(stop_event: threading.Event, model_name: str) -> None:
    while not stop_event.is_set():
        time.sleep(0.6)
        with _STATE_LOCK:
            if (
                not _DOWNLOAD_STATE.get("downloading")
                or str(_DOWNLOAD_STATE.get("modelName", "")) != model_name
            ):
                break
            current = int(_DOWNLOAD_STATE.get("progress", 0))
            if current < 95:
                _DOWNLOAD_STATE["progress"] = min(95, current + 2)
            _DOWNLOAD_STATE["updatedAt"] = _now_iso()


def _download_worker(model_name: str) -> None:
    ticker_stop = threading.Event()
    ticker = threading.Thread(
        target=_progress_ticker,
        args=(ticker_stop, model_name),
        daemon=True,
    )
    ticker.start()
    try:
        with _STATE_LOCK:
            _DOWNLOAD_STATE.update(
                {
                    "modelName": model_name,
                    "downloading": True,
                    "downloaded": False,
                    "progress": 3,
                    "message": "开始下载 embedding 模型...",
                    "error": None,
                    "updatedAt": _now_iso(),
                }
            )

        embedder = _create_embedder(model_name)
        with _STATE_LOCK:
            if str(_DOWNLOAD_STATE.get("modelName", "")) == model_name:
                _DOWNLOAD_STATE.update(
                    {
                        "progress": 60,
                        "message": "模型下载中，正在初始化...",
                        "updatedAt": _now_iso(),
                    }
                )
        vectors = list(embedder.embed(["deeplab embedding warmup"]))
        if not vectors:
            raise RuntimeError("模型初始化失败：embedding 输出为空。")

        _mark_downloaded(model_name)

        with _STATE_LOCK:
            if _CURRENT_EMBEDDING_MODEL == model_name:
                global _EMBEDDER
                global _EMBEDDER_MODEL_NAME
                _EMBEDDER = embedder
                _EMBEDDER_MODEL_NAME = model_name
            if str(_DOWNLOAD_STATE.get("modelName", "")) == model_name:
                _DOWNLOAD_STATE.update(
                    {
                        "downloading": False,
                        "downloaded": True,
                        "progress": 100,
                        "message": "模型下载完成。",
                        "error": None,
                        "updatedAt": _now_iso(),
                    }
                )
    except Exception as exc:
        with _STATE_LOCK:
            if str(_DOWNLOAD_STATE.get("modelName", "")) == model_name:
                _DOWNLOAD_STATE.update(
                    {
                        "downloading": False,
                        "downloaded": _is_marked_downloaded(model_name),
                        "progress": 100 if _is_marked_downloaded(model_name) else 0,
                        "message": "模型下载失败。",
                        "error": str(exc),
                        "updatedAt": _now_iso(),
                    }
                )
    finally:
        ticker_stop.set()


def start_embedding_download() -> dict[str, Any]:
    with _STATE_LOCK:
        model_name = _CURRENT_EMBEDDING_MODEL
        if _DOWNLOAD_STATE.get("downloading"):
            return dict(_DOWNLOAD_STATE)
        if _is_marked_downloaded(model_name):
            _DOWNLOAD_STATE.clear()
            _DOWNLOAD_STATE.update(_base_state_for_model(model_name))
            _DOWNLOAD_STATE["message"] = "模型已就绪，无需重复下载。"
            _DOWNLOAD_STATE["updatedAt"] = _now_iso()
            return dict(_DOWNLOAD_STATE)

        _DOWNLOAD_STATE.update(
            {
                "modelName": model_name,
                "downloading": True,
                "downloaded": False,
                "progress": 1,
                "message": "已创建下载任务。",
                "error": None,
                "updatedAt": _now_iso(),
            }
        )

    threading.Thread(target=_download_worker, args=(model_name,), daemon=True).start()
    return get_embedding_download_status()


def encode_texts(texts: list[str]) -> list[list[float]]:
    assert_embedding_model_ready()
    clean_texts = [text.strip() for text in texts if text and text.strip()]
    if not clean_texts:
        return []

    embedder = _get_embedder()
    vectors = list(embedder.embed(clean_texts))
    return [_normalize_vector(vec) for vec in vectors]


def encode_text(text: str) -> list[float]:
    vectors = encode_texts([text])
    if not vectors:
        raise ValueError("输入文本为空，无法生成 embedding。")
    return vectors[0]
