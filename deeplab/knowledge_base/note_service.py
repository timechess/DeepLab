import uuid
import re
from datetime import datetime
from typing import Any

from deeplab.db.query import Q
from deeplab.knowledge_base.note_sync import (
    count_note_links,
    create_or_update_note,
    delete_note,
    get_note,
    list_incoming_note_links,
    list_links_for_source,
    list_notes,
    replace_note_links as replace_note_links_local,
    search_note_targets,
)

from deeplab.model import (
    DailyWorkNoteSnapshot,
    KnowledgeNote,
    KnowledgeNoteLink,
    KnowledgeQuestion,
    Paper,
    PaperReadingReport,
    TodoTask,
)

_NOTE_TARGET_TYPES = {"paper", "question", "note", "task"}
_DEFAULT_NOTE_TITLE = "Untitled note"
_ARXIV_PAPER_ID_PATTERN = re.compile(
    r"^(?:\d{4}\.\d{4,5}|[a-z\-]+(?:\.[a-z\-]+)?/\d{7})(?:v\d+)?$",
    flags=re.IGNORECASE,
)
_ARXIV_VERSION_SUFFIX_PATTERN = re.compile(r"v\d+$", flags=re.IGNORECASE)


def _normalize_plain_text(text: str) -> str:
    return " ".join(str(text).split()).strip()


def _normalize_target_type(value: Any) -> str | None:
    normalized = str(value or "").strip().lower()
    if normalized in _NOTE_TARGET_TYPES:
        return normalized
    return None


def _is_probably_arxiv_paper_id(value: str) -> bool:
    return bool(_ARXIV_PAPER_ID_PATTERN.match(str(value or "").strip()))


def _normalize_paper_target_id(value: str) -> str:
    text = str(value or "").strip()
    if not text:
        return ""

    if text.lower().startswith("paper:"):
        text = text.split(":", 1)[1].strip()

    text = re.sub(r"^arxiv\s*:\s*", "", text, flags=re.IGNORECASE).strip()
    text = text.replace("http://", "https://", 1)

    match = re.search(r"arxiv\.org/(?:abs|pdf)/([^?#]+)", text, flags=re.IGNORECASE)
    if match:
        text = match.group(1)

    text = text.strip().strip("/")
    if text.lower().endswith(".pdf"):
        text = text[:-4]
    text = re.sub(r"^(?:abs|pdf)/", "", text, flags=re.IGNORECASE).strip()
    if not text:
        return ""

    if _is_probably_arxiv_paper_id(text):
        text = _ARXIV_VERSION_SUFFIX_PATTERN.sub("", text).strip()
    return text


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
            parsed = re.match(r"^(paper|question|note|task):(.*)$", target_id, flags=re.IGNORECASE)
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


def _safe_tiptap_children(node: dict[str, Any]) -> list[dict[str, Any]]:
    content = node.get("content")
    if not isinstance(content, list):
        return []
    return [item for item in content if isinstance(item, dict)]


def _extract_raw_text_from_tiptap(node: Any) -> str:
    if isinstance(node, list):
        return "".join(_extract_raw_text_from_tiptap(item) for item in node)
    if not isinstance(node, dict):
        return ""

    node_type = str(node.get("type") or "")
    if node_type == "text":
        return str(node.get("text") or "")
    if node_type == "hardBreak":
        return "\n"
    return _extract_raw_text_from_tiptap(_safe_tiptap_children(node))


def _escape_markdown_text(text: str) -> str:
    return (
        str(text)
        .replace("\\", "\\\\")
        .replace("`", "\\`")
        .replace("*", "\\*")
        .replace("_", "\\_")
        .replace("[", "\\[")
        .replace("]", "\\]")
    )


def _apply_markdown_marks(text: str, marks: Any) -> str:
    if not isinstance(marks, list):
        return text

    rendered = text
    for mark in marks:
        if not isinstance(mark, dict):
            continue
        mark_type = str(mark.get("type") or "")
        attrs = mark.get("attrs")

        if mark_type == "bold":
            rendered = f"**{rendered}**"
            continue
        if mark_type == "italic":
            rendered = f"*{rendered}*"
            continue
        if mark_type == "strike":
            rendered = f"~~{rendered}~~"
            continue
        if mark_type == "code":
            escaped_code = rendered.replace("`", "\\`")
            rendered = f"`{escaped_code}`"
            continue
        if mark_type == "link" and isinstance(attrs, dict):
            href = str(attrs.get("href") or "").strip()
            if href:
                rendered = f"[{rendered}]({href})"
    return rendered


def _math_text_from_node(node: dict[str, Any]) -> str:
    attrs = node.get("attrs")
    if isinstance(attrs, dict):
        for key in ("latex", "text", "formula", "value"):
            value = str(attrs.get(key) or "").strip()
            if value:
                return value
    return _extract_raw_text_from_tiptap(_safe_tiptap_children(node)).strip()


def _render_markdown_inline(node: dict[str, Any]) -> str:
    node_type = str(node.get("type") or "")
    if node_type == "text":
        text = _escape_markdown_text(str(node.get("text") or ""))
        return _apply_markdown_marks(text, node.get("marks"))

    if node_type == "hardBreak":
        return "  \n"

    if node_type == "mention":
        attrs = node.get("attrs")
        if not isinstance(attrs, dict):
            return ""
        label = str(
            attrs.get("targetLabel")
            or attrs.get("target_label")
            or attrs.get("label")
            or attrs.get("targetId")
            or attrs.get("target_id")
            or attrs.get("id")
            or ""
        ).strip()
        if not label:
            return ""
        return f"[[{label}]]"

    if node_type in {"inlineMath", "mathInline"}:
        math_text = _math_text_from_node(node)
        return f"${math_text}$" if math_text else ""

    children = _safe_tiptap_children(node)
    if not children:
        return ""
    return "".join(_render_markdown_inline(item) for item in children)


def _indent_markdown_block(text: str, prefix: str) -> str:
    lines = text.splitlines()
    if not lines:
        return prefix.rstrip()
    return "\n".join(f"{prefix}{line}" if line else prefix.rstrip() for line in lines)


def _render_markdown_list_item(
    node: dict[str, Any],
    *,
    marker: str,
    indent_level: int,
) -> str:
    indent = "  " * indent_level
    first_line_prefix = f"{indent}{marker} "
    continuation_prefix = f"{indent}{' ' * (len(marker) + 1)}"

    children = _safe_tiptap_children(node)
    if not children:
        return f"{indent}{marker}"

    first_line = ""
    tail_blocks: list[tuple[str, bool]] = []

    for child in children:
        child_type = str(child.get("type") or "")
        if child_type == "paragraph":
            paragraph = "".join(_render_markdown_inline(item) for item in _safe_tiptap_children(child)).strip()
            if paragraph and not first_line:
                first_line = paragraph
            elif paragraph:
                tail_blocks.append((paragraph, False))
            continue

        if child_type == "bulletList":
            nested = _render_markdown_list(child, ordered=False, indent_level=indent_level + 1)
            if nested:
                tail_blocks.append((nested, True))
            continue

        if child_type == "orderedList":
            nested = _render_markdown_list(child, ordered=True, indent_level=indent_level + 1)
            if nested:
                tail_blocks.append((nested, True))
            continue

        block = _render_markdown_block(child, indent_level=indent_level + 1).strip()
        if not block:
            continue

        if not first_line:
            block_lines = block.splitlines()
            first_line = block_lines[0]
            remainder = "\n".join(block_lines[1:]).strip()
            if remainder:
                tail_blocks.append((remainder, False))
            continue

        tail_blocks.append((block, False))

    rendered = f"{first_line_prefix}{first_line}".rstrip()
    for block, is_nested_list in tail_blocks:
        if is_nested_list:
            rendered = f"{rendered}\n{block}"
            continue
        rendered = f"{rendered}\n{_indent_markdown_block(block, continuation_prefix)}"

    return rendered


def _render_markdown_list(
    node: dict[str, Any],
    *,
    ordered: bool,
    indent_level: int = 0,
) -> str:
    items = [item for item in _safe_tiptap_children(node) if str(item.get("type") or "") == "listItem"]
    if not items:
        return ""

    start = 1
    attrs = node.get("attrs")
    if ordered and isinstance(attrs, dict):
        start_raw = attrs.get("start")
        if isinstance(start_raw, int) and start_raw > 0:
            start = start_raw
        elif isinstance(start_raw, str) and start_raw.isdigit() and int(start_raw) > 0:
            start = int(start_raw)

    lines: list[str] = []
    for index, item in enumerate(items):
        marker = f"{start + index}." if ordered else "-"
        rendered_item = _render_markdown_list_item(item, marker=marker, indent_level=indent_level)
        if rendered_item:
            lines.append(rendered_item)
    return "\n".join(lines)


def _render_markdown_blocks(nodes: list[dict[str, Any]], *, indent_level: int = 0) -> str:
    rendered_blocks: list[str] = []
    for node in nodes:
        block = _render_markdown_block(node, indent_level=indent_level).strip()
        if block:
            rendered_blocks.append(block)
    return "\n\n".join(rendered_blocks).strip()


def _render_markdown_block(node: dict[str, Any], *, indent_level: int = 0) -> str:
    node_type = str(node.get("type") or "")
    children = _safe_tiptap_children(node)

    if node_type == "doc":
        return _render_markdown_blocks(children, indent_level=indent_level)

    if node_type == "paragraph":
        return "".join(_render_markdown_inline(item) for item in children).strip()

    if node_type == "heading":
        attrs = node.get("attrs")
        level = 1
        if isinstance(attrs, dict):
            raw_level = attrs.get("level")
            try:
                level = int(raw_level)
            except (TypeError, ValueError):
                level = 1
        level = min(max(level, 1), 6)
        body = "".join(_render_markdown_inline(item) for item in children).strip()
        return f"{'#' * level} {body}".rstrip()

    if node_type == "blockquote":
        body = _render_markdown_blocks(children, indent_level=indent_level).strip()
        if not body:
            return ">"
        return "\n".join(f"> {line}" if line else ">" for line in body.splitlines())

    if node_type == "bulletList":
        return _render_markdown_list(node, ordered=False, indent_level=indent_level)

    if node_type == "orderedList":
        return _render_markdown_list(node, ordered=True, indent_level=indent_level)

    if node_type == "listItem":
        return _render_markdown_list_item(node, marker="-", indent_level=indent_level)

    if node_type == "codeBlock":
        attrs = node.get("attrs")
        language = ""
        if isinstance(attrs, dict):
            language = str(attrs.get("language") or attrs.get("lang") or "").strip()
        raw_code = _extract_raw_text_from_tiptap(children).rstrip("\n")
        fence = "```"
        if "```" in raw_code:
            fence = "````"
        return f"{fence}{language}\n{raw_code}\n{fence}"

    if node_type in {"blockMath", "mathBlock"}:
        math_text = _math_text_from_node(node)
        if not math_text:
            return ""
        return f"$$\n{math_text}\n$$"

    if children:
        return _render_markdown_blocks(children, indent_level=indent_level)
    return ""


def knowledge_note_to_markdown(note: KnowledgeNote) -> str:
    content_json = note.content_json if isinstance(note.content_json, dict) else {"type": "doc", "content": []}
    body = _render_markdown_block(content_json).strip()
    title = _resolve_title(note.title, note.plain_text)
    if body:
        return f"# {title}\n\n{body}\n"
    return f"# {title}\n"


async def get_knowledge_note_markdown_text(*, note_id: uuid.UUID) -> str | None:
    local_note = await get_note(str(note_id))
    if local_note is None:
        return None
    note = KnowledgeNote(
        id=uuid.UUID(local_note["id"]),
        title=local_note["title"],
        content_json=local_note["content_json"],
        plain_text=local_note["plain_text"],
        created_by=local_note["created_by"],
        created_at=datetime.fromisoformat(local_note["created_at"]),
        updated_at=datetime.fromisoformat(local_note["updated_at"]),
    )
    return knowledge_note_to_markdown(note)


def _link_dict_from_local(
    link: dict[str, Any],
    *,
    paper_report_map: dict[str, str] | None = None,
) -> dict[str, Any]:
    payload = {
        "id": str(link["id"]),
        "sourceNoteId": str(link["source_note_id"]),
        "targetType": str(link["target_type"]),
        "targetId": str(link["target_id"]),
        "targetLabel": link["target_label"],
        "createdAt": str(link["created_at"]),
    }
    if payload["targetType"] == "paper":
        payload["readingReportId"] = (paper_report_map or {}).get(payload["targetId"])
    return payload


def _note_summary_dict_from_local(
    note: dict[str, Any],
    *,
    outgoing_link_count: int,
    incoming_link_count: int,
) -> dict[str, Any]:
    plain_text = str(note["plain_text"] or "")
    return {
        "id": str(note["id"]),
        "title": str(note["title"] or ""),
        "excerpt": _to_excerpt(plain_text),
        "plainText": plain_text,
        "createdBy": str(note["created_by"] or "user"),
        "createdAt": str(note["created_at"]),
        "updatedAt": str(note["updated_at"]),
        "outgoingLinkCount": int(outgoing_link_count),
        "incomingLinkCount": int(incoming_link_count),
    }


async def _replace_note_links(
    note: KnowledgeNote,
    links: set[tuple[str, str, str | None]],
) -> None:
    if note.id is None:
        return
    await replace_note_links_local(note_id=str(note.id), links=links)


async def _build_paper_report_map(paper_ids: set[str]) -> dict[str, str]:
    clean_ids = sorted({str(item).strip() for item in paper_ids if str(item).strip()})
    if not clean_ids:
        return {}

    normalized_by_input = {
        paper_id: _normalize_paper_target_id(paper_id) or paper_id for paper_id in clean_ids
    }
    query_ids = sorted(set(clean_ids) | set(normalized_by_input.values()))

    reports = (
        await PaperReadingReport.filter(paper_id__in=query_ids, status="succeeded")
        .order_by("-created_at")
        .all()
    )
    payload: dict[str, str] = {}
    latest_by_normalized: dict[str, str] = {}
    for report in reports:
        paper_id = str(report.paper_id).strip()
        if not paper_id or paper_id in payload:
            continue
        report_id = str(report.id)
        payload[paper_id] = report_id
        normalized_report_id = _normalize_paper_target_id(paper_id)
        if normalized_report_id and normalized_report_id not in latest_by_normalized:
            latest_by_normalized[normalized_report_id] = report_id

    unresolved_normalized = sorted(
        {
            normalized
            for normalized in normalized_by_input.values()
            if normalized
            and normalized not in latest_by_normalized
            and _is_probably_arxiv_paper_id(normalized)
        }
    )
    for normalized in unresolved_normalized:
        fallback = (
            await PaperReadingReport.filter(
                status="succeeded",
                paper_id__startswith=f"{normalized}v",
            )
            .order_by("-created_at")
            .first()
        )
        if fallback is None:
            continue
        fallback_report_id = str(fallback.id)
        fallback_paper_id = str(fallback.paper_id).strip()
        latest_by_normalized[normalized] = fallback_report_id
        if fallback_paper_id and fallback_paper_id not in payload:
            payload[fallback_paper_id] = fallback_report_id

    for original_id, normalized_id in normalized_by_input.items():
        if original_id in payload:
            continue
        report_id = latest_by_normalized.get(normalized_id)
        if report_id:
            payload[original_id] = report_id
    return payload


async def list_knowledge_notes(
    *,
    search: str | None = None,
    limit: int = 20,
) -> list[dict[str, Any]]:
    notes = await list_notes(search=search, limit=limit)
    note_ids = [str(item["id"]) for item in notes]
    outgoing_map, incoming_map = await count_note_links(note_ids)
    return [
        _note_summary_dict_from_local(
            note,
            outgoing_link_count=outgoing_map.get(str(note["id"]), 0),
            incoming_link_count=incoming_map.get(str(note["id"]), 0),
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

    note_id, _ = await create_or_update_note(
        note_id=None,
        title=resolved_title,
        content_json=normalized_content,
        plain_text=plain_text,
        created_by=(created_by or "user").strip() or "user",
    )
    await replace_note_links_local(note_id=note_id, links=_extract_mentions(normalized_content))
    detail = await get_knowledge_note_detail(uuid.UUID(note_id))
    if detail is None:
        raise RuntimeError("创建笔记后读取详情失败。")
    return detail


async def get_knowledge_note_detail(note_id: uuid.UUID) -> dict[str, Any] | None:
    note = await get_note(str(note_id))
    if note is None:
        return None

    outgoing_links = await list_links_for_source(str(note_id))
    incoming_links = await list_incoming_note_links(str(note_id))

    paper_target_ids = {
        str(link["target_id"]).strip()
        for link in outgoing_links
        if str(link["target_type"]) == "paper" and str(link["target_id"]).strip()
    }
    paper_report_map = await _build_paper_report_map(paper_target_ids)

    outgoing_payload = [_link_dict_from_local(link, paper_report_map=paper_report_map) for link in outgoing_links]
    incoming_payload: list[dict[str, Any]] = []
    for link in incoming_links:
        payload = _link_dict_from_local(link)
        if link.get("source_note_title") is not None:
            payload["sourceNoteTitle"] = str(link["source_note_title"])
        if link.get("source_note_updated_at") is not None:
            payload["sourceNoteUpdatedAt"] = str(link["source_note_updated_at"])
        incoming_payload.append(payload)

    return {
        **_note_summary_dict_from_local(
            note,
            outgoing_link_count=len(outgoing_payload),
            incoming_link_count=len(incoming_payload),
        ),
        "contentJson": note["content_json"] if isinstance(note["content_json"], dict) else {"type": "doc", "content": []},
        "outgoingLinks": outgoing_payload,
        "incomingLinks": incoming_payload,
    }


async def update_knowledge_note(
    *,
    note_id: uuid.UUID,
    title: str | None = None,
    content_json: dict[str, Any] | None = None,
) -> dict[str, Any] | None:
    existing = await get_note(str(note_id))
    if existing is None:
        return None

    if content_json is None and title is None:
        raise ValueError("至少需要更新 title 或 contentJson。")

    next_content = existing["content_json"]
    next_plain_text = existing["plain_text"]
    if content_json is not None:
        next_content = _normalize_content_json(content_json)
        next_plain_text = _normalize_plain_text(_extract_plain_text_from_tiptap(next_content))

    if title is not None:
        next_title = _resolve_title(title, next_plain_text)
    else:
        next_title = _resolve_title(existing["title"], next_plain_text)

    await create_or_update_note(
        note_id=str(note_id),
        title=next_title,
        content_json=next_content,
        plain_text=next_plain_text,
        created_by=existing["created_by"],
    )

    if content_json is not None:
        await replace_note_links_local(note_id=str(note_id), links=_extract_mentions(next_content))

    detail = await get_knowledge_note_detail(note_id)
    if detail is None:
        raise RuntimeError("更新笔记后读取详情失败。")
    return detail


async def delete_knowledge_note(*, note_id: uuid.UUID) -> dict[str, Any] | None:
    deleted_link_info = await delete_note(str(note_id))
    if deleted_link_info is None:
        return None

    deleted_snapshots = await DailyWorkNoteSnapshot.filter(note_id=note_id).delete()
    return {
        "deleted": True,
        "noteId": str(note_id),
        "deletedSnapshots": int(deleted_snapshots),
        "deletedOutgoingLinks": int(deleted_link_info.get("deletedOutgoingLinks", 0)),
        "deletedIncomingLinks": int(deleted_link_info.get("deletedIncomingLinks", 0)),
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
        raise ValueError("type 仅支持 paper/question/note/task。")

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

    if normalized_type == "task":
        query = TodoTask.all()
        if keyword:
            query = query.filter(Q(title__icontains=keyword) | Q(description__icontains=keyword))
        tasks = await query.order_by("is_completed", "-created_at", "-id").limit(safe_limit)
        return [
            {
                "type": "task",
                "id": str(task.id),
                "label": task.title,
                "subtitle": (
                    f"任务 #{task.id} · {'已完成' if task.is_completed else '未完成'}"
                    if not str(task.description or "").strip()
                    else f"{'已完成' if task.is_completed else '未完成'} · "
                    f"{_to_excerpt(_normalize_plain_text(task.description), max_len=72)}"
                ),
            }
            for task in tasks
        ]

    return await search_note_targets(
        keyword=keyword,
        limit=safe_limit,
        exclude_note_id=exclude_note_id,
    )
