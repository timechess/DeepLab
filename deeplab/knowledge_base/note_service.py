import uuid
import re
from typing import Any

from tortoise.expressions import Q
from tortoise.functions import Count

from deeplab.model import (
    KnowledgeNote,
    KnowledgeNoteLink,
    KnowledgeQuestion,
    Paper,
    PaperReadingReport,
)

_NOTE_TARGET_TYPES = {"paper", "question", "note"}
_DEFAULT_NOTE_TITLE = "Untitled note"


def _normalize_plain_text(text: str) -> str:
    return " ".join(str(text).split()).strip()


def _normalize_target_type(value: Any) -> str | None:
    normalized = str(value or "").strip().lower()
    if normalized in _NOTE_TARGET_TYPES:
        return normalized
    return None


def _extract_plain_text_from_tiptap(node: Any) -> str:
    if isinstance(node, list):
        return " ".join(_extract_plain_text_from_tiptap(item) for item in node)
    if not isinstance(node, dict):
        return ""

    node_type = str(node.get("type") or "")
    if node_type == "text":
        return str(node.get("text") or "")

    content = node.get("content")
    child_text = _extract_plain_text_from_tiptap(content if isinstance(content, list) else [])
    if node_type in {"paragraph", "heading", "blockquote", "codeBlock", "listItem"}:
        return f"{child_text}\n"
    if node_type == "hardBreak":
        return "\n"
    return child_text


def _iter_tiptap_nodes(node: Any) -> list[dict[str, Any]]:
    if isinstance(node, list):
        result: list[dict[str, Any]] = []
        for item in node:
            result.extend(_iter_tiptap_nodes(item))
        return result

    if not isinstance(node, dict):
        return []

    result = [node]
    content = node.get("content")
    if isinstance(content, list):
        for item in content:
            result.extend(_iter_tiptap_nodes(item))
    return result


def _extract_mentions(content_json: dict[str, Any]) -> set[tuple[str, str, str | None]]:
    mentions: set[tuple[str, str, str | None]] = set()

    for node in _iter_tiptap_nodes(content_json):
        if str(node.get("type") or "") != "mention":
            continue
        attrs = node.get("attrs")
        if not isinstance(attrs, dict):
            continue

        target_type = _normalize_target_type(
            attrs.get("targetType") or attrs.get("target_type") or attrs.get("type")
        )
        target_id = str(attrs.get("targetId") or attrs.get("target_id") or attrs.get("id") or "").strip()
        if not target_id:
            continue

        if not target_type:
            parsed = re.match(r"^(paper|question|note):(.*)$", target_id, flags=re.IGNORECASE)
            if parsed:
                target_type = parsed.group(1).lower()
                target_id = parsed.group(2).strip()

        if not target_type or not target_id:
            continue

        label_value = (
            attrs.get("targetLabel")
            or attrs.get("target_label")
            or attrs.get("label")
            or attrs.get("text")
            or None
        )
        label = str(label_value).strip() if label_value is not None else None
        mentions.add((target_type, target_id, label or None))

    return mentions


def _normalize_content_json(content_json: dict[str, Any] | None) -> dict[str, Any]:
    if content_json is None:
        return {"type": "doc", "content": []}
    if not isinstance(content_json, dict):
        raise ValueError("contentJson 必须是对象。")
    if content_json.get("type") != "doc":
        return {"type": "doc", "content": [content_json]}
    return content_json


def _resolve_title(input_title: str | None, plain_text: str) -> str:
    title = str(input_title or "").strip()
    if title:
        return title
    if plain_text:
        return plain_text[:80]
    return _DEFAULT_NOTE_TITLE


def _to_excerpt(plain_text: str, max_len: int = 180) -> str:
    if len(plain_text) <= max_len:
        return plain_text
    return f"{plain_text[:max_len].rstrip()}..."


def _link_to_dict(
    link: KnowledgeNoteLink,
    *,
    paper_report_map: dict[str, str] | None = None,
) -> dict[str, Any]:
    payload = {
        "id": str(link.id),
        "sourceNoteId": str(link.source_note_id),
        "targetType": link.target_type,
        "targetId": link.target_id,
        "targetLabel": link.target_label,
        "createdAt": link.created_at.isoformat(),
    }
    if link.target_type == "paper":
        report_id = (paper_report_map or {}).get(link.target_id)
        payload["readingReportId"] = report_id
    return payload


def _incoming_link_to_dict(link: KnowledgeNoteLink) -> dict[str, Any]:
    source_note = link.source_note if hasattr(link, "source_note") else None
    payload = _link_to_dict(link)
    if source_note is not None:
        payload["sourceNoteTitle"] = source_note.title
        payload["sourceNoteUpdatedAt"] = source_note.updated_at.isoformat()
    return payload


def _note_summary_dict(
    note: KnowledgeNote,
    *,
    outgoing_link_count: int,
    incoming_link_count: int,
) -> dict[str, Any]:
    return {
        "id": str(note.id),
        "title": note.title,
        "excerpt": _to_excerpt(note.plain_text),
        "plainText": note.plain_text,
        "createdBy": note.created_by,
        "createdAt": note.created_at.isoformat(),
        "updatedAt": note.updated_at.isoformat(),
        "outgoingLinkCount": int(outgoing_link_count),
        "incomingLinkCount": int(incoming_link_count),
    }


async def _replace_note_links(
    note: KnowledgeNote,
    links: set[tuple[str, str, str | None]],
) -> None:
    await KnowledgeNoteLink.filter(source_note=note).delete()
    if not links:
        return
    await KnowledgeNoteLink.bulk_create(
        [
            KnowledgeNoteLink(
                source_note=note,
                target_type=target_type,
                target_id=target_id,
                target_label=target_label,
            )
            for target_type, target_id, target_label in sorted(links)
        ]
    )


async def _count_note_links(note_ids: list[uuid.UUID]) -> tuple[dict[str, int], dict[str, int]]:
    if not note_ids:
        return {}, {}

    note_id_strings = [str(item) for item in note_ids]
    outgoing_rows = (
        await KnowledgeNoteLink.filter(source_note_id__in=note_ids)
        .annotate(total=Count("id"))
        .group_by("source_note_id")
        .values("source_note_id", "total")
    )
    incoming_rows = (
        await KnowledgeNoteLink.filter(target_type="note", target_id__in=note_id_strings)
        .annotate(total=Count("id"))
        .group_by("target_id")
        .values("target_id", "total")
    )

    outgoing_map = {str(item["source_note_id"]): int(item["total"]) for item in outgoing_rows}
    incoming_map = {str(item["target_id"]): int(item["total"]) for item in incoming_rows}
    return outgoing_map, incoming_map


async def _build_paper_report_map(paper_ids: set[str]) -> dict[str, str]:
    clean_ids = sorted({str(item).strip() for item in paper_ids if str(item).strip()})
    if not clean_ids:
        return {}

    reports = (
        await PaperReadingReport.filter(paper_id__in=clean_ids, status="succeeded")
        .order_by("-created_at")
        .all()
    )
    payload: dict[str, str] = {}
    for report in reports:
        paper_id = str(report.paper_id).strip()
        if not paper_id or paper_id in payload:
            continue
        payload[paper_id] = str(report.id)
    return payload


async def list_knowledge_notes(
    *,
    search: str | None = None,
    limit: int = 20,
) -> list[dict[str, Any]]:
    safe_limit = min(max(limit, 1), 200)
    query = KnowledgeNote.all()
    keyword = (search or "").strip()
    if keyword:
        query = query.filter(Q(title__icontains=keyword) | Q(plain_text__icontains=keyword))

    notes = await query.order_by("-updated_at").limit(safe_limit)
    note_ids = [note.id for note in notes]
    outgoing_map, incoming_map = await _count_note_links(note_ids)

    return [
        _note_summary_dict(
            note,
            outgoing_link_count=outgoing_map.get(str(note.id), 0),
            incoming_link_count=incoming_map.get(str(note.id), 0),
        )
        for note in notes
    ]


async def create_knowledge_note(
    *,
    title: str | None = None,
    content_json: dict[str, Any] | None = None,
    created_by: str = "user",
) -> dict[str, Any]:
    normalized_content = _normalize_content_json(content_json)
    plain_text = _normalize_plain_text(_extract_plain_text_from_tiptap(normalized_content))
    resolved_title = _resolve_title(title, plain_text)

    note = await KnowledgeNote.create(
        title=resolved_title,
        content_json=normalized_content,
        plain_text=plain_text,
        created_by=(created_by or "user").strip() or "user",
    )
    await _replace_note_links(note, _extract_mentions(normalized_content))
    detail = await get_knowledge_note_detail(note.id)
    if detail is None:
        raise RuntimeError("创建笔记后读取详情失败。")
    return detail


async def get_knowledge_note_detail(note_id: uuid.UUID) -> dict[str, Any] | None:
    note = await KnowledgeNote.get_or_none(id=note_id)
    if note is None:
        return None

    outgoing_links = (
        await KnowledgeNoteLink.filter(source_note=note)
        .order_by("-created_at")
        .all()
    )
    incoming_links = (
        await KnowledgeNoteLink.filter(target_type="note", target_id=str(note.id))
        .select_related("source_note")
        .order_by("-created_at")
        .all()
    )
    paper_target_ids = {
        str(link.target_id).strip()
        for link in outgoing_links
        if link.target_type == "paper" and str(link.target_id).strip()
    }
    paper_report_map = await _build_paper_report_map(paper_target_ids)

    return {
        **_note_summary_dict(
            note,
            outgoing_link_count=len(outgoing_links),
            incoming_link_count=len(incoming_links),
        ),
        "contentJson": note.content_json if isinstance(note.content_json, dict) else {"type": "doc", "content": []},
        "outgoingLinks": [
            _link_to_dict(link, paper_report_map=paper_report_map) for link in outgoing_links
        ],
        "incomingLinks": [_incoming_link_to_dict(link) for link in incoming_links],
    }


async def update_knowledge_note(
    *,
    note_id: uuid.UUID,
    title: str | None = None,
    content_json: dict[str, Any] | None = None,
) -> dict[str, Any] | None:
    note = await KnowledgeNote.get_or_none(id=note_id)
    if note is None:
        return None

    update_fields: list[str] = []
    replace_links = False
    if content_json is not None:
        normalized_content = _normalize_content_json(content_json)
        note.content_json = normalized_content
        note.plain_text = _normalize_plain_text(_extract_plain_text_from_tiptap(normalized_content))
        update_fields.extend(["content_json", "plain_text"])
        replace_links = True

    if title is not None:
        note.title = _resolve_title(title, note.plain_text)
        update_fields.append("title")

    if not update_fields:
        raise ValueError("至少需要更新 title 或 contentJson。")

    if "title" not in update_fields:
        # Keep title non-empty even when content-only updates clear plain text.
        note.title = _resolve_title(note.title, note.plain_text)
        update_fields.append("title")

    await note.save(update_fields=[*update_fields, "updated_at"])
    if replace_links:
        await _replace_note_links(note, _extract_mentions(note.content_json))

    detail = await get_knowledge_note_detail(note.id)
    if detail is None:
        raise RuntimeError("更新笔记后读取详情失败。")
    return detail


async def delete_knowledge_note(*, note_id: uuid.UUID) -> dict[str, Any] | None:
    note = await KnowledgeNote.get_or_none(id=note_id)
    if note is None:
        return None

    deleted_outgoing = await KnowledgeNoteLink.filter(source_note=note).delete()
    deleted_incoming = await KnowledgeNoteLink.filter(target_type="note", target_id=str(note.id)).delete()
    deleted_notes = await KnowledgeNote.filter(id=note_id).delete()
    if deleted_notes == 0:
        return None

    return {
        "deleted": True,
        "noteId": str(note_id),
        "deletedOutgoingLinks": int(deleted_outgoing),
        "deletedIncomingLinks": int(deleted_incoming),
    }


async def search_knowledge_link_targets(
    *,
    target_type: str,
    q: str | None = None,
    limit: int = 20,
    exclude_note_id: str | None = None,
) -> list[dict[str, Any]]:
    normalized_type = _normalize_target_type(target_type)
    if normalized_type is None:
        raise ValueError("type 仅支持 paper/question/note。")

    safe_limit = min(max(limit, 1), 50)
    keyword = (q or "").strip()

    if normalized_type == "paper":
        query = Paper.all()
        if keyword:
            query = query.filter(Q(id__icontains=keyword) | Q(title__icontains=keyword))
        papers = await query.order_by("-collected_at").limit(safe_limit)
        return [
            {
                "type": "paper",
                "id": paper.id,
                "label": paper.title,
                "subtitle": paper.id,
            }
            for paper in papers
        ]

    if normalized_type == "question":
        query = KnowledgeQuestion.all()
        if keyword:
            query = query.filter(question__icontains=keyword)
        questions = await query.order_by("-updated_at").limit(safe_limit)
        return [
            {
                "type": "question",
                "id": str(question.id),
                "label": question.question,
                "subtitle": str(question.id),
            }
            for question in questions
        ]

    query = KnowledgeNote.all()
    if keyword:
        query = query.filter(Q(title__icontains=keyword) | Q(plain_text__icontains=keyword))
    notes = await query.order_by("-updated_at").limit(safe_limit * 2)

    payload: list[dict[str, Any]] = []
    for note in notes:
        note_id = str(note.id)
        if exclude_note_id and note_id == exclude_note_id:
            continue
        payload.append(
            {
                "type": "note",
                "id": note_id,
                "label": note.title,
                "subtitle": _to_excerpt(note.plain_text, max_len=96) or note_id,
            }
        )
        if len(payload) >= safe_limit:
            break
    return payload
