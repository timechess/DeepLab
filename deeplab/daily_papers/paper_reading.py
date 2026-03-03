import asyncio
import json
import logging
import re
from datetime import UTC, datetime
from pathlib import Path
from tempfile import TemporaryDirectory
from typing import Any
from urllib import request

from deeplab.daily_papers.mistral_ocr import (
    DEFAULT_MISTRAL_BASE_URL,
    DEFAULT_MISTRAL_OCR_MODEL,
    MistralOCRSettings,
    extract_pdf_text,
)
from deeplab.llm_provider import LLMRuntimeSettings, get_llm_runtime_settings, invoke_llm_sync
from deeplab.model import (
    LLMInvocationLog,
    Paper,
    PaperFilteringRun,
    PaperReadingReport,
    PaperReadingRun,
    WorkflowExecution,
    WorkflowStageExecution,
)
from deeplab.runtime_settings import (
    DEFAULT_READING_STAGE1_SYSTEM_PROMPT,
    DEFAULT_READING_STAGE1_TEMPERATURE,
    DEFAULT_READING_STAGE1_USER_PROMPT_TEMPLATE,
    DEFAULT_READING_STAGE2_SYSTEM_PROMPT,
    DEFAULT_READING_STAGE2_TEMPERATURE,
    DEFAULT_READING_STAGE2_USER_PROMPT_TEMPLATE,
    MISTRAL_API_KEY_ENV_KEYS,
    MISTRAL_BASE_URL_ENV_KEYS,
    MISTRAL_MODEL_ENV_KEYS,
    READING_STAGE1_TEMPERATURE_ENV_KEYS,
    READING_STAGE2_TEMPERATURE_ENV_KEYS,
    resolve_setting_value,
)

WORKFLOW_NAME_DAILY_PAPER_REPORTS = "daily_paper_reports"
STAGE_PAPER_READING = "paper_reading"
TASK_PAPER_READING_STAGE1 = "paper_reading_stage1_questioning"
TASK_PAPER_READING_STAGE2 = "paper_reading_stage2_report"

DEFAULT_TEMPERATURE_STAGE1 = 1
DEFAULT_TEMPERATURE_STAGE2 = 1
PDF_DOWNLOAD_TIMEOUT_SECONDS = 90

logger = logging.getLogger(__name__)


def _render_prompt_template(template: str, variables: dict[str, str]) -> str:
    rendered = template
    for key, value in variables.items():
        rendered = rendered.replace(f"{{{{{key}}}}}", value)
    return rendered.strip()


async def _get_reading_prompt_templates() -> tuple[str, str, str, str]:
    stage1_system_prompt = await resolve_setting_value(
        key="reading_stage1_system_prompt",
        env_keys=(),
        default=DEFAULT_READING_STAGE1_SYSTEM_PROMPT,
    )
    if not stage1_system_prompt:
        stage1_system_prompt = DEFAULT_READING_STAGE1_SYSTEM_PROMPT

    stage1_user_template = await resolve_setting_value(
        key="reading_stage1_user_prompt_template",
        env_keys=(),
        default=DEFAULT_READING_STAGE1_USER_PROMPT_TEMPLATE,
    )
    if not stage1_user_template:
        stage1_user_template = DEFAULT_READING_STAGE1_USER_PROMPT_TEMPLATE

    stage2_system_prompt = await resolve_setting_value(
        key="reading_stage2_system_prompt",
        env_keys=(),
        default=DEFAULT_READING_STAGE2_SYSTEM_PROMPT,
    )
    if not stage2_system_prompt:
        stage2_system_prompt = DEFAULT_READING_STAGE2_SYSTEM_PROMPT

    stage2_user_template = await resolve_setting_value(
        key="reading_stage2_user_prompt_template",
        env_keys=(),
        default=DEFAULT_READING_STAGE2_USER_PROMPT_TEMPLATE,
    )
    if not stage2_user_template:
        stage2_user_template = DEFAULT_READING_STAGE2_USER_PROMPT_TEMPLATE

    return (
        stage1_system_prompt,
        stage1_user_template,
        stage2_system_prompt,
        stage2_user_template,
    )


def _parse_temperature(value: str | None, *, field_name: str, default: float) -> float:
    if value is None or not value.strip():
        return default
    try:
        parsed = float(value)
    except ValueError as exc:
        raise ValueError(f"{field_name} 必须是数字，当前值: {value}") from exc
    if parsed < 0 or parsed > 2:
        raise ValueError(f"{field_name} 建议范围是 0-2，当前值: {parsed}")
    return parsed


async def _get_reading_temperatures() -> tuple[float, float]:
    raw_stage1 = await resolve_setting_value(
        key="reading_stage1_temperature",
        env_keys=READING_STAGE1_TEMPERATURE_ENV_KEYS,
        default=DEFAULT_READING_STAGE1_TEMPERATURE,
    )
    raw_stage2 = await resolve_setting_value(
        key="reading_stage2_temperature",
        env_keys=READING_STAGE2_TEMPERATURE_ENV_KEYS,
        default=DEFAULT_READING_STAGE2_TEMPERATURE,
    )
    return (
        _parse_temperature(
            raw_stage1,
            field_name="reading_stage1_temperature",
            default=DEFAULT_TEMPERATURE_STAGE1,
        ),
        _parse_temperature(
            raw_stage2,
            field_name="reading_stage2_temperature",
            default=DEFAULT_TEMPERATURE_STAGE2,
        ),
    )


async def _mark_workflow_llm_usage(
    workflow_execution: WorkflowExecution | None,
    *,
    provider: str,
    model: str,
    stage1_temperature: float,
    stage2_temperature: float,
    google_thinking_level: str | None,
) -> None:
    if workflow_execution is None:
        return

    context = dict(workflow_execution.context or {})
    llm_usage = context.get("llmUsage")
    if not isinstance(llm_usage, dict):
        llm_usage = {}

    llm_usage[STAGE_PAPER_READING] = {
        "provider": provider,
        "model": model,
        "stage1_temperature": stage1_temperature,
        "stage2_temperature": stage2_temperature,
        "google_thinking_level": google_thinking_level,
    }

    context["llmUsage"] = llm_usage
    workflow_execution.context = context
    await workflow_execution.save(update_fields=["context"])


async def _get_mistral_runtime_settings() -> MistralOCRSettings | None:
    api_key = await resolve_setting_value(
        key="mistral_api_key",
        env_keys=MISTRAL_API_KEY_ENV_KEYS,
    )
    if not api_key:
        logger.info("未配置 Mistral OCR API Key，回退到基础 PDF 文本提取。")
        return None

    base_url = await resolve_setting_value(
        key="mistral_base_url",
        env_keys=MISTRAL_BASE_URL_ENV_KEYS,
        default=DEFAULT_MISTRAL_BASE_URL,
    )
    if not base_url:
        base_url = DEFAULT_MISTRAL_BASE_URL

    model = await resolve_setting_value(
        key="mistral_ocr_model",
        env_keys=MISTRAL_MODEL_ENV_KEYS,
        default=DEFAULT_MISTRAL_OCR_MODEL,
    )
    if not model:
        model = DEFAULT_MISTRAL_OCR_MODEL

    return MistralOCRSettings(
        api_key=api_key,
        base_url=base_url.rstrip("/"),
        model=model,
    )


def _build_arxiv_pdf_url(paper_id: str) -> str:
    return f"https://arxiv.org/pdf/{paper_id}"


def _download_pdf(pdf_url: str, output_path: Path) -> None:
    req = request.Request(
        url=pdf_url,
        method="GET",
        headers={"User-Agent": "DeepLab/0.1 (paper-reading)"},
    )
    with request.urlopen(req, timeout=PDF_DOWNLOAD_TIMEOUT_SECONDS) as response:
        status = getattr(response, "status", response.getcode())
        if status != 200:
            raise RuntimeError(f"下载论文 PDF 失败: {pdf_url}, HTTP {status}")

        with output_path.open("wb") as fp:
            while True:
                chunk = response.read(1024 * 1024)
                if not chunk:
                    break
                fp.write(chunk)


def _resolve_paper_pdf_url(paper: Paper, paper_pdf_url_by_id: dict[str, str]) -> str:
    candidate = str(paper_pdf_url_by_id.get(paper.id, "") or "").strip()
    if candidate:
        return candidate
    return _build_arxiv_pdf_url(paper.id)


def _build_stage1_prompts(
    paper: Paper,
    ocr_text_for_prompt: str,
    system_prompt_template: str,
    user_prompt_template: str,
) -> tuple[str, str]:
    system_prompt = (system_prompt_template or "").strip()
    if not system_prompt:
        system_prompt = DEFAULT_READING_STAGE1_SYSTEM_PROMPT

    authors_text = "、".join([str(a).strip() for a in (paper.authors or []) if str(a).strip()]) or "未知"
    keywords_text = "、".join([str(k).strip() for k in (paper.ai_keywords or []) if str(k).strip()]) or "无"
    template = (user_prompt_template or "").strip()
    if not template:
        template = DEFAULT_READING_STAGE1_USER_PROMPT_TEMPLATE

    user_prompt = _render_prompt_template(
        template,
        {
            "PAPER_ID": paper.id,
            "PAPER_TITLE": paper.title,
            "PAPER_AUTHORS": authors_text,
            "PAPER_ORGANIZATION": paper.organization or "未知",
            "PAPER_SUMMARY": paper.summary,
            "PAPER_KEYWORDS": keywords_text,
            "PAPER_OCR_TEXT": ocr_text_for_prompt,
        },
    )
    return system_prompt.strip(), user_prompt.strip()


def _build_stage2_prompts(
    paper: Paper,
    stage1_result_text: str,
    ocr_text_for_prompt: str,
    system_prompt_template: str,
    user_prompt_template: str,
) -> tuple[str, str]:
    system_prompt = (system_prompt_template or "").strip()
    if not system_prompt:
        system_prompt = DEFAULT_READING_STAGE2_SYSTEM_PROMPT

    template = (user_prompt_template or "").strip()
    if not template:
        template = DEFAULT_READING_STAGE2_USER_PROMPT_TEMPLATE

    user_prompt = _render_prompt_template(
        template,
        {
            "PAPER_ID": paper.id,
            "PAPER_TITLE": paper.title,
            "STAGE1_RESULT": stage1_result_text,
            "PAPER_OCR_TEXT": ocr_text_for_prompt,
        },
    )
    return system_prompt.strip(), user_prompt.strip()


def _extract_xml_block(text: str, root_tag: str) -> str | None:
    pattern = rf"<{root_tag}\b[^>]*>[\s\S]*?</{root_tag}>"
    match = re.search(pattern, text, flags=re.IGNORECASE)
    if not match:
        return None
    return match.group(0).strip()


def _extract_tag_inner_text(text: str, tag_name: str) -> str | None:
    pattern = rf"<{tag_name}\b[^>]*>([\s\S]*?)</{tag_name}>"
    match = re.search(pattern, text, flags=re.IGNORECASE)
    if not match:
        return None
    value = match.group(1).strip()
    return value or None


def _strip_outer_xml_tag(text: str, tag_name: str) -> str:
    pattern = rf"^\s*<{tag_name}\b[^>]*>([\s\S]*?)</{tag_name}>\s*$"
    match = re.match(pattern, text, flags=re.IGNORECASE)
    if not match:
        return text
    return match.group(1).strip()


def _strip_outer_markdown_fence(text: str) -> str:
    content = text.strip()
    fenced_match = re.match(
        r"^```[^\n`]*\r?\n([\s\S]*?)\r?\n```\s*$",
        content,
    )
    if fenced_match:
        return fenced_match.group(1).strip()
    return content


def _maybe_decode_json_string_text(text: str) -> str:
    content = text.strip()
    if len(content) < 2 or content[0] != '"' or content[-1] != '"':
        return content
    try:
        decoded = json.loads(content)
    except json.JSONDecodeError:
        return content
    if isinstance(decoded, str):
        return decoded.strip()
    return content


def _maybe_unescape_newline_blob(text: str) -> str:
    content = text.strip()
    # 模型有时会返回 "\\n" 文本而不是真换行，这会导致 Markdown 被渲染为一整行。
    if "\n" in content:
        return content
    if "\\n\\n" not in content:
        return content
    return (
        content.replace("\\r\\n", "\n")
        .replace("\\n", "\n")
        .replace("\\t", "\t")
        .replace('\\"', '"')
    ).strip()


def _normalize_heading_indentation(text: str) -> str:
    lines = text.splitlines()
    normalized_lines: list[str] = []
    in_fence = False

    for line in lines:
        stripped = line.lstrip()
        if stripped.startswith("```") or stripped.startswith("~~~"):
            in_fence = not in_fence
            normalized_lines.append(line)
            continue

        if not in_fence:
            dedented = line.lstrip(" \t")
            if re.match(r"^#{1,6}(\s|$)", dedented):
                line = dedented

        normalized_lines.append(line)

    return "\n".join(normalized_lines)


def normalize_stage2_markdown_text(text: str) -> str:
    normalized = text.strip()
    normalized = _maybe_decode_json_string_text(normalized)
    normalized = _strip_outer_xml_tag(normalized, "stage2_markdown")
    normalized = _strip_outer_xml_tag(normalized, "stage2_report")
    normalized = _strip_outer_xml_tag(normalized, "report_body")
    normalized = _strip_outer_markdown_fence(normalized)
    normalized = _maybe_unescape_newline_blob(normalized)
    normalized = _strip_outer_markdown_fence(normalized)
    normalized = _normalize_heading_indentation(normalized)
    return normalized.strip()


def _extract_stage2_candidate_text(stage2_raw_text: str) -> str:
    # New format: single tag
    stage2_markdown = _extract_tag_inner_text(stage2_raw_text, "stage2_markdown")
    if stage2_markdown and stage2_markdown.strip():
        return stage2_markdown.strip()

    # Backward compatibility: legacy nested tags
    stage2_block = _extract_xml_block(stage2_raw_text, "stage2_report")
    if stage2_block:
        report_body = _extract_tag_inner_text(stage2_block, "report_body")
        if report_body and report_body.strip():
            return report_body.strip()
        return stage2_block.strip()

    return stage2_raw_text.strip()


async def _generate_text(
    llm_settings: LLMRuntimeSettings,
    system_prompt: str,
    user_prompt: str,
    temperature: float,
) -> tuple[str, dict[str, Any], str, int]:
    response_text, response_payload, latency_ms = await asyncio.to_thread(
        invoke_llm_sync,
        settings=llm_settings,
        system_prompt=system_prompt,
        user_prompt=user_prompt,
        temperature=temperature,
        response_mime_type="text/plain",
    )
    if not response_text.strip():
        raise ValueError("模型返回为空。")
    return response_text, response_payload, response_text, latency_ms


async def _read_single_paper(
    paper: Paper,
    pdf_url: str,
    llm_settings: LLMRuntimeSettings,
    ocr_settings: MistralOCRSettings | None,
    stage1_system_prompt_template: str,
    stage1_user_prompt_template: str,
    stage2_system_prompt_template: str,
    stage2_user_prompt_template: str,
    stage1_temperature: float,
    stage2_temperature: float,
    workflow_execution: WorkflowExecution | None,
    stage_execution: WorkflowStageExecution | None,
    trigger_type: str,
    task_metadata: dict[str, Any],
) -> dict[str, Any]:
    invocation_stage1: LLMInvocationLog | None = None
    invocation_stage2: LLMInvocationLog | None = None

    with TemporaryDirectory(prefix="deeplab-paper-read-", dir="/tmp") as tmp_dir:
        pdf_path = Path(tmp_dir) / f"{paper.id}.pdf"
        await asyncio.to_thread(_download_pdf, pdf_url, pdf_path)

        ocr_text, ocr_metadata = await extract_pdf_text(
            pdf_path=pdf_path,
            settings=ocr_settings,
        )
        ocr_prompt_text = ocr_text.strip()
        if not ocr_prompt_text.strip():
            raise ValueError("OCR 提取文本为空，无法继续精读。")
        ocr_provider = str(ocr_metadata.get("provider", "")).strip() or "unknown"
        ocr_model = str(ocr_metadata.get("model", "")).strip() or "unknown"

        stage1_system_prompt, stage1_user_prompt = _build_stage1_prompts(
            paper,
            ocr_prompt_text,
            stage1_system_prompt_template,
            stage1_user_prompt_template,
        )
        invocation_stage1 = await LLMInvocationLog.create(
            provider=llm_settings.provider,
            model=llm_settings.model,
            stage=STAGE_PAPER_READING,
            task=TASK_PAPER_READING_STAGE1,
            workflow=workflow_execution,
            stage_execution=stage_execution,
            input_payload={
                "provider": llm_settings.provider,
                "model": llm_settings.model,
                "base_url": llm_settings.base_url,
                "google_thinking_level": llm_settings.google_thinking_level,
                "paper_id": paper.id,
                "paper_title": paper.title,
                "pdf_url": pdf_url,
                "ocr_provider": ocr_provider,
                "ocr_model": ocr_model,
                "ocr_page_count": ocr_metadata.get("page_count"),
                "ocr_text_chars": len(ocr_text),
                "ocr_prompt_chars": len(ocr_prompt_text),
                "temperature": stage1_temperature,
                "system_prompt": stage1_system_prompt,
                "user_prompt_chars": len(stage1_user_prompt),
                "trigger_type": trigger_type,
            },
            metadata={"task_metadata": task_metadata},
            status="running",
        )
        try:
            stage1_raw_text, stage1_output_payload, stage1_output_text, stage1_latency = (
                await _generate_text(
                    llm_settings=llm_settings,
                    system_prompt=stage1_system_prompt,
                    user_prompt=stage1_user_prompt,
                    temperature=stage1_temperature,
                )
            )
            stage1_block = _extract_xml_block(stage1_raw_text, "stage1_result")
            stage1_content = stage1_block or stage1_raw_text.strip()
            if not stage1_content:
                raise ValueError("第一阶段输出为空。")
            invocation_stage1.status = "succeeded"
            invocation_stage1.output_payload = stage1_output_payload
            invocation_stage1.output_text = stage1_output_text
            invocation_stage1.latency_ms = stage1_latency
            await invocation_stage1.save(
                update_fields=["status", "output_payload", "output_text", "latency_ms"]
            )
        except Exception as exc:
            invocation_stage1.status = "failed"
            invocation_stage1.error_message = str(exc)
            await invocation_stage1.save(update_fields=["status", "error_message"])
            raise

        stage2_system_prompt, stage2_user_prompt = _build_stage2_prompts(
            paper,
            stage1_content,
            ocr_prompt_text,
            stage2_system_prompt_template,
            stage2_user_prompt_template,
        )
        invocation_stage2 = await LLMInvocationLog.create(
            provider=llm_settings.provider,
            model=llm_settings.model,
            stage=STAGE_PAPER_READING,
            task=TASK_PAPER_READING_STAGE2,
            workflow=workflow_execution,
            stage_execution=stage_execution,
            input_payload={
                "provider": llm_settings.provider,
                "model": llm_settings.model,
                "base_url": llm_settings.base_url,
                "google_thinking_level": llm_settings.google_thinking_level,
                "paper_id": paper.id,
                "paper_title": paper.title,
                "pdf_url": pdf_url,
                "ocr_provider": ocr_provider,
                "ocr_model": ocr_model,
                "ocr_page_count": ocr_metadata.get("page_count"),
                "ocr_text_chars": len(ocr_text),
                "ocr_prompt_chars": len(ocr_prompt_text),
                "temperature": stage2_temperature,
                "stage1_result_text": stage1_content,
                "system_prompt": stage2_system_prompt,
                "user_prompt_chars": len(stage2_user_prompt),
                "trigger_type": trigger_type,
            },
            metadata={"task_metadata": task_metadata},
            status="running",
        )
        try:
            stage2_raw_text, stage2_output_payload, stage2_output_text, stage2_latency = (
                await _generate_text(
                    llm_settings=llm_settings,
                    system_prompt=stage2_system_prompt,
                    user_prompt=stage2_user_prompt,
                    temperature=stage2_temperature,
                )
            )
            stage2_candidate = _extract_stage2_candidate_text(stage2_raw_text)
            stage2_content = normalize_stage2_markdown_text(stage2_candidate)
            if not stage2_content:
                raise ValueError("第二阶段输出为空。")
            invocation_stage2.status = "succeeded"
            invocation_stage2.output_payload = stage2_output_payload
            invocation_stage2.output_text = stage2_output_text
            invocation_stage2.latency_ms = stage2_latency
            await invocation_stage2.save(
                update_fields=["status", "output_payload", "output_text", "latency_ms"]
            )
        except Exception as exc:
            invocation_stage2.status = "failed"
            invocation_stage2.error_message = str(exc)
            await invocation_stage2.save(update_fields=["status", "error_message"])
            raise

        return {
            "paper_id": paper.id,
            "stage1_content": stage1_content,
            "stage2_content": stage2_content,
            "invocation_stage1_id": invocation_stage1.id if invocation_stage1 else None,
            "invocation_stage2_id": invocation_stage2.id if invocation_stage2 else None,
        }


async def _resolve_target_papers(
    paper_ids: list[str] | None,
    source_filtering_run: PaperFilteringRun | None,
) -> tuple[list[Paper], PaperFilteringRun | None]:
    source_run = source_filtering_run
    target_ids = [item.strip() for item in (paper_ids or []) if item and item.strip()]

    if not target_ids:
        if source_run is None:
            source_run = (
                await PaperFilteringRun.filter(status="succeeded")
                .order_by("-started_at")
                .first()
            )
        if source_run is None:
            raise ValueError("没有可用的初筛结果，请先执行初筛。")
        target_ids = [str(item).strip() for item in (source_run.selected_paper_ids or []) if str(item).strip()]

    if not target_ids:
        raise ValueError("初筛结果为空，没有需要精读的论文。")

    query = Paper.filter(id__in=target_ids)
    papers = await query.all()
    if not papers:
        raise ValueError("未找到待精读论文，请检查论文 ID。")

    order_map = {paper_id: idx for idx, paper_id in enumerate(target_ids)}
    papers.sort(key=lambda item: order_map.get(item.id, 10**9))
    return papers, source_run


async def run_paper_reading(
    paper_ids: list[str] | None = None,
    trigger_type: str = "manual",
    workflow_execution: WorkflowExecution | None = None,
    stage_execution: WorkflowStageExecution | None = None,
    source_filtering_run: PaperFilteringRun | None = None,
    task_metadata: dict[str, Any] | None = None,
) -> dict[str, Any]:
    task_metadata = task_metadata or {}
    paper_pdf_url_by_id: dict[str, str] = {}
    raw_pdf_url_map = task_metadata.get("paperPdfUrlMap")
    if isinstance(raw_pdf_url_map, dict):
        for key, value in raw_pdf_url_map.items():
            paper_id = str(key or "").strip()
            pdf_url = str(value or "").strip()
            if paper_id and pdf_url:
                paper_pdf_url_by_id[paper_id] = pdf_url

    papers, source_run = await _resolve_target_papers(paper_ids, source_filtering_run)
    paper_ids_in_order = [paper.id for paper in papers]
    paper_title_by_id = {paper.id: paper.title for paper in papers}

    existing_reports = (
        await PaperReadingReport.filter(
            paper_id__in=paper_ids_in_order,
            status="succeeded",
        )
        .order_by("-created_at")
        .all()
    )
    existing_report_by_paper_id: dict[str, PaperReadingReport] = {}
    for report in existing_reports:
        if report.paper_id not in existing_report_by_paper_id:
            existing_report_by_paper_id[report.paper_id] = report

    papers_to_generate = [paper for paper in papers if paper.id not in existing_report_by_paper_id]
    reused_paper_ids = [paper.id for paper in papers if paper.id in existing_report_by_paper_id]

    llm_settings = await get_llm_runtime_settings()
    (
        stage1_system_prompt_template,
        stage1_user_prompt_template,
        stage2_system_prompt_template,
        stage2_user_prompt_template,
    ) = await _get_reading_prompt_templates()
    stage1_temperature, stage2_temperature = await _get_reading_temperatures()
    await _mark_workflow_llm_usage(
        workflow_execution,
        provider=llm_settings.provider,
        model=llm_settings.model,
        stage1_temperature=stage1_temperature,
        stage2_temperature=stage2_temperature,
        google_thinking_level=llm_settings.google_thinking_level,
    )
    ocr_settings = await _get_mistral_runtime_settings()

    reading_run = await PaperReadingRun.create(
        trigger_type=trigger_type,
        status="running",
        workflow=workflow_execution,
        stage_execution=stage_execution,
        source_filtering_run=source_run,
        paper_ids=paper_ids_in_order,
    )

    succeeded_ids: list[str] = []
    failed_ids: list[str] = []
    reports: list[dict[str, Any]] = [
        {
            "report_id": str(existing_report_by_paper_id[paper_id].id),
            "paper_id": paper_id,
            "title": paper_title_by_id.get(paper_id, ""),
            "reused": True,
        }
        for paper_id in reused_paper_ids
    ]

    try:
        if not papers_to_generate:
            reading_run.status = "succeeded"
            reading_run.succeeded_paper_ids = []
            reading_run.failed_paper_ids = []
            reading_run.finished_at = datetime.now(tz=UTC)
            await reading_run.save(
                update_fields=[
                    "status",
                    "succeeded_paper_ids",
                    "failed_paper_ids",
                    "finished_at",
                ]
            )
            return {
                "run_id": str(reading_run.id),
                "source_filtering_run_id": str(source_run.id) if source_run else None,
                "paper_count": len(papers),
                "succeeded_count": 0,
                "failed_count": 0,
                "reused_count": len(reused_paper_ids),
                "succeeded_paper_ids": [],
                "failed_paper_ids": [],
                "reused_paper_ids": reused_paper_ids,
                "reports": reports,
            }

        for paper in papers_to_generate:
            try:
                result = await _read_single_paper(
                    paper=paper,
                    pdf_url=_resolve_paper_pdf_url(paper, paper_pdf_url_by_id),
                    llm_settings=llm_settings,
                    ocr_settings=ocr_settings,
                    stage1_system_prompt_template=stage1_system_prompt_template,
                    stage1_user_prompt_template=stage1_user_prompt_template,
                    stage2_system_prompt_template=stage2_system_prompt_template,
                    stage2_user_prompt_template=stage2_user_prompt_template,
                    stage1_temperature=stage1_temperature,
                    stage2_temperature=stage2_temperature,
                    workflow_execution=workflow_execution,
                    stage_execution=stage_execution,
                    trigger_type=trigger_type,
                    task_metadata=task_metadata,
                )
                stage1_content = str(result["stage1_content"]).strip()
                stage2_content = str(result["stage2_content"]).strip()
                report = await PaperReadingReport.create(
                    reading_run=reading_run,
                    paper=paper,
                    llm_invocation_stage1_id=result["invocation_stage1_id"],
                    llm_invocation_stage2_id=result["invocation_stage2_id"],
                    status="succeeded",
                    stage1_overview=stage1_content,
                    stage1_outline=[],
                    stage1_questions=[],
                    overview=stage2_content,
                    method_details="",
                    experiment_analysis="",
                    qa_answers="",
                    review="",
                    related_readings=[],
                    full_report=stage2_content,
                    comment="",
                )
                succeeded_ids.append(paper.id)
                reports.append(
                    {
                        "report_id": str(report.id),
                        "paper_id": paper.id,
                        "title": paper.title,
                        "reused": False,
                    }
                )
            except Exception:
                failed_ids.append(paper.id)
                logger.exception("精读失败: paper_id=%s", paper.id)

        if failed_ids and (succeeded_ids or reused_paper_ids):
            reading_run.status = "partial_succeeded"
        elif succeeded_ids:
            reading_run.status = "succeeded"
        else:
            reading_run.status = "failed"
            reading_run.error_message = (
                "本次触发中所有待生成论文均精读失败，且不存在可复用的历史报告。"
            )

        reading_run.succeeded_paper_ids = succeeded_ids
        reading_run.failed_paper_ids = failed_ids
        reading_run.finished_at = datetime.now(tz=UTC)
        await reading_run.save(
            update_fields=[
                "status",
                "succeeded_paper_ids",
                "failed_paper_ids",
                "error_message",
                "finished_at",
            ]
        )

        if not succeeded_ids and not reused_paper_ids:
            raise RuntimeError("精读阶段失败：没有成功生成任何报告。")

        return {
            "run_id": str(reading_run.id),
            "source_filtering_run_id": str(source_run.id) if source_run else None,
            "paper_count": len(papers),
            "succeeded_count": len(succeeded_ids),
            "failed_count": len(failed_ids),
            "reused_count": len(reused_paper_ids),
            "succeeded_paper_ids": succeeded_ids,
            "failed_paper_ids": failed_ids,
            "reused_paper_ids": reused_paper_ids,
            "reports": reports,
        }
    except Exception as exc:
        if reading_run.status == "running":
            reading_run.status = "failed"
            reading_run.error_message = str(exc)
            reading_run.failed_paper_ids = [paper.id for paper in papers_to_generate]
            reading_run.finished_at = datetime.now(tz=UTC)
            await reading_run.save(
                update_fields=["status", "error_message", "failed_paper_ids", "finished_at"]
            )
        raise
