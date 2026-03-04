import asyncio
import difflib
import logging
import re
import uuid
from datetime import UTC, datetime, timedelta
from typing import Any

from deeplab.knowledge_base.note_service import knowledge_note_to_markdown
from deeplab.llm_provider import LLMRuntimeSettings, get_llm_runtime_settings, invoke_llm_sync
from deeplab.model import (
    DailyWorkReport,
    DailyWorkNoteSnapshot,
    KnowledgeNote,
    KnowledgeNoteLink,
    KnowledgeQuestion,
    LLMInvocationLog,
    Paper,
    PaperReadingReport,
    TodoTask,
    WorkflowExecution,
    WorkflowStageExecution,
)
from deeplab.runtime_settings import (
    DEFAULT_DAILY_WORK_REPORT_SYSTEM_PROMPT,
    DEFAULT_DAILY_WORK_REPORT_USER_PROMPT_TEMPLATE,
    resolve_setting_value,
)
from deeplab.workflows.common import finish_stage, finish_workflow
from deeplab.workflows.daily_reports import CHINA_UTC_OFFSET, china_day_window_utc

logger = logging.getLogger(__name__)

WORKFLOW_NAME_DAILY_WORK_REPORTS = "daily_work_reports"
STAGE_COLLECT_USER_ACTIVITY = "collect_user_activity"
STAGE_GENERATE_DAILY_REPORT = "generate_daily_report"
TASK_DAILY_WORK_REPORT_GENERATION = "daily_work_report_generation"
DEFAULT_DAILY_WORK_REPORT_TEMPERATURE = 0.7
_DAILY_WORK_REPORT_TRIGGER_LOCK = asyncio.Lock()
NO_ACTIVITY_REPORT_MARKDOWN = "昨天没有任何工作记录。"


def _render_prompt_template(template: str, variables: dict[str, str]) -> str:
    rendered = template
    for key, value in variables.items():
        rendered = rendered.replace(f"{{{{{key}}}}}", value)
    return rendered.strip()


async def _get_daily_work_report_prompt_templates() -> tuple[str, str]:
    system_prompt = await resolve_setting_value(
        key="daily_work_report_system_prompt",
        env_keys=(),
        default=DEFAULT_DAILY_WORK_REPORT_SYSTEM_PROMPT,
    )
    if not system_prompt:
        system_prompt = DEFAULT_DAILY_WORK_REPORT_SYSTEM_PROMPT

    user_prompt_template = await resolve_setting_value(
        key="daily_work_report_user_prompt_template",
        env_keys=(),
        default=DEFAULT_DAILY_WORK_REPORT_USER_PROMPT_TEMPLATE,
    )
    if not user_prompt_template:
        user_prompt_template = DEFAULT_DAILY_WORK_REPORT_USER_PROMPT_TEMPLATE

    return system_prompt, user_prompt_template


def _source_date_from_business_day_start(day_start_utc: datetime) -> str:
    source_day_china = (day_start_utc + CHINA_UTC_OFFSET - timedelta(days=1)).date()
    return source_day_china.isoformat()


def _strip_outer_markdown_fence(text: str) -> str:
    content = text.strip()
    fenced_match = re.match(
        r"^```(?:markdown|md)?\s*\r?\n([\s\S]*?)\r?\n```\s*$",
        content,
        flags=re.IGNORECASE,
    )
    if fenced_match:
        return fenced_match.group(1).strip()
    return content


def _has_heading(markdown: str, heading: str) -> bool:
    pattern = rf"(?m)^#{1,6}\s*{re.escape(heading)}\s*$"
    return re.search(pattern, markdown) is not None


def normalize_daily_work_report_markdown(markdown: str) -> str:
    normalized = _strip_outer_markdown_fence(markdown)
    required_headings = ["昨日工作总结", "今日工作规划", "工作建议"]
    missing = [title for title in required_headings if not _has_heading(normalized, title)]
    if not missing:
        return normalized.strip()

    appended = normalized.strip()
    for title in missing:
        appended += f"\n\n## {title}\n- （模型未生成该部分内容）"
    return appended.strip()


def _format_task_item(task: TodoTask) -> str:
    title = str(task.title or "").strip() or "未命名任务"
    description = str(task.description or "").strip()
    if description:
        return f"- **{title}**：{description}"
    return f"- **{title}**"


def _format_report_comment_item(report: PaperReadingReport) -> str:
    paper_title = (
        report.paper.title
        if hasattr(report, "paper") and report.paper is not None and str(report.paper.title or "").strip()
        else report.paper_id
    )
    stage1_overview = str(report.stage1_overview or "").strip() or "（无）"
    comment = str(report.comment or "").strip() or "（无）"
    return (
        f"### {paper_title}（{report.paper_id}）\n"
        f"- Stage1 Overview：\n\n{stage1_overview}\n\n"
        f"- 用户评论：\n\n{comment}\n"
    )


def _normalize_target_id_set(links: list[KnowledgeNoteLink], target_type: str) -> set[str]:
    return {
        str(link.target_id).strip()
        for link in links
        if link.target_type == target_type and str(link.target_id).strip()
    }


def _safe_parse_uuid(value: str) -> uuid.UUID | None:
    try:
        return uuid.UUID(value)
    except ValueError:
        return None


async def _build_note_target_label_maps(
    note_links: list[KnowledgeNoteLink],
) -> tuple[dict[str, str], dict[str, str], dict[str, str]]:
    paper_ids = sorted(_normalize_target_id_set(note_links, "paper"))
    question_id_strings = sorted(_normalize_target_id_set(note_links, "question"))
    task_id_strings = sorted(_normalize_target_id_set(note_links, "task"))

    paper_title_by_id: dict[str, str] = {}
    question_text_by_id: dict[str, str] = {}
    task_title_by_id: dict[str, str] = {}

    if paper_ids:
        papers = await Paper.filter(id__in=paper_ids).all()
        paper_title_by_id = {
            paper.id: (str(paper.title or "").strip() or paper.id)
            for paper in papers
        }

    question_ids = [
        parsed
        for parsed in (_safe_parse_uuid(value) for value in question_id_strings)
        if parsed is not None
    ]
    if question_ids:
        questions = await KnowledgeQuestion.filter(id__in=question_ids).all()
        question_text_by_id = {
            str(question.id): (str(question.question or "").strip() or str(question.id))
            for question in questions
        }

    task_ids: list[int] = []
    for raw in task_id_strings:
        if raw.isdigit():
            task_ids.append(int(raw))
    if task_ids:
        tasks = await TodoTask.filter(id__in=task_ids).all()
        task_title_by_id = {
            str(task.id): (str(task.title or "").strip() or str(task.id))
            for task in tasks
        }

    return paper_title_by_id, question_text_by_id, task_title_by_id


def _resolve_note_target_labels(
    links: list[KnowledgeNoteLink],
    *,
    target_type: str,
    title_map: dict[str, str],
) -> list[str]:
    labels: list[str] = []
    for link in links:
        if link.target_type != target_type:
            continue
        target_id = str(link.target_id).strip()
        if not target_id:
            continue
        label = title_map.get(target_id)
        if not label:
            label = str(link.target_label or "").strip() or target_id
        labels.append(label)
    return sorted({item for item in labels if item})


def _format_label_line(title: str, labels: list[str]) -> str:
    if not labels:
        return f"- {title}：无"
    return f"- {title}：{'；'.join(labels)}"


def _iso_or_none(value: datetime | None) -> str | None:
    if value is None:
        return None
    return value.isoformat()


def _build_markdown_increment(previous: str, current: str, *, max_lines: int = 320) -> str:
    previous_text = str(previous or "")
    current_text = str(current or "")
    if previous_text == current_text:
        return ""

    diff_lines = list(
        difflib.unified_diff(
            previous_text.splitlines(),
            current_text.splitlines(),
            fromfile="snapshot",
            tofile="current",
            lineterm="",
        )
    )
    if len(diff_lines) > max_lines:
        kept = diff_lines[:max_lines]
        kept.append(f"...（已截断，原始 diff 行数 {len(diff_lines)}）")
        diff_lines = kept
    return "```diff\n" + "\n".join(diff_lines) + "\n```"


async def _resolve_activity_checkpoint_utc(
    *,
    fallback_start_utc: datetime,
    exclude_workflow_id: uuid.UUID | None = None,
) -> datetime:
    """Resolve the baseline timestamp for activity delta collection.

    Daily work activity is treated as a delta between:
    1) current database state at trigger time, and
    2) the most recent successful `collect_user_activity` stage.

    This is intentionally not a strict "yesterday 00:00-24:00" window.
    """
    query = WorkflowStageExecution.filter(
        stage=STAGE_COLLECT_USER_ACTIVITY,
        status="succeeded",
        workflow__workflow_name=WORKFLOW_NAME_DAILY_WORK_REPORTS,
    )
    if exclude_workflow_id is not None:
        query = query.exclude(workflow_id=exclude_workflow_id)

    latest_stage = await query.order_by("-finished_at", "-started_at").first()
    if latest_stage is not None:
        if latest_stage.finished_at is not None:
            return latest_stage.finished_at
        return latest_stage.started_at
    return fallback_start_utc


async def collect_previous_day_activity_markdown(
    *,
    source_date: str,
    activity_since_utc: datetime,
    collect_until_utc: datetime,
) -> dict[str, Any]:
    """Collect behavior delta for daily work report generation.

    The collection window is [activity_since_utc, collect_until_utc) for time-based
    entities (comments/tasks). Notes are collected via snapshot diff, so they also
    follow delta semantics relative to the last snapshot, not strict calendar day.
    """
    comment_reports = (
        await PaperReadingReport.filter(
            updated_at__gte=activity_since_utc,
            updated_at__lt=collect_until_utc,
        )
        .exclude(comment="")
        .select_related("paper")
        .order_by("-updated_at")
        .all()
    )
    comment_reports = [item for item in comment_reports if str(item.comment or "").strip()]

    open_tasks = await TodoTask.filter(is_completed=False).order_by("-created_at", "-id").all()
    created_tasks = (
        await TodoTask.filter(created_at__gte=activity_since_utc, created_at__lt=collect_until_utc)
        .order_by("-created_at", "-id")
        .all()
    )
    completed_tasks = (
        await TodoTask.filter(completed_at__gte=activity_since_utc, completed_at__lt=collect_until_utc)
        .order_by("-completed_at", "-id")
        .all()
    )

    all_notes = await KnowledgeNote.all().order_by("-updated_at").all()
    snapshots = await DailyWorkNoteSnapshot.filter(note_id__in=[note.id for note in all_notes]).all()
    snapshot_by_note_id = {str(snapshot.note_id): snapshot for snapshot in snapshots}

    note_delta_candidates: list[dict[str, Any]] = []
    for note in all_notes:
        note_markdown = knowledge_note_to_markdown(note).strip()
        snapshot = snapshot_by_note_id.get(str(note.id))
        previous_markdown = str(snapshot.snapshot_markdown or "").strip() if snapshot else ""
        if snapshot is not None and previous_markdown == note_markdown:
            continue
        is_new_snapshot = snapshot is None
        increment_markdown = note_markdown if is_new_snapshot else _build_markdown_increment(
            previous_markdown,
            note_markdown,
        )
        note_delta_candidates.append(
            {
                "note": note,
                "snapshot": snapshot,
                "isNewSnapshot": is_new_snapshot,
                "currentMarkdown": note_markdown,
                "incrementMarkdown": increment_markdown,
            }
        )

    note_links: list[KnowledgeNoteLink] = []
    if note_delta_candidates:
        note_links = await KnowledgeNoteLink.filter(
            source_note_id__in=[item["note"].id for item in note_delta_candidates]
        ).all()
    links_by_note_id: dict[str, list[KnowledgeNoteLink]] = {}
    for link in note_links:
        links_by_note_id.setdefault(str(link.source_note_id), []).append(link)

    paper_title_by_id, question_text_by_id, task_title_by_id = await _build_note_target_label_maps(note_links)

    changed_notes: list[dict[str, Any]] = []
    for item in note_delta_candidates:
        note = item["note"]
        snapshot = item["snapshot"]
        is_new_snapshot = bool(item["isNewSnapshot"])
        snapshot_record: DailyWorkNoteSnapshot
        if snapshot is None:
            snapshot_record = await DailyWorkNoteSnapshot.create(
                note=note,
                snapshot_markdown=item["currentMarkdown"],
                note_updated_at=note.updated_at,
            )
        else:
            snapshot_refresh_at = datetime.now(tz=UTC)
            snapshot.snapshot_markdown = item["currentMarkdown"]
            snapshot.note_updated_at = note.updated_at
            snapshot.snapshot_updated_at = snapshot_refresh_at
            await snapshot.save(update_fields=["snapshot_markdown", "note_updated_at", "snapshot_updated_at"])
            snapshot_record = snapshot

        note_id = str(note.id)
        related_links = links_by_note_id.get(note_id, [])
        linked_papers = _resolve_note_target_labels(
            related_links,
            target_type="paper",
            title_map=paper_title_by_id,
        )
        linked_questions = _resolve_note_target_labels(
            related_links,
            target_type="question",
            title_map=question_text_by_id,
        )
        linked_tasks = _resolve_note_target_labels(
            related_links,
            target_type="task",
            title_map=task_title_by_id,
        )
        changed_notes.append(
            {
                "noteId": note_id,
                "title": note.title,
                "changeType": "新建" if is_new_snapshot else "编辑",
                "createdAt": note.created_at.isoformat(),
                "updatedAt": note.updated_at.isoformat(),
                "lastSnapshotUpdatedAt": _iso_or_none(snapshot.snapshot_updated_at) if snapshot else None,
                "currentSnapshotUpdatedAt": snapshot_record.snapshot_updated_at.isoformat(),
                "linkedPapers": linked_papers,
                "linkedQuestions": linked_questions,
                "linkedTasks": linked_tasks,
                "incrementMarkdown": item["incrementMarkdown"],
            }
        )

    lines: list[str] = [
        f"# 用户行为增量汇总（来源日期标记：{source_date}）",
        "",
        "- 说明：本报告按“当前数据库状态 vs 上次日报行为检索快照”的增量语义生成，并非严格按自然日统计。",
        f"- 增量基线（UTC，上次日报检索完成时间）：{activity_since_utc.isoformat()}",
        f"- 本次检索截止（UTC）：{collect_until_utc.isoformat()}",
        "",
        f"## 增量论文精读报告评论（{len(comment_reports)}）",
    ]

    if comment_reports:
        for report in comment_reports:
            lines.append(_format_report_comment_item(report))
    else:
        lines.append("（无）")
        lines.append("")

    lines.extend(
        [
            f"## 当前未完成任务（{len(open_tasks)}）",
        ]
    )
    if open_tasks:
        lines.extend(_format_task_item(task) for task in open_tasks)
    else:
        lines.append("（无）")
    lines.append("")

    lines.extend(
        [
            f"## 增量新建任务（{len(created_tasks)}）",
        ]
    )
    if created_tasks:
        lines.extend(_format_task_item(task) for task in created_tasks)
    else:
        lines.append("（无）")
    lines.append("")

    lines.extend(
        [
            f"## 增量完成任务（{len(completed_tasks)}）",
        ]
    )
    if completed_tasks:
        lines.extend(_format_task_item(task) for task in completed_tasks)
    else:
        lines.append("（无）")
    lines.append("")

    lines.extend(
        [
            f"## 增量创建或编辑笔记（{len(changed_notes)}）",
        ]
    )
    if changed_notes:
        for note_item in changed_notes:
            increment_heading = (
                "#### 笔记完整内容"
                if note_item["changeType"] == "新建"
                else "#### 笔记增量（相对上次日报快照）"
            )
            lines.extend(
                [
                    f"### {note_item['title']}（{note_item['changeType']}）",
                    f"- 创建时间：{note_item['createdAt']}",
                    f"- 更新时间：{note_item['updatedAt']}",
                    f"- 上次快照更新时间：{note_item['lastSnapshotUpdatedAt'] or '（无）'}",
                    f"- 本次快照更新时间：{note_item['currentSnapshotUpdatedAt']}",
                    _format_label_line("关联文献", note_item["linkedPapers"]),
                    _format_label_line("关联问题", note_item["linkedQuestions"]),
                    _format_label_line("关联任务", note_item["linkedTasks"]),
                    "",
                    increment_heading,
                    "",
                    note_item["incrementMarkdown"] or "（无增量）",
                    "",
                ]
            )
    else:
        lines.append("（无）")
        lines.append("")

    markdown = "\n".join(lines).strip()
    delta_activity_count = (
        len(comment_reports) + len(created_tasks) + len(completed_tasks) + len(changed_notes)
    )
    activity_summary = {
        "semantics": "delta_since_last_collect_snapshot",
        "sourceDate": source_date,
        "windowUTC": {
            "start": activity_since_utc.isoformat(),
            "end": collect_until_utc.isoformat(),
        },
        "counts": {
            "reportComments": len(comment_reports),
            "openTasks": len(open_tasks),
            "createdTasks": len(created_tasks),
            "completedTasks": len(completed_tasks),
            "changedNotes": len(changed_notes),
            # Keep legacy key name for frontend compatibility.
            "yesterdayActivityCount": delta_activity_count,
        },
        "commentedPapers": [
            {
                "reportId": str(report.id),
                "paperId": report.paper_id,
                "paperTitle": report.paper.title
                if hasattr(report, "paper") and report.paper is not None
                else report.paper_id,
                "updatedAt": report.updated_at.isoformat(),
            }
            for report in comment_reports
        ],
        "completedTasks": [
            {
                "id": task.id,
                "title": task.title,
            }
            for task in completed_tasks
        ],
        "createdTasks": [
            {
                "id": task.id,
                "title": task.title,
                "description": task.description,
            }
            for task in created_tasks
        ],
        "changedNotes": [
            {
                "noteId": note["noteId"],
                "title": note["title"],
                "changeType": note["changeType"],
                "updatedAt": note["updatedAt"],
                "lastSnapshotUpdatedAt": note["lastSnapshotUpdatedAt"],
                "currentSnapshotUpdatedAt": note["currentSnapshotUpdatedAt"],
            }
            for note in changed_notes
        ],
    }
    return {
        "semantics": "delta_since_last_collect_snapshot",
        "sourceDate": source_date,
        "windowUTC": {
            "start": activity_since_utc.isoformat(),
            "end": collect_until_utc.isoformat(),
        },
        "counts": {
            "reportComments": len(comment_reports),
            "openTasks": len(open_tasks),
            "createdTasks": len(created_tasks),
            "completedTasks": len(completed_tasks),
            "changedNotes": len(changed_notes),
            # Keep legacy key name for frontend compatibility.
            "yesterdayActivityCount": delta_activity_count,
        },
        "hasUserActivity": delta_activity_count > 0,
        "activitySummary": activity_summary,
        "sourceMarkdown": markdown,
    }


async def get_previous_day_activity_preview(now: datetime | None = None) -> dict[str, Any]:
    """Preview activity delta before triggering daily work report workflow.

    Note: despite route naming history (`previous_day`), this preview uses
    delta semantics since the latest successful collect snapshot.
    """
    day_start_utc, _, _ = china_day_window_utc(now)
    source_start_utc = day_start_utc - timedelta(days=1)
    source_date = _source_date_from_business_day_start(day_start_utc)
    activity_since_utc = await _resolve_activity_checkpoint_utc(
        fallback_start_utc=source_start_utc,
    )
    collect_until_utc = datetime.now(tz=UTC)

    report_comments_raw = await PaperReadingReport.filter(
        updated_at__gte=activity_since_utc,
        updated_at__lt=collect_until_utc,
    ).exclude(comment="").values_list("comment", flat=True)
    report_comments_count = sum(1 for item in report_comments_raw if str(item or "").strip())

    open_tasks_count = int(await TodoTask.filter(is_completed=False).count())
    created_tasks_count = int(
        await TodoTask.filter(
            created_at__gte=activity_since_utc,
            created_at__lt=collect_until_utc,
        ).count()
    )
    completed_tasks_count = int(
        await TodoTask.filter(
            completed_at__gte=activity_since_utc,
            completed_at__lt=collect_until_utc,
        ).count()
    )
    all_notes = await KnowledgeNote.all().all()
    snapshots = await DailyWorkNoteSnapshot.filter(note_id__in=[note.id for note in all_notes]).all()
    snapshot_by_note_id = {str(snapshot.note_id): snapshot for snapshot in snapshots}
    changed_notes_count = 0
    for note in all_notes:
        snapshot = snapshot_by_note_id.get(str(note.id))
        note_markdown = knowledge_note_to_markdown(note).strip()
        snapshot_markdown = str(snapshot.snapshot_markdown or "").strip() if snapshot else ""
        if snapshot is None or note_markdown != snapshot_markdown:
            changed_notes_count += 1

    delta_activity_count = (
        report_comments_count
        + created_tasks_count
        + completed_tasks_count
        + changed_notes_count
    )
    return {
        "semantics": "delta_since_last_collect_snapshot",
        "sourceDate": source_date,
        "windowUTC": {
            "start": activity_since_utc.isoformat(),
            "end": collect_until_utc.isoformat(),
        },
        "counts": {
            "reportComments": report_comments_count,
            "openTasks": open_tasks_count,
            "createdTasks": created_tasks_count,
            "completedTasks": completed_tasks_count,
            "changedNotes": changed_notes_count,
            # Keep legacy key name for frontend compatibility.
            "yesterdayActivityCount": delta_activity_count,
        },
        "hasUserActivity": delta_activity_count > 0,
    }


async def _mark_workflow_llm_usage(
    workflow_execution: WorkflowExecution,
    *,
    provider: str,
    model: str,
    temperature: float,
    google_thinking_level: str | None,
) -> None:
    context = dict(workflow_execution.context or {})
    llm_usage = context.get("llmUsage")
    if not isinstance(llm_usage, dict):
        llm_usage = {}

    llm_usage[STAGE_GENERATE_DAILY_REPORT] = {
        "provider": provider,
        "model": model,
        "temperature": temperature,
        "google_thinking_level": google_thinking_level,
    }
    context["llmUsage"] = llm_usage
    workflow_execution.context = context
    await workflow_execution.save(update_fields=["context"])


async def generate_daily_work_report_markdown(
    *,
    business_date: str,
    source_date: str,
    source_markdown: str,
    workflow_execution: WorkflowExecution,
    stage_execution: WorkflowStageExecution,
) -> dict[str, Any]:
    llm_settings: LLMRuntimeSettings = await get_llm_runtime_settings()
    system_prompt, user_prompt_template = await _get_daily_work_report_prompt_templates()
    user_prompt = _render_prompt_template(
        user_prompt_template,
        {
            "BUSINESS_DATE": business_date,
            "SOURCE_DATE": source_date,
            "ACTIVITY_MARKDOWN": source_markdown,
        },
    )
    temperature = DEFAULT_DAILY_WORK_REPORT_TEMPERATURE

    await _mark_workflow_llm_usage(
        workflow_execution,
        provider=llm_settings.provider,
        model=llm_settings.model,
        temperature=temperature,
        google_thinking_level=llm_settings.google_thinking_level,
    )

    invocation = await LLMInvocationLog.create(
        provider=llm_settings.provider,
        model=llm_settings.model,
        stage=STAGE_GENERATE_DAILY_REPORT,
        task=TASK_DAILY_WORK_REPORT_GENERATION,
        workflow=workflow_execution,
        stage_execution=stage_execution,
        input_payload={
            "provider": llm_settings.provider,
            "model": llm_settings.model,
            "base_url": llm_settings.base_url,
            "google_thinking_level": llm_settings.google_thinking_level,
            "temperature": temperature,
            "system_prompt": system_prompt,
            "user_prompt_chars": len(user_prompt),
            "business_date": business_date,
            "source_date": source_date,
        },
        metadata={"workflow_name": WORKFLOW_NAME_DAILY_WORK_REPORTS},
        status="running",
    )

    try:
        response_text, response_payload, latency_ms = await asyncio.to_thread(
            invoke_llm_sync,
            settings=llm_settings,
            system_prompt=system_prompt,
            user_prompt=user_prompt,
            temperature=temperature,
            response_mime_type="text/plain",
        )
        output_text = str(response_text or "").strip()
        if not output_text:
            raise ValueError("日报生成模型返回为空。")
        report_markdown = normalize_daily_work_report_markdown(output_text)
        invocation.status = "succeeded"
        invocation.output_payload = response_payload
        invocation.output_text = output_text
        invocation.latency_ms = latency_ms
        await invocation.save(
            update_fields=["status", "output_payload", "output_text", "latency_ms"]
        )
    except Exception as exc:
        invocation.status = "failed"
        invocation.error_message = str(exc)
        await invocation.save(update_fields=["status", "error_message"])
        raise

    return {
        "reportMarkdown": report_markdown,
        "llmInvocationId": str(invocation.id),
    }


async def get_latest_succeeded_stage_payload(
    workflow: WorkflowExecution,
    stage_name: str,
) -> dict[str, Any] | None:
    stage = (
        await WorkflowStageExecution.filter(
            workflow=workflow,
            stage=stage_name,
            status="succeeded",
        )
        .order_by("-started_at")
        .first()
    )
    if stage is None or not isinstance(stage.output_payload, dict):
        return None
    return stage.output_payload


async def workflow_has_complete_daily_work_report_output(workflow: WorkflowExecution) -> bool:
    payload = await get_latest_succeeded_stage_payload(workflow, STAGE_GENERATE_DAILY_REPORT)
    if not isinstance(payload, dict):
        return False
    if str(payload.get("skipReason") or "").strip() == "no_user_activity":
        return False
    return bool(str(payload.get("reportMarkdown") or "").strip())


async def _find_latest_workflow_by_statuses(
    *,
    start_utc: datetime,
    end_utc: datetime,
    statuses: tuple[str, ...],
) -> WorkflowExecution | None:
    return (
        await WorkflowExecution.filter(
            workflow_name=WORKFLOW_NAME_DAILY_WORK_REPORTS,
            started_at__gte=start_utc,
            started_at__lt=end_utc,
            status__in=list(statuses),
        )
        .order_by("-started_at")
        .first()
    )


async def prepare_daily_work_report_workflow_execution(
    trigger_type: str,
    context: dict[str, Any] | None = None,
) -> tuple[WorkflowExecution, bool, str | None]:
    day_start_utc, day_end_utc, business_date = china_day_window_utc()
    source_start_utc = day_start_utc - timedelta(days=1)
    source_end_utc = day_start_utc
    source_date = _source_date_from_business_day_start(day_start_utc)

    async with _DAILY_WORK_REPORT_TRIGGER_LOCK:
        running = await _find_latest_workflow_by_statuses(
            start_utc=day_start_utc,
            end_utc=day_end_utc,
            statuses=("running",),
        )
        if running is not None:
            return running, False, "running"

        existing_report = await DailyWorkReport.get_or_none(
            business_date=business_date,
            status="succeeded",
        )
        if (
            existing_report is not None
            and str(existing_report.report_markdown or "").strip() == NO_ACTIVITY_REPORT_MARKDOWN
        ):
            await DailyWorkReport.filter(id=existing_report.id).delete()
            existing_report = None
        if existing_report is not None and existing_report.workflow_id is not None:
            existing_workflow = await WorkflowExecution.get_or_none(id=existing_report.workflow_id)
            if existing_workflow is not None:
                return existing_workflow, False, "succeeded"

        succeeded = await _find_latest_workflow_by_statuses(
            start_utc=day_start_utc,
            end_utc=day_end_utc,
            statuses=("succeeded",),
        )
        if succeeded is not None and await workflow_has_complete_daily_work_report_output(succeeded):
            return succeeded, False, "succeeded"

        resumable = (
            await WorkflowExecution.filter(
                workflow_name=WORKFLOW_NAME_DAILY_WORK_REPORTS,
                started_at__gte=day_start_utc,
                started_at__lt=day_end_utc,
                status__in=["failed", "succeeded"],
            )
            .order_by("-started_at")
            .first()
        )
        if resumable is not None and resumable.status == "succeeded":
            generate_payload = await get_latest_succeeded_stage_payload(
                resumable, STAGE_GENERATE_DAILY_REPORT
            )
            if (
                isinstance(generate_payload, dict)
                and str(generate_payload.get("skipReason") or "").strip() == "no_user_activity"
            ):
                resumable = None
        if resumable is not None:
            resumable_context = dict(resumable.context or {})
            resumable_context.setdefault("businessDateCST", business_date)
            resumable_context.setdefault("sourceDateCST", source_date)
            resumable_context.setdefault(
                "sourceDateWindowUTC",
                {"start": source_start_utc.isoformat(), "end": source_end_utc.isoformat()},
            )
            resumable_context.setdefault(
                "businessDateWindowUTC",
                {"start": day_start_utc.isoformat(), "end": day_end_utc.isoformat()},
            )
            if context:
                resumable_context["resumeRequest"] = context
            resumable_context["lastResumeAt"] = datetime.now(tz=UTC).isoformat()

            resumable.status = "running"
            resumable.error_message = None
            resumable.finished_at = None
            resumable.context = resumable_context
            await resumable.save(
                update_fields=["status", "error_message", "finished_at", "context"]
            )
            return resumable, True, "resume"

        workflow_context = dict(context or {})
        workflow_context.setdefault("businessDateCST", business_date)
        workflow_context.setdefault("sourceDateCST", source_date)
        workflow_context.setdefault(
            "sourceDateWindowUTC",
            {"start": source_start_utc.isoformat(), "end": source_end_utc.isoformat()},
        )
        workflow_context.setdefault(
            "businessDateWindowUTC",
            {"start": day_start_utc.isoformat(), "end": day_end_utc.isoformat()},
        )

        workflow = await WorkflowExecution.create(
            workflow_name=WORKFLOW_NAME_DAILY_WORK_REPORTS,
            trigger_type=trigger_type,
            status="running",
            context=workflow_context,
        )
        return workflow, True, None


async def _persist_daily_work_report(
    *,
    workflow: WorkflowExecution,
    business_date: str,
    source_date: str,
    status: str,
    source_markdown: str,
    activity_summary: dict[str, Any] | None,
    report_markdown: str,
    error_message: str | None,
) -> DailyWorkReport:
    report, _ = await DailyWorkReport.update_or_create(
        business_date=business_date,
        defaults={
            "workflow": workflow,
            "source_date": source_date,
            "status": status,
            "source_markdown": source_markdown,
            "activity_summary": activity_summary or {},
            "report_markdown": report_markdown,
            "error_message": error_message,
        },
    )
    return report


async def execute_daily_work_report_workflow(workflow: WorkflowExecution) -> dict[str, Any]:
    context = dict(workflow.context or {})
    business_date = str(context.get("businessDateCST") or "").strip()
    source_date = str(context.get("sourceDateCST") or "").strip()
    source_window = context.get("sourceDateWindowUTC")
    if not business_date or not source_date or not isinstance(source_window, dict):
        raise RuntimeError("daily_work_reports 工作流上下文缺失业务日期信息。")

    source_start_raw = str(source_window.get("start") or "").strip()
    source_end_raw = str(source_window.get("end") or "").strip()
    if not source_start_raw or not source_end_raw:
        raise RuntimeError("daily_work_reports 工作流上下文缺失 sourceDateWindowUTC。")

    source_start_utc = datetime.fromisoformat(source_start_raw)
    source_end_utc = datetime.fromisoformat(source_end_raw)

    collected_source_markdown = ""
    generated_report_markdown = ""

    try:
        collect_payload = await get_latest_succeeded_stage_payload(workflow, STAGE_COLLECT_USER_ACTIVITY)
        if collect_payload is None:
            activity_since_utc = await _resolve_activity_checkpoint_utc(
                fallback_start_utc=source_start_utc,
                exclude_workflow_id=workflow.id,
            )
            collect_until_utc = datetime.now(tz=UTC)
            collect_stage = await WorkflowStageExecution.create(
                workflow=workflow,
                stage=STAGE_COLLECT_USER_ACTIVITY,
                status="running",
                input_payload={
                    "sourceDate": source_date,
                    "sourceDateWindowUTC": {
                        "start": source_start_utc.isoformat(),
                        "end": source_end_utc.isoformat(),
                    },
                    # Delta baseline: this workflow collects behavior changes since
                    # the latest successful collect snapshot, not strict calendar day.
                    "activityDeltaWindowUTC": {
                        "start": activity_since_utc.isoformat(),
                        "end": collect_until_utc.isoformat(),
                    },
                },
            )
            try:
                collect_payload = await collect_previous_day_activity_markdown(
                    source_date=source_date,
                    activity_since_utc=activity_since_utc,
                    collect_until_utc=collect_until_utc,
                )
                await finish_stage(
                    collect_stage,
                    status="succeeded",
                    output_payload=collect_payload,
                )
            except Exception as exc:
                await finish_stage(
                    collect_stage,
                    status="failed",
                    error_message=str(exc),
                )
                raise

        source_markdown = str(collect_payload.get("sourceMarkdown") or "").strip()
        if not source_markdown:
            raise RuntimeError("collect_user_activity 阶段成功但未产生 sourceMarkdown。")
        collected_source_markdown = source_markdown

        counts = collect_payload.get("counts")
        has_user_activity = bool(collect_payload.get("hasUserActivity"))
        if not isinstance(counts, dict):
            counts = {}
        if not has_user_activity:
            yesterday_activity_count = counts.get("yesterdayActivityCount")
            if isinstance(yesterday_activity_count, int):
                has_user_activity = yesterday_activity_count > 0
            elif isinstance(yesterday_activity_count, str) and yesterday_activity_count.isdigit():
                has_user_activity = int(yesterday_activity_count) > 0

        if not has_user_activity:
            generate_stage = await WorkflowStageExecution.create(
                workflow=workflow,
                stage=STAGE_GENERATE_DAILY_REPORT,
                status="running",
                input_payload={
                    "businessDate": business_date,
                    "sourceDate": source_date,
                    "sourceMarkdownChars": len(source_markdown),
                    "hasUserActivity": False,
                },
            )
            skipped_payload = {
                "reportMarkdown": NO_ACTIVITY_REPORT_MARKDOWN,
                "skipped": True,
                "skipReason": "no_user_activity",
            }
            await finish_stage(
                generate_stage,
                status="succeeded",
                output_payload=skipped_payload,
            )
            await finish_workflow(workflow, status="succeeded")
            return {
                "workflow_id": str(workflow.id),
                "report_id": None,
                "business_date": business_date,
                "source_date": source_date,
                "status": "skipped_no_activity",
            }
        else:
            generate_payload = await get_latest_succeeded_stage_payload(workflow, STAGE_GENERATE_DAILY_REPORT)
            if generate_payload is None:
                generate_stage = await WorkflowStageExecution.create(
                    workflow=workflow,
                    stage=STAGE_GENERATE_DAILY_REPORT,
                    status="running",
                    input_payload={
                        "businessDate": business_date,
                        "sourceDate": source_date,
                        "sourceMarkdownChars": len(source_markdown),
                    },
                )
                try:
                    generate_payload = await generate_daily_work_report_markdown(
                        business_date=business_date,
                        source_date=source_date,
                        source_markdown=source_markdown,
                        workflow_execution=workflow,
                        stage_execution=generate_stage,
                    )
                    await finish_stage(
                        generate_stage,
                        status="succeeded",
                        output_payload=generate_payload,
                    )
                except Exception as exc:
                    await finish_stage(
                        generate_stage,
                        status="failed",
                        error_message=str(exc),
                    )
                    raise

        report_markdown = str(generate_payload.get("reportMarkdown") or "").strip()
        if not report_markdown:
            raise RuntimeError("generate_daily_report 阶段成功但未产生 reportMarkdown。")
        generated_report_markdown = report_markdown

        report = await _persist_daily_work_report(
            workflow=workflow,
            business_date=business_date,
            source_date=source_date,
            status="succeeded",
            source_markdown=source_markdown,
            activity_summary=collect_payload.get("activitySummary")
            if isinstance(collect_payload.get("activitySummary"), dict)
            else {},
            report_markdown=report_markdown,
            error_message=None,
        )

        await finish_workflow(workflow, status="succeeded")
        return {
            "workflow_id": str(workflow.id),
            "report_id": str(report.id),
            "business_date": business_date,
            "source_date": source_date,
            "status": "succeeded",
        }
    except Exception as exc:
        await _persist_daily_work_report(
            workflow=workflow,
            business_date=business_date or datetime.now(tz=UTC).date().isoformat(),
            source_date=source_date or "",
            status="failed",
            source_markdown=collected_source_markdown,
            activity_summary={},
            report_markdown=generated_report_markdown,
            error_message=str(exc),
        )
        await finish_workflow(workflow, status="failed", error_message=str(exc))
        raise


async def run_daily_work_report_workflow(
    trigger_type: str,
    context: dict[str, Any] | None = None,
) -> dict[str, Any]:
    workflow, should_execute, dedupe_reason = await prepare_daily_work_report_workflow_execution(
        trigger_type=trigger_type,
        context=context,
    )
    if not should_execute:
        return {
            "workflow_id": str(workflow.id),
            "deduplicated": True,
            "dedupe_reason": dedupe_reason,
            "workflow_status": workflow.status,
        }

    result = await execute_daily_work_report_workflow(workflow)
    result["deduplicated"] = False
    return result


async def trigger_daily_work_report_workflow(
    trigger_type: str,
    context: dict[str, Any] | None = None,
) -> str:
    workflow, should_execute, dedupe_reason = await prepare_daily_work_report_workflow_execution(
        trigger_type=trigger_type,
        context=context,
    )
    if not should_execute:
        logger.info(
            "Daily work report workflow deduplicated, reason=%s workflow_id=%s status=%s",
            dedupe_reason,
            workflow.id,
            workflow.status,
        )
        return str(workflow.id)

    async def _runner() -> None:
        try:
            await execute_daily_work_report_workflow(workflow)
        except Exception:
            logger.exception(
                "Background daily work report workflow failed, workflow_id=%s",
                workflow.id,
            )

    asyncio.create_task(_runner())
    return str(workflow.id)
