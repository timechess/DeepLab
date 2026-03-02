import asyncio
import json
import logging
from datetime import UTC, date, datetime
from typing import Any
from urllib import request

from deeplab.model import Paper

DAILY_PAPERS_URL = "https://huggingface.co/api/daily_papers"
REQUEST_TIMEOUT_SECONDS = 30

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


def _process_paper(paper: dict) -> dict[str, Any]:
    return {
        "id": paper.get("id", ""),
        "title": paper.get("title", ""),
        "authors": [author.get("name", "") for author in paper.get("authors", [])],
        "organization": paper.get("organization", {}).get("name", ""),
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
