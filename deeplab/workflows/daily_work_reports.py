import asyncio
import logging
import re
import uuid
from datetime import UTC, datetime, timedelta
from typing import Any

from tortoise.expressions import Q

from deeplab.knowledge_base.note_service import knowledge_note_to_markdown
from deeplab.llm_provider import LLMRuntimeSettings, get_llm_runtime_settings, invoke_llm_sync
from deeplab.model import (
    DailyWorkReport,
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

DEFAULT_DAILY_WORK_REPORT_SYSTEM_PROMPT = (
    "你是严谨的科研工作日报 Agent。"
    "你将基于用户前一天的真实行为记录生成中文 Markdown 日报。"
    "禁止虚构输入中不存在的信息，内容要具体、可执行。"
)

DEFAULT_DAILY_WORK_REPORT_USER_PROMPT_TEMPLATE = """
请基于以下“用户行为汇总”生成 {{BUSINESS_DATE}} 的工作日报。

你必须严格输出且只输出以下三节（Markdown 标题）：
## 昨日工作总结
要求：针对输入中的真实行为给出精简分条列点（`-` 列表），强调已完成事项、关键进展、阻塞点。

## 今日工作规划
要求：结合“当前未完成任务 + 昨日进展”给出今日计划，分条列点，明确优先级和可执行动作。

## 工作建议
要求：给出面向当前研究与工程推进的建议，可包含研究创新点、验证路径、实验设计、风险控制等，同样分条列点。

约束：
1. 所有结论必须能在输入中找到依据，不得杜撰。
2. 不要输出除上述三节外的其他大标题。
3. 每节至少 3 条建议，尽量具体。
4. 输出必须是 Markdown 正文，不要包裹代码围栏。

【业务日期（北京时间）】
{{BUSINESS_DATE}}

【行为来源日期（北京时间，前一日）】
{{SOURCE_DATE}}

【用户行为汇总（Markdown）】
{{ACTIVITY_MARKDOWN}}
""".strip()


def _render_prompt_template(template: str, variables: dict[str, str]) -> str:
    rendered = template
    for key, value in variables.items():
        rendered = rendered.replace(f"{{{{{key}}}}}", value)
    return rendered.strip()


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


def _note_change_action(note: KnowledgeNote, *, start_utc: datetime, end_utc: datetime) -> str:
    created_in_window = start_utc <= note.created_at < end_utc
    updated_in_window = start_utc <= note.updated_at < end_utc
    if created_in_window and updated_in_window:
        return "新建并编辑"
    if created_in_window:
        return "新建"
    if updated_in_window:
        return "编辑"
    return "变更"


async def collect_previous_day_activity_markdown(
    *,
    source_start_utc: datetime,
    source_end_utc: datetime,
    source_date: str,
) -> dict[str, Any]:
    comment_reports = (
        await PaperReadingReport.filter(
            updated_at__gte=source_start_utc,
            updated_at__lt=source_end_utc,
        )
        .exclude(comment="")
        .select_related("paper")
        .order_by("-updated_at")
        .all()
    )
    comment_reports = [item for item in comment_reports if str(item.comment or "").strip()]

    open_tasks = await TodoTask.filter(is_completed=False).order_by("-created_at", "-id").all()
    created_tasks = (
        await TodoTask.filter(created_at__gte=source_start_utc, created_at__lt=source_end_utc)
        .order_by("-created_at", "-id")
        .all()
    )
    completed_tasks = (
        await TodoTask.filter(completed_at__gte=source_start_utc, completed_at__lt=source_end_utc)
        .order_by("-completed_at", "-id")
        .all()
    )

    changed_notes = (
        await KnowledgeNote.filter(
            Q(created_at__gte=source_start_utc, created_at__lt=source_end_utc)
            | Q(updated_at__gte=source_start_utc, updated_at__lt=source_end_utc)
        )
        .order_by("-updated_at")
        .all()
    )

    note_links: list[KnowledgeNoteLink] = []
    if changed_notes:
        note_links = await KnowledgeNoteLink.filter(source_note_id__in=[note.id for note in changed_notes]).all()
    links_by_note_id: dict[str, list[KnowledgeNoteLink]] = {}
    for link in note_links:
        key = str(link.source_note_id)
        links_by_note_id.setdefault(key, []).append(link)

    paper_title_by_id, question_text_by_id, task_title_by_id = await _build_note_target_label_maps(note_links)

    lines: list[str] = [
        f"# 前一日用户行为汇总（{source_date}）",
        "",
        f"- 时间窗口（UTC）：{source_start_utc.isoformat()} ~ {source_end_utc.isoformat()}",
        "",
        f"## 论文精读报告评论（{len(comment_reports)}）",
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
            f"## 前一日新建任务（{len(created_tasks)}）",
        ]
    )
    if created_tasks:
        lines.extend(_format_task_item(task) for task in created_tasks)
    else:
        lines.append("（无）")
    lines.append("")

    lines.extend(
        [
            f"## 前一日完成任务（{len(completed_tasks)}）",
        ]
    )
    if completed_tasks:
        lines.extend(_format_task_item(task) for task in completed_tasks)
    else:
        lines.append("（无）")
    lines.append("")

    lines.extend(
        [
            f"## 前一日创建或编辑笔记（{len(changed_notes)}）",
        ]
    )
    if changed_notes:
        for note in changed_notes:
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
            note_markdown = knowledge_note_to_markdown(note).strip()
            lines.extend(
                [
                    f"### {note.title}（{_note_change_action(note, start_utc=source_start_utc, end_utc=source_end_utc)}）",
                    f"- 创建时间：{note.created_at.isoformat()}",
                    f"- 更新时间：{note.updated_at.isoformat()}",
                    _format_label_line("关联文献", linked_papers),
                    _format_label_line("关联问题", linked_questions),
                    _format_label_line("关联任务", linked_tasks),
                    "",
                    "#### 笔记内容（Markdown）",
                    "",
                    note_markdown or "（空）",
                    "",
                ]
            )
    else:
        lines.append("（无）")
        lines.append("")

    markdown = "\n".join(lines).strip()
    yesterday_activity_count = (
        len(comment_reports) + len(created_tasks) + len(completed_tasks) + len(changed_notes)
    )
    return {
        "sourceDate": source_date,
        "windowUTC": {
            "start": source_start_utc.isoformat(),
            "end": source_end_utc.isoformat(),
        },
        "counts": {
            "reportComments": len(comment_reports),
            "openTasks": len(open_tasks),
            "createdTasks": len(created_tasks),
            "completedTasks": len(completed_tasks),
            "changedNotes": len(changed_notes),
            "yesterdayActivityCount": yesterday_activity_count,
        },
        "hasUserActivity": yesterday_activity_count > 0,
        "sourceMarkdown": markdown,
    }


async def get_previous_day_activity_preview(now: datetime | None = None) -> dict[str, Any]:
    day_start_utc, _, _ = china_day_window_utc(now)
    source_start_utc = day_start_utc - timedelta(days=1)
    source_end_utc = day_start_utc
    source_date = _source_date_from_business_day_start(day_start_utc)

    report_comments_raw = await PaperReadingReport.filter(
        updated_at__gte=source_start_utc,
        updated_at__lt=source_end_utc,
    ).exclude(comment="").values_list("comment", flat=True)
    report_comments_count = sum(1 for item in report_comments_raw if str(item or "").strip())

    open_tasks_count = int(await TodoTask.filter(is_completed=False).count())
    created_tasks_count = int(
        await TodoTask.filter(
            created_at__gte=source_start_utc,
            created_at__lt=source_end_utc,
        ).count()
    )
    completed_tasks_count = int(
        await TodoTask.filter(
            completed_at__gte=source_start_utc,
            completed_at__lt=source_end_utc,
        ).count()
    )
    changed_notes_count = int(
        await KnowledgeNote.filter(
            Q(created_at__gte=source_start_utc, created_at__lt=source_end_utc)
            | Q(updated_at__gte=source_start_utc, updated_at__lt=source_end_utc)
        ).count()
    )

    yesterday_activity_count = (
        report_comments_count
        + created_tasks_count
        + completed_tasks_count
        + changed_notes_count
    )
    return {
        "sourceDate": source_date,
        "windowUTC": {
            "start": source_start_utc.isoformat(),
            "end": source_end_utc.isoformat(),
        },
        "counts": {
            "reportComments": report_comments_count,
            "openTasks": open_tasks_count,
            "createdTasks": created_tasks_count,
            "completedTasks": completed_tasks_count,
            "changedNotes": changed_notes_count,
            "yesterdayActivityCount": yesterday_activity_count,
        },
        "hasUserActivity": yesterday_activity_count > 0,
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
    system_prompt = DEFAULT_DAILY_WORK_REPORT_SYSTEM_PROMPT
    user_prompt = _render_prompt_template(
        DEFAULT_DAILY_WORK_REPORT_USER_PROMPT_TEMPLATE,
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
            collect_stage = await WorkflowStageExecution.create(
                workflow=workflow,
                stage=STAGE_COLLECT_USER_ACTIVITY,
                status="running",
                input_payload={
                    "sourceDate": source_date,
                    "sourceWindowUTC": {
                        "start": source_start_utc.isoformat(),
                        "end": source_end_utc.isoformat(),
                    },
                },
            )
            try:
                collect_payload = await collect_previous_day_activity_markdown(
                    source_start_utc=source_start_utc,
                    source_end_utc=source_end_utc,
                    source_date=source_date,
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
            generate_payload = skipped_payload
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
