import asyncio
import json
import logging
import re
from datetime import UTC, date, datetime
import xml.etree.ElementTree as ET
from typing import Any
from urllib.parse import quote
from urllib import request

from deeplab.model import Paper

DAILY_PAPERS_URL = "https://huggingface.co/api/daily_papers"
PAPER_DETAIL_URL_TEMPLATE = "https://huggingface.co/api/papers/{paper_id}"
ARXIV_API_QUERY_URL_TEMPLATE = "https://export.arxiv.org/api/query?id_list={paper_id}"
REQUEST_TIMEOUT_SECONDS = 30
ARXIV_ATOM_NAMESPACE = {"atom": "http://www.w3.org/2005/Atom"}

logger = logging.getLogger(__name__)


def fetch_daily_papers_payload(
    url: str = DAILY_PAPERS_URL,
    timeout_seconds: int = REQUEST_TIMEOUT_SECONDS,
) -> Any:
    req = request.Request(url=url, method="GET")
    with request.urlopen(req, timeout=timeout_seconds) as response:
        status = getattr(response, "status", response.getcode())
        if status != 200:
            raise RuntimeError(f"Failed to fetch daily papers: HTTP {status}")

        body = response.read().decode("utf-8")
        return json.loads(body)


def _build_paper_detail_url(paper_id: str) -> str:
    return PAPER_DETAIL_URL_TEMPLATE.format(paper_id=quote(paper_id, safe=""))


def _build_arxiv_api_query_url(paper_id: str) -> str:
    return ARXIV_API_QUERY_URL_TEMPLATE.format(paper_id=quote(paper_id, safe=""))


def fetch_paper_payload(
    paper_id: str,
    timeout_seconds: int = REQUEST_TIMEOUT_SECONDS,
) -> Any:
    req = request.Request(url=_build_paper_detail_url(paper_id), method="GET")
    with request.urlopen(req, timeout=timeout_seconds) as response:
        status = getattr(response, "status", response.getcode())
        if status != 200:
            raise RuntimeError(f"Failed to fetch paper {paper_id}: HTTP {status}")

        body = response.read().decode("utf-8")
        return json.loads(body)


def fetch_arxiv_paper_payload(
    paper_id: str,
    timeout_seconds: int = REQUEST_TIMEOUT_SECONDS,
) -> str:
    req = request.Request(
        url=_build_arxiv_api_query_url(paper_id),
        method="GET",
        headers={"User-Agent": "DeepLab/0.1 (paper-collection)"},
    )
    with request.urlopen(req, timeout=timeout_seconds) as response:
        status = getattr(response, "status", response.getcode())
        if status != 200:
            raise RuntimeError(f"Failed to fetch arXiv paper {paper_id}: HTTP {status}")

        return response.read().decode("utf-8")


def _normalize_text(value: Any) -> str:
    text = str(value or "")
    return re.sub(r"\s+", " ", text).strip()


def _extract_arxiv_id_from_atom_id(value: str) -> str | None:
    raw = str(value or "").strip()
    if not raw:
        return None
    match = re.search(r"/(?:abs|pdf)/([^?#]+)", raw, flags=re.IGNORECASE)
    if not match:
        return None
    paper_id = match.group(1).strip().strip("/")
    if paper_id.lower().endswith(".pdf"):
        paper_id = paper_id[:-4]
    return paper_id or None


def _extract_author_names(raw_authors: Any) -> list[str]:
    if not isinstance(raw_authors, list):
        raw_authors = [raw_authors]

    names: list[str] = []
    for author in raw_authors:
        if isinstance(author, dict):
            name = str(author.get("name", "")).strip()
        else:
            name = str(author or "").strip()
        if name:
            names.append(name)
    return names


def _extract_organization_name(raw_organization: Any) -> str:
    if isinstance(raw_organization, dict):
        return str(raw_organization.get("name", "")).strip()
    return str(raw_organization or "").strip()


def _process_paper(paper: dict) -> dict[str, Any]:
    return {
        "id": paper.get("id", ""),
        "title": paper.get("title", ""),
        "authors": _extract_author_names(paper.get("authors", [])),
        "organization": _extract_organization_name(paper.get("organization")),
        "summary": paper.get("summary", ""),
        "ai_summary": paper.get("ai_summary", ""),
        "ai_keywords": paper.get("ai_keywords", []),
        "upvotes": paper.get("upvotes", 0),
        "githubRepo": paper.get("githubRepo", ""),
        "githubStars": paper.get("githubStars", 0),
        "publishedAt": paper.get("publishedAt", "")
    }

def parse_daily_papers_payload(payload: Any) -> list[dict[str, Any]]:
    return [_process_paper(item["paper"]) for item in payload]


def parse_paper_payload(payload: Any) -> dict[str, Any]:
    if not isinstance(payload, dict):
        raise ValueError("paper payload must be a dict")
    paper_raw = payload.get("paper")
    if isinstance(paper_raw, dict):
        return _process_paper(paper_raw)

    # 部分接口直接返回与 daily_papers 的 item["paper"] 同构对象。
    if "id" in payload and "title" in payload:
        return _process_paper(payload)

    raise ValueError("paper payload missing paper metadata")


def parse_arxiv_paper_payload(
    payload: str,
    *,
    requested_paper_id: str,
) -> dict[str, Any]:
    try:
        root = ET.fromstring(payload)
    except ET.ParseError as exc:
        raise ValueError("arXiv API 返回格式无效，无法解析 XML。") from exc

    entries = root.findall("atom:entry", ARXIV_ATOM_NAMESPACE)
    if not entries:
        raise ValueError(f"未在 arXiv API 找到论文元数据: {requested_paper_id}")

    entry = entries[0]
    entry_id_text = entry.findtext("atom:id", default="", namespaces=ARXIV_ATOM_NAMESPACE)
    normalized_id = _extract_arxiv_id_from_atom_id(entry_id_text) or requested_paper_id

    authors = [
        _normalize_text(node.text or "")
        for node in entry.findall("atom:author/atom:name", ARXIV_ATOM_NAMESPACE)
        if _normalize_text(node.text or "")
    ]
    categories = [
        _normalize_text(node.attrib.get("term") or "")
        for node in entry.findall("atom:category", ARXIV_ATOM_NAMESPACE)
        if _normalize_text(node.attrib.get("term") or "")
    ]

    return _process_paper(
        {
            "id": normalized_id,
            "title": _normalize_text(
                entry.findtext("atom:title", default="", namespaces=ARXIV_ATOM_NAMESPACE)
            ),
            "authors": authors,
            "organization": None,
            "summary": _normalize_text(
                entry.findtext("atom:summary", default="", namespaces=ARXIV_ATOM_NAMESPACE)
            ),
            "ai_summary": None,
            "ai_keywords": categories,
            "upvotes": 0,
            "githubRepo": None,
            "githubStars": None,
            "publishedAt": _normalize_text(
                entry.findtext("atom:published", default="", namespaces=ARXIV_ATOM_NAMESPACE)
            ),
        }
    )


def _parse_datetime(value: Any) -> datetime:
    if isinstance(value, datetime):
        dt = value
    elif isinstance(value, date):
        dt = datetime(value.year, value.month, value.day, tzinfo=UTC)
    elif isinstance(value, str):
        raw = value.strip()
        if not raw:
            raise ValueError("publishedAt is empty")
        if raw.endswith("Z"):
            raw = raw[:-1] + "+00:00"
        try:
            dt = datetime.fromisoformat(raw)
        except ValueError as exc:
            raise ValueError(f"Invalid publishedAt: {value}") from exc
    else:
        raise ValueError(f"Unsupported publishedAt type: {type(value)!r}")

    if dt.tzinfo is None:
        return dt.replace(tzinfo=UTC)
    return dt.astimezone(UTC)


def _to_list(value: Any) -> list[Any]:
    if value is None:
        return []
    if isinstance(value, list):
        return value
    if isinstance(value, tuple):
        return list(value)
    return [value]


def _to_optional_text(value: Any) -> str | None:
    if value is None:
        return None
    text = str(value).strip()
    return text or None


def _to_int(value: Any, default: int = 0) -> int:
    if value is None:
        return default
    if isinstance(value, bool):
        return int(value)
    if isinstance(value, (int, float)):
        return int(value)
    text = str(value).strip()
    if not text:
        return default
    return int(text)


def _to_optional_int(value: Any) -> int | None:
    if value is None:
        return None
    return _to_int(value)


def _normalize_paper(item: dict[str, Any]) -> dict[str, Any]:
    paper_id = str(item.get("id", "")).strip()
    title = str(item.get("title", "")).strip()
    summary = str(item.get("summary", "")).strip()

    if not paper_id:
        raise ValueError("missing id")
    if not title:
        raise ValueError(f"paper {paper_id} missing title")
    if not summary:
        raise ValueError(f"paper {paper_id} missing summary")
    if "publishedAt" not in item:
        raise ValueError(f"paper {paper_id} missing publishedAt")

    return {
        "id": paper_id,
        "title": title,
        "authors": _to_list(item.get("authors")),
        "organization": _to_optional_text(item.get("organization")),
        "summary": summary,
        "ai_summary": _to_optional_text(item.get("ai_summary")),
        "ai_keywords": _to_list(item.get("ai_keywords")),
        "upvotes": _to_int(item.get("upvotes"), default=0),
        "github_repo": _to_optional_text(item.get("githubRepo")),
        "github_stars": _to_optional_int(item.get("githubStars")),
        "published_at": _parse_datetime(item.get("publishedAt")),
    }


async def collect_and_persist_papers() -> list[dict[str, str]]:
    payload = await asyncio.to_thread(fetch_daily_papers_payload)
    parsed_items = parse_daily_papers_payload(payload)

    if not isinstance(parsed_items, list):
        raise ValueError("parse_daily_papers_payload must return a list.")

    collected: list[dict[str, str]] = []
    for idx, item in enumerate(parsed_items):
        if not isinstance(item, dict):
            logger.warning("Skip non-dict paper item at index %s", idx)
            continue
        try:
            normalized = _normalize_paper(item)
        except Exception:
            logger.exception("Skip invalid paper item at index %s", idx)
            continue
        paper_id = normalized.pop("id")
        paper, _ = await Paper.update_or_create(id=paper_id, defaults=normalized)
        collected.append({"id": paper.id, "title": paper.title})

    return collected


async def collect_and_persist_paper_by_id(paper_id: str) -> dict[str, str]:
    normalized_id = str(paper_id).strip()
    if not normalized_id:
        raise ValueError("paper_id 不能为空。")

    payload = await asyncio.to_thread(fetch_paper_payload, normalized_id)
    parsed_item = parse_paper_payload(payload)
    normalized = _normalize_paper(parsed_item)

    persisted_id = normalized.pop("id")
    paper, _ = await Paper.update_or_create(id=persisted_id, defaults=normalized)
    return {"id": paper.id, "title": paper.title}


async def collect_and_persist_paper_by_arxiv_id(paper_id: str) -> dict[str, str]:
    normalized_id = str(paper_id).strip()
    if not normalized_id:
        raise ValueError("paper_id 不能为空。")

    payload = await asyncio.to_thread(fetch_arxiv_paper_payload, normalized_id)
    parsed_item = parse_arxiv_paper_payload(payload, requested_paper_id=normalized_id)
    normalized = _normalize_paper(parsed_item)

    persisted_id = normalized.pop("id")
    paper, _ = await Paper.update_or_create(id=persisted_id, defaults=normalized)
    return {"id": paper.id, "title": paper.title}
