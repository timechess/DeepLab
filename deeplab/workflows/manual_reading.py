import asyncio
import hashlib
import logging
import re
from datetime import UTC, datetime
from typing import Any
from urllib import request
from urllib.error import HTTPError, URLError
from urllib.parse import urlparse

from deeplab.daily_papers.paper_collection import (
    collect_and_persist_paper_by_arxiv_id,
    collect_and_persist_paper_by_id,
)
from deeplab.daily_papers.paper_reading import STAGE_PAPER_READING, run_paper_reading
from deeplab.model import Paper, PaperReadingReport, WorkflowExecution, WorkflowStageExecution
from deeplab.workflows.common import finish_stage, finish_workflow

logger = logging.getLogger(__name__)

WORKFLOW_NAME_READING_REPORT_GENERATION = "reading_report_generation"
PDF_PROBE_TIMEOUT_SECONDS = 20


def normalize_arxiv_id(raw: str) -> str:
    text = str(raw).strip()
    if not text:
        raise ValueError("paperId 不能为空。")

    text = re.sub(r"^arxiv\s*:\s*", "", text, flags=re.IGNORECASE).strip()
    text = text.replace("http://", "https://", 1)

    match = re.search(r"arxiv\.org/(abs|pdf)/([^?#]+)", text, flags=re.IGNORECASE)
    if match:
        text = match.group(2)

    text = text.strip().strip("/")
    if text.lower().endswith(".pdf"):
        text = text[:-4]
    text = re.sub(r"^(abs|pdf)/", "", text, flags=re.IGNORECASE).strip()

    if not text:
        raise ValueError("paperId 格式无效。")
    return text


def normalize_text_field(value: str | None, *, field_name: str, required: bool = False) -> str:
    text = str(value or "").strip()
    if required and not text:
        raise ValueError(f"{field_name} 不能为空。")
    return text


def normalize_text_list(
    values: list[str] | None,
    *,
    field_name: str,
    min_items: int = 0,
) -> list[str]:
    normalized: list[str] = []
    for item in values or []:
        text = str(item or "").strip()
        if text:
            normalized.append(text)
    if len(normalized) < min_items:
        raise ValueError(f"{field_name} 至少需要 {min_items} 项。")
    return normalized


def to_utc_datetime(value: datetime | None) -> datetime:
    if value is None:
        return datetime.now(tz=UTC)
    if value.tzinfo is None:
        return value.replace(tzinfo=UTC)
    return value.astimezone(UTC)


def parse_http_url(value: str) -> str | None:
    text = str(value or "").strip()
    if not text:
        return None
    parsed = urlparse(text)
    scheme = parsed.scheme.lower()
    if scheme not in {"http", "https"}:
        return None
    if not parsed.netloc:
        return None
    return parsed.geturl()


def is_arxiv_host(hostname: str) -> bool:
    host = str(hostname or "").lower().split(":", 1)[0]
    return host == "arxiv.org" or host.endswith(".arxiv.org")


def classify_manual_paper_input(raw: str) -> tuple[str, str]:
    direct_url = parse_http_url(raw)
    if direct_url:
        parsed = urlparse(direct_url)
        if is_arxiv_host(parsed.netloc) and re.search(
            r"^/(abs|pdf)/",
            parsed.path or "",
            flags=re.IGNORECASE,
        ):
            return "arxiv", normalize_arxiv_id(direct_url)
        return "pdf_url", direct_url
    return "arxiv", normalize_arxiv_id(raw)


def build_external_pdf_paper_id(pdf_url: str) -> str:
    digest = hashlib.sha1(pdf_url.encode("utf-8")).hexdigest()
    return f"pdf_{digest[:28]}"


def probe_downloadable_pdf(pdf_url: str) -> None:
    req = request.Request(
        url=pdf_url,
        method="GET",
        headers={
            "User-Agent": "DeepLab/0.1 (manual-read-pdf-probe)",
            "Range": "bytes=0-2047",
        },
    )
    with request.urlopen(req, timeout=PDF_PROBE_TIMEOUT_SECONDS) as response:
        status = getattr(response, "status", response.getcode())
        if status not in (200, 206):
            raise ValueError(f"PDF 地址不可访问，HTTP {status}。")

        content_type = str(response.headers.get("Content-Type", "")).lower()
        prefix = response.read(8)
        is_pdf = "application/pdf" in content_type or prefix.startswith(b"%PDF-")
        if not is_pdf:
            raise ValueError("该 URL 返回内容不是 PDF，请检查链接。")


async def find_latest_succeeded_report_for_paper(paper_id: str) -> PaperReadingReport | None:
    return (
        await PaperReadingReport.filter(paper_id=paper_id, status="succeeded")
        .order_by("-created_at")
        .select_related("paper")
        .first()
    )


def deduplicated_read_response(
    *,
    paper_id: str,
    report: PaperReadingReport,
) -> dict[str, Any]:
    return {
        "paper_id": paper_id,
        "title": report.paper.title if report.paper else "",
        "workflow_id": None,
        "report_id": str(report.id),
        "deduplicated": True,
        "requires_metadata": False,
        "message": "该论文已有精读报告，已返回历史结果。",
    }


async def trigger_single_paper_reading_workflow(
    *,
    paper_id: str,
    title: str,
    trigger_type: str,
    metadata: dict[str, Any],
    workflow_context: dict[str, Any],
    task_metadata_extra: dict[str, Any] | None = None,
) -> dict[str, Any]:
    workflow = await WorkflowExecution.create(
        workflow_name=WORKFLOW_NAME_READING_REPORT_GENERATION,
        trigger_type=trigger_type,
        status="running",
        context=workflow_context,
    )
    stage = await WorkflowStageExecution.create(
        workflow=workflow,
        stage=STAGE_PAPER_READING,
        status="running",
        input_payload={"paperIds": [paper_id], "sourceFilteringRunId": None},
    )

    run_task_metadata = dict(metadata)
    if task_metadata_extra:
        run_task_metadata.update(task_metadata_extra)

    async def _runner() -> None:
        try:
            result = await run_paper_reading(
                paper_ids=[paper_id],
                trigger_type=trigger_type,
                workflow_execution=workflow,
                stage_execution=stage,
                source_filtering_run=None,
                task_metadata=run_task_metadata,
            )
            await finish_stage(stage, status="succeeded", output_payload=result)
            await finish_workflow(workflow, status="succeeded")
        except Exception as exc:
            await finish_stage(stage, status="failed", error_message=str(exc))
            await finish_workflow(workflow, status="failed", error_message=str(exc))
            logger.exception("Manual paper reading failed, paper_id=%s", paper_id)

    asyncio.create_task(_runner())
    return {
        "paper_id": paper_id,
        "title": title,
        "workflow_id": str(workflow.id),
        "report_id": None,
        "deduplicated": False,
        "requires_metadata": False,
        "message": "已创建精读工作流，正在后台生成报告。",
    }


async def trigger_arxiv_paper_reading_workflow(
    *,
    requested_paper_id: str,
    trigger_type: str,
    metadata: dict[str, Any],
) -> dict[str, Any]:
    existing_paper = await Paper.get_or_none(id=requested_paper_id)
    display_title = existing_paper.title if existing_paper else requested_paper_id

    workflow = await WorkflowExecution.create(
        workflow_name=WORKFLOW_NAME_READING_REPORT_GENERATION,
        trigger_type=trigger_type,
        status="running",
        context={
            "manualReadByArxivId": True,
            "manualInputType": "arxiv",
            "paperId": requested_paper_id,
            "requestedPaperId": requested_paper_id,
            "metadata": metadata,
        },
    )
    stage = await WorkflowStageExecution.create(
        workflow=workflow,
        stage=STAGE_PAPER_READING,
        status="running",
        input_payload={
            "paperIds": [requested_paper_id],
            "requestedPaperId": requested_paper_id,
            "sourceFilteringRunId": None,
        },
    )

    run_task_metadata = dict(metadata)

    async def _runner() -> None:
        resolved_paper_id = requested_paper_id
        try:
            persisted, metadata_source = await collect_arxiv_paper_with_fallback(requested_paper_id)
            resolved_paper_id = str(persisted.get("id") or requested_paper_id).strip() or requested_paper_id

            if resolved_paper_id != requested_paper_id:
                stage.input_payload = {
                    "paperIds": [resolved_paper_id],
                    "requestedPaperId": requested_paper_id,
                    "sourceFilteringRunId": None,
                }
                await stage.save(update_fields=["input_payload"])

            context = dict(workflow.context or {})
            context["metadataSource"] = metadata_source
            context["paperId"] = resolved_paper_id
            context["requestedPaperId"] = requested_paper_id
            workflow.context = context
            await workflow.save(update_fields=["context"])

            result = await run_paper_reading(
                paper_ids=[resolved_paper_id],
                trigger_type=trigger_type,
                workflow_execution=workflow,
                stage_execution=stage,
                source_filtering_run=None,
                task_metadata=run_task_metadata,
            )
            await finish_stage(stage, status="succeeded", output_payload=result)
            await finish_workflow(workflow, status="succeeded")
        except Exception as exc:
            await finish_stage(stage, status="failed", error_message=str(exc))
            await finish_workflow(workflow, status="failed", error_message=str(exc))
            logger.exception(
                "Manual arXiv paper reading failed, requested=%s resolved=%s",
                requested_paper_id,
                resolved_paper_id,
            )

    asyncio.create_task(_runner())
    return {
        "paper_id": requested_paper_id,
        "title": display_title,
        "workflow_id": str(workflow.id),
        "report_id": None,
        "deduplicated": False,
        "requires_metadata": False,
        "resolved_input_type": "arxiv",
        "message": "已提交精读任务，正在后台准备并生成报告。",
    }


async def collect_arxiv_paper_with_fallback(paper_id: str) -> tuple[dict[str, Any], str]:
    try:
        return await collect_and_persist_paper_by_id(paper_id), "huggingface"
    except HTTPError as exc:
        if exc.code != 404:
            raise
    except (URLError, ValueError):
        logger.warning("Fetch paper metadata from Hugging Face failed, fallback to arXiv: %s", paper_id)
    except Exception:
        logger.exception("Unexpected Hugging Face metadata error, fallback to arXiv: %s", paper_id)

    return await collect_and_persist_paper_by_arxiv_id(paper_id), "arxiv_api"
