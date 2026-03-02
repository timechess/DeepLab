import asyncio
import logging
import os
import re
import uuid
from contextlib import asynccontextmanager, suppress
from datetime import UTC, datetime, timedelta
from typing import Any
from urllib.error import HTTPError
from urllib.parse import quote_plus

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, ConfigDict, Field
from tortoise.contrib.fastapi import RegisterTortoise
from dotenv import load_dotenv

from deeplab.daily_papers.paper_collection import (
    collect_and_persist_paper_by_id,
    collect_and_persist_papers,
)
from deeplab.daily_papers.paper_filtering import (
    STAGE_PAPER_FILTERING,
    WORKFLOW_NAME_DAILY_PAPER_REPORTS,
    run_initial_screening,
)
from deeplab.daily_papers.paper_reading import (
    STAGE_PAPER_READING,
    normalize_stage2_markdown_text,
    run_paper_reading,
)
from deeplab.knowledge_base.embedding import (
    get_embedding_download_status,
    set_embedding_model_name,
    start_embedding_download,
    sync_embedding_model_from_runtime_settings,
)
from deeplab.knowledge_base.service import (
    create_manual_knowledge_question,
    delete_knowledge_question,
    get_knowledge_question_detail,
    get_reading_report_knowledge_payload,
    list_knowledge_questions,
    trigger_report_knowledge_extraction,
    update_knowledge_question,
)
from deeplab.model import (
    Paper,
    PaperFilteringRun,
    PaperReadingReport,
    RuntimeSetting,
    ScreeningRule,
    WorkflowExecution,
    WorkflowStageExecution,
)
from deeplab.runtime_settings import (
    default_runtime_setting_value,
    is_runtime_setting_key_supported,
    list_runtime_setting_keys,
    runtime_setting_spec,
)

load_dotenv()

logger = logging.getLogger(__name__)
STAGE_PAPER_COLLECTION = "paper_collection"
WORKFLOW_NAME_READING_REPORT_GENERATION = "reading_report_generation"
CHINA_UTC_OFFSET = timedelta(hours=8)
_DAILY_WORKFLOW_TRIGGER_LOCK = asyncio.Lock()


def _build_postgres_dsn() -> str:
    user = os.getenv("POSTGRES_USER", "postgres")
    password = os.getenv("POSTGRES_PASSWORD", "")
    host = os.getenv("POSTGRES_HOST", "127.0.0.1")
    port = os.getenv("POSTGRES_PORT", "5432")
    db_name = os.getenv("POSTGRES_DB", "deeplab")
    return f"postgres://{quote_plus(user)}:{quote_plus(password)}@{host}:{port}/{quote_plus(db_name)}"


def _normalize_arxiv_id(raw: str) -> str:
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


def _seconds_until_next_daily_utc_run(now: datetime | None = None) -> float:
    current = now or datetime.now(tz=UTC)
    next_run = current.replace(hour=0, minute=0, second=0, microsecond=0)
    if current >= next_run:
        next_run += timedelta(days=1)
    return (next_run - current).total_seconds()


def _china_day_window_utc(now: datetime | None = None) -> tuple[datetime, datetime, str]:
    current_utc = now or datetime.now(tz=UTC)
    china_now = current_utc + CHINA_UTC_OFFSET
    china_day_start_utc = (
        china_now.replace(hour=0, minute=0, second=0, microsecond=0) - CHINA_UTC_OFFSET
    )
    china_day_end_utc = china_day_start_utc + timedelta(days=1)
    return china_day_start_utc, china_day_end_utc, china_now.date().isoformat()


async def _find_latest_daily_workflow(
    *,
    start_utc: datetime,
    end_utc: datetime,
    statuses: tuple[str, ...],
) -> WorkflowExecution | None:
    return (
        await WorkflowExecution.filter(
            workflow_name=WORKFLOW_NAME_DAILY_PAPER_REPORTS,
            started_at__gte=start_utc,
            started_at__lt=end_utc,
            status__in=list(statuses),
        )
        .order_by("-started_at")
        .first()
    )


async def _prepare_daily_workflow_execution(
    trigger_type: str,
    context: dict[str, Any] | None = None,
) -> tuple[WorkflowExecution, bool, str | None]:
    day_start_utc, day_end_utc, business_date_cst = _china_day_window_utc()

    async with _DAILY_WORKFLOW_TRIGGER_LOCK:
        running = await _find_latest_daily_workflow(
            start_utc=day_start_utc,
            end_utc=day_end_utc,
            statuses=("running",),
        )
        if running is not None:
            return running, False, "running"

        succeeded = await _find_latest_daily_workflow(
            start_utc=day_start_utc,
            end_utc=day_end_utc,
            statuses=("succeeded",),
        )
        if succeeded is not None and await _workflow_has_complete_daily_outputs(succeeded):
            return succeeded, False, "succeeded"

        resumable = (
            await WorkflowExecution.filter(
                workflow_name=WORKFLOW_NAME_DAILY_PAPER_REPORTS,
                started_at__gte=day_start_utc,
                started_at__lt=day_end_utc,
                status__in=["failed", "succeeded"],
            )
            .order_by("-started_at")
            .first()
        )
        if resumable is not None:
            if await _workflow_has_complete_daily_outputs(resumable):
                return resumable, False, "succeeded"

            resumable_context = dict(resumable.context or {})
            resumable_context.setdefault("businessDateCST", business_date_cst)
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
        workflow_context.setdefault("businessDateCST", business_date_cst)
        workflow_context.setdefault(
            "businessDateWindowUTC",
            {"start": day_start_utc.isoformat(), "end": day_end_utc.isoformat()},
        )

        workflow = await WorkflowExecution.create(
            workflow_name=WORKFLOW_NAME_DAILY_PAPER_REPORTS,
            trigger_type=trigger_type,
            status="running",
            context=workflow_context,
        )
        return workflow, True, None


async def _daily_fetch_loop(stop_event: asyncio.Event) -> None:
    # 北京时间 08:00 == UTC 00:00
    while not stop_event.is_set():
        wait_seconds = _seconds_until_next_daily_utc_run()
        next_run = datetime.now(tz=UTC) + timedelta(seconds=wait_seconds)
        logger.info("Next scheduled fetch at %s (UTC)", next_run.isoformat())

        try:
            await asyncio.wait_for(stop_event.wait(), timeout=wait_seconds)
            break
        except asyncio.TimeoutError:
            try:
                workflow_result = await run_daily_workflow(
                    trigger_type="scheduled",
                    context={"scheduleUtc": "00:00"},
                )
                if workflow_result.get("deduplicated"):
                    logger.info(
                        "Scheduled workflow deduplicated, reason=%s workflow_id=%s status=%s",
                        workflow_result.get("dedupe_reason"),
                        workflow_result["workflow_id"],
                        workflow_result.get("workflow_status"),
                    )
                else:
                    collection_count = (
                        workflow_result.get("collection", {}).get("count")
                        if isinstance(workflow_result.get("collection"), dict)
                        else None
                    )
                    filtering_payload = workflow_result.get("filtering", {})
                    filtering_count = (
                        filtering_payload.get("selected_count")
                        if isinstance(filtering_payload, dict)
                        else None
                    )
                    if filtering_count is None and isinstance(filtering_payload, dict):
                        selected_ids = filtering_payload.get("selected_ids", [])
                        filtering_count = len(selected_ids) if isinstance(selected_ids, list) else None
                    reading_payload = workflow_result.get("reading", {})
                    reading_succeeded = (
                        reading_payload.get("succeeded_count")
                        if isinstance(reading_payload, dict)
                        else None
                    )
                    logger.info(
                        "Scheduled workflow finished, collected=%s selected=%s read_succeeded=%s workflow_id=%s",
                        collection_count,
                        filtering_count,
                        reading_succeeded,
                        workflow_result["workflow_id"],
                    )
            except Exception:
                logger.exception("Scheduled workflow failed")


def _rule_to_dict(rule: ScreeningRule) -> dict[str, Any]:
    return {
        "id": rule.id,
        "rule": rule.rule,
        "createdBy": rule.created_by,
        "createdAt": rule.created_at.isoformat(),
    }


def _runtime_setting_to_dict(
    key: str,
    setting: RuntimeSetting | None,
) -> dict[str, Any]:
    spec = runtime_setting_spec(key)
    if setting is None:
        value = default_runtime_setting_value(key)
        source = "default" if value else "unset"
        created_at = None
        updated_at = None
    else:
        value = setting.value
        source = "database"
        created_at = setting.created_at.isoformat()
        updated_at = setting.updated_at.isoformat()

    return {
        "key": key,
        "label": spec["label"],
        "description": spec["description"],
        "isSecret": bool(spec["is_secret"]),
        "value": value,
        "source": source,
        "createdAt": created_at,
        "updatedAt": updated_at,
    }


def _workflow_to_dict(workflow: WorkflowExecution) -> dict[str, Any]:
    return {
        "id": str(workflow.id),
        "workflowName": workflow.workflow_name,
        "triggerType": workflow.trigger_type,
        "status": workflow.status,
        "context": workflow.context,
        "errorMessage": workflow.error_message,
        "startedAt": workflow.started_at.isoformat(),
        "finishedAt": workflow.finished_at.isoformat() if workflow.finished_at else None,
    }


def _stage_to_dict(stage: WorkflowStageExecution) -> dict[str, Any]:
    return {
        "id": str(stage.id),
        "workflowId": str(stage.workflow_id),
        "stage": stage.stage,
        "status": stage.status,
        "inputPayload": stage.input_payload,
        "outputPayload": stage.output_payload,
        "errorMessage": stage.error_message,
        "startedAt": stage.started_at.isoformat(),
        "finishedAt": stage.finished_at.isoformat() if stage.finished_at else None,
    }


def _normalize_collection_result(payload: dict[str, Any] | None) -> dict[str, Any] | None:
    if not isinstance(payload, dict):
        return None
    papers_raw = payload.get("papers")
    if not isinstance(papers_raw, list):
        return None

    papers: list[dict[str, str]] = []
    for item in papers_raw:
        if not isinstance(item, dict):
            continue
        paper_id = str(item.get("id", "")).strip()
        if not paper_id:
            continue
        papers.append(
            {
                "id": paper_id,
                "title": str(item.get("title", "") or ""),
            }
        )
    return {"count": len(papers), "papers": papers}


def _extract_collection_candidate_ids(collection: dict[str, Any]) -> list[str]:
    papers = collection.get("papers")
    if not isinstance(papers, list):
        return []
    return [item["id"] for item in papers if isinstance(item, dict) and item.get("id")]


async def _filter_newly_collected_candidate_ids(
    *,
    candidate_ids: list[str],
    workflow_started_at: datetime,
) -> list[str]:
    clean_ids = [paper_id.strip() for paper_id in candidate_ids if paper_id and paper_id.strip()]
    if not clean_ids:
        return []

    recent_ids = set(
        await Paper.filter(
            id__in=clean_ids,
            collected_at__gte=workflow_started_at,
        ).values_list("id", flat=True)
    )
    return [paper_id for paper_id in clean_ids if paper_id in recent_ids]


def _normalize_filtering_result(payload: dict[str, Any] | None) -> dict[str, Any] | None:
    if not isinstance(payload, dict):
        return None
    selected_ids_raw = payload.get("selected_ids")
    if not isinstance(selected_ids_raw, list):
        return None
    selected_ids = [str(item).strip() for item in selected_ids_raw if str(item).strip()]
    normalized = dict(payload)
    normalized["selected_ids"] = selected_ids
    return normalized


def _normalize_reading_result(payload: dict[str, Any] | None) -> dict[str, Any] | None:
    if not isinstance(payload, dict):
        return None
    reports = payload.get("reports")
    if not isinstance(reports, list):
        return None
    return dict(payload)


def _is_reading_result_compatible(
    reading_result: dict[str, Any],
    filtering_result: dict[str, Any],
) -> bool:
    source_filtering_run_id = str(reading_result.get("source_filtering_run_id") or "").strip()
    filtering_run_id = str(filtering_result.get("run_id") or "").strip()
    if source_filtering_run_id and filtering_run_id and source_filtering_run_id != filtering_run_id:
        return False
    return True


async def _get_latest_succeeded_stage_payload(
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


async def _workflow_has_complete_daily_outputs(workflow: WorkflowExecution) -> bool:
    collection = _normalize_collection_result(
        await _get_latest_succeeded_stage_payload(workflow, STAGE_PAPER_COLLECTION)
    )
    if collection is None:
        return False

    filtering = _normalize_filtering_result(
        await _get_latest_succeeded_stage_payload(workflow, STAGE_PAPER_FILTERING)
    )
    if filtering is None:
        return False

    reading = _normalize_reading_result(
        await _get_latest_succeeded_stage_payload(workflow, STAGE_PAPER_READING)
    )
    if reading is None:
        return False

    return _is_reading_result_compatible(reading, filtering)


def _paper_to_dict(paper: Paper, *, include_long_text: bool = False) -> dict[str, Any]:
    data: dict[str, Any] = {
        "id": paper.id,
        "title": paper.title,
        "authors": paper.authors or [],
        "organization": paper.organization,
        "aiKeywords": paper.ai_keywords or [],
        "upvotes": paper.upvotes,
        "githubRepo": paper.github_repo,
        "githubStars": paper.github_stars,
        "publishedAt": paper.published_at.isoformat(),
    }
    if include_long_text:
        data["summary"] = paper.summary
        data["aiSummary"] = paper.ai_summary
    return data


def _reading_report_to_dict(
    report: PaperReadingReport,
    *,
    include_full: bool = False,
) -> dict[str, Any]:
    paper = report.paper if hasattr(report, "paper") else None
    stage2_content = normalize_stage2_markdown_text(report.full_report or "")
    data = {
        "id": str(report.id),
        "readingRunId": str(report.reading_run_id),
        "paperId": report.paper_id,
        "paperTitle": paper.title if paper else None,
        "status": report.status,
        "stage1Content": report.stage1_overview,
        "stage2Content": stage2_content,
        "comment": report.comment,
        "createdAt": report.created_at.isoformat(),
        "updatedAt": report.updated_at.isoformat(),
        "paperMeta": _paper_to_dict(paper, include_long_text=include_full) if paper else None,
    }
    if include_full:
        # Backward compatibility for old frontends.
        data["fullReport"] = stage2_content
    return data


async def _finish_stage(
    stage: WorkflowStageExecution,
    *,
    status: str,
    output_payload: dict[str, Any] | None = None,
    error_message: str | None = None,
) -> None:
    stage.status = status
    stage.output_payload = output_payload
    stage.error_message = error_message
    stage.finished_at = datetime.now(tz=UTC)
    await stage.save(update_fields=["status", "output_payload", "error_message", "finished_at"])


async def _finish_workflow(
    workflow: WorkflowExecution,
    *,
    status: str,
    error_message: str | None = None,
) -> None:
    workflow.status = status
    workflow.error_message = error_message
    workflow.finished_at = datetime.now(tz=UTC)
    await workflow.save(update_fields=["status", "error_message", "finished_at"])


async def _execute_daily_workflow(workflow: WorkflowExecution) -> dict[str, Any]:
    try:
        collection = _normalize_collection_result(
            await _get_latest_succeeded_stage_payload(workflow, STAGE_PAPER_COLLECTION)
        )
        if collection is None:
            collection_stage = await WorkflowStageExecution.create(
                workflow=workflow,
                stage=STAGE_PAPER_COLLECTION,
                status="running",
                input_payload={"source": "huggingface_daily_papers"},
            )
            try:
                collected = await collect_and_persist_papers()
                collection_payload = {
                    "count": len(collected),
                    "papers": collected,
                }
                await _finish_stage(
                    collection_stage,
                    status="succeeded",
                    output_payload=collection_payload,
                )
                collection = _normalize_collection_result(collection_payload)
                if collection is None:
                    raise RuntimeError("paper_collection 阶段成功但输出结构无效。")
            except Exception as exc:
                await _finish_stage(
                    collection_stage,
                    status="failed",
                    error_message=str(exc),
                )
                raise
        else:
            logger.info("Reusing paper_collection result, workflow_id=%s", workflow.id)

        filtering_result = _normalize_filtering_result(
            await _get_latest_succeeded_stage_payload(workflow, STAGE_PAPER_FILTERING)
        )
        filtering_reran = False
        if filtering_result is None:
            original_candidate_ids = _extract_collection_candidate_ids(collection)
            candidate_ids = await _filter_newly_collected_candidate_ids(
                candidate_ids=original_candidate_ids,
                workflow_started_at=workflow.started_at,
            )
            candidate_set = set(candidate_ids)
            excluded_existing_ids = [
                paper_id for paper_id in original_candidate_ids if paper_id not in candidate_set
            ]
            filtering_stage = await WorkflowStageExecution.create(
                workflow=workflow,
                stage=STAGE_PAPER_FILTERING,
                status="running",
                input_payload={
                    "originalCandidateIds": original_candidate_ids,
                    "originalCandidateCount": len(original_candidate_ids),
                    "candidateIds": candidate_ids,
                    "candidateCount": len(candidate_ids),
                    "excludedExistingIds": excluded_existing_ids,
                    "excludedExistingCount": len(excluded_existing_ids),
                },
            )
            try:
                if not candidate_ids:
                    filtering_result_raw = {
                        "run_id": None,
                        "llm_invocation_id": None,
                        "summary": "候选论文均已存在于数据库，已跳过初筛。",
                        "candidate_count": 0,
                        "selected_count": 0,
                        "selected_papers": [],
                        "candidate_ids": [],
                        "selected_ids": [],
                        "original_candidate_ids": original_candidate_ids,
                        "original_candidate_count": len(original_candidate_ids),
                        "excluded_existing_ids": excluded_existing_ids,
                        "excluded_existing_count": len(excluded_existing_ids),
                        "deduplicated_before_filtering": True,
                    }
                else:
                    filtering_result_raw = await run_initial_screening(
                        candidate_paper_ids=candidate_ids,
                        trigger_type="workflow",
                        workflow_execution=workflow,
                        stage_execution=filtering_stage,
                        task_metadata={
                            "workflow_name": WORKFLOW_NAME_DAILY_PAPER_REPORTS,
                            "original_candidate_count": len(original_candidate_ids),
                            "excluded_existing_count": len(excluded_existing_ids),
                        },
                    )
                    filtering_result_raw["original_candidate_ids"] = original_candidate_ids
                    filtering_result_raw["original_candidate_count"] = len(original_candidate_ids)
                    filtering_result_raw["excluded_existing_ids"] = excluded_existing_ids
                    filtering_result_raw["excluded_existing_count"] = len(excluded_existing_ids)
                    filtering_result_raw["deduplicated_before_filtering"] = True
                await _finish_stage(
                    filtering_stage,
                    status="succeeded",
                    output_payload=filtering_result_raw,
                )
                filtering_result = _normalize_filtering_result(filtering_result_raw)
                if filtering_result is None:
                    raise RuntimeError("paper_filtering 阶段成功但输出结构无效。")
                filtering_reran = True
            except Exception as exc:
                await _finish_stage(
                    filtering_stage,
                    status="failed",
                    error_message=str(exc),
                )
                raise
        else:
            logger.info("Reusing paper_filtering result, workflow_id=%s", workflow.id)

        source_filtering_run: PaperFilteringRun | None = None
        filtering_run_id = filtering_result.get("run_id")
        if filtering_run_id:
            source_filtering_run = await PaperFilteringRun.get_or_none(id=filtering_run_id)

        selected_ids = [item for item in filtering_result.get("selected_ids", []) if item]
        reading_result: dict[str, Any] | None = None
        if not filtering_reran:
            existing_reading = _normalize_reading_result(
                await _get_latest_succeeded_stage_payload(workflow, STAGE_PAPER_READING)
            )
            if existing_reading is not None and _is_reading_result_compatible(
                existing_reading, filtering_result
            ):
                reading_result = existing_reading
                logger.info("Reusing paper_reading result, workflow_id=%s", workflow.id)

        if reading_result is None:
            reading_stage = await WorkflowStageExecution.create(
                workflow=workflow,
                stage=STAGE_PAPER_READING,
                status="running",
                input_payload={
                    "selectedIds": selected_ids,
                    "selectedCount": len(selected_ids),
                },
            )
            try:
                if selected_ids:
                    reading_result_raw = await run_paper_reading(
                        paper_ids=selected_ids,
                        trigger_type="workflow",
                        workflow_execution=workflow,
                        stage_execution=reading_stage,
                        source_filtering_run=source_filtering_run,
                        task_metadata={"workflow_name": WORKFLOW_NAME_DAILY_PAPER_REPORTS},
                    )
                else:
                    reading_result_raw = {
                        "run_id": None,
                        "source_filtering_run_id": str(source_filtering_run.id)
                        if source_filtering_run
                        else None,
                        "paper_count": 0,
                        "succeeded_count": 0,
                        "failed_count": 0,
                        "succeeded_paper_ids": [],
                        "failed_paper_ids": [],
                        "reports": [],
                    }
                await _finish_stage(
                    reading_stage,
                    status="succeeded",
                    output_payload=reading_result_raw,
                )
                reading_result = _normalize_reading_result(reading_result_raw)
                if reading_result is None:
                    raise RuntimeError("paper_reading 阶段成功但输出结构无效。")
            except Exception as exc:
                await _finish_stage(
                    reading_stage,
                    status="failed",
                    error_message=str(exc),
                )
                raise

        await _finish_workflow(workflow, status="succeeded")
        return {
            "workflow_id": str(workflow.id),
            "collection": collection,
            "filtering": filtering_result,
            "reading": reading_result,
        }
    except Exception as exc:
        await _finish_workflow(workflow, status="failed", error_message=str(exc))
        raise


async def run_daily_workflow(
    trigger_type: str,
    context: dict[str, Any] | None = None,
) -> dict[str, Any]:
    workflow, should_execute, dedupe_reason = await _prepare_daily_workflow_execution(
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

    result = await _execute_daily_workflow(workflow)
    result["deduplicated"] = False
    return result


async def trigger_daily_workflow(trigger_type: str, context: dict[str, Any] | None = None) -> str:
    workflow, should_execute, dedupe_reason = await _prepare_daily_workflow_execution(
        trigger_type=trigger_type,
        context=context,
    )
    if not should_execute:
        logger.info(
            "Daily workflow trigger deduplicated, reason=%s workflow_id=%s status=%s",
            dedupe_reason,
            workflow.id,
            workflow.status,
        )
        return str(workflow.id)

    async def _runner() -> None:
        try:
            await _execute_daily_workflow(workflow)
        except Exception:
            logger.exception("Background daily workflow failed, workflow_id=%s", workflow.id)

    asyncio.create_task(_runner())
    return str(workflow.id)


class ScreeningRuleCreateRequest(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    rule: str = Field(min_length=1)
    created_by: str = Field(default="user", alias="createdBy", min_length=1, max_length=64)


class ScreeningRuleUpdateRequest(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    rule: str | None = None
    created_by: str | None = Field(default=None, alias="createdBy")


class ManualFilterRequest(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    candidate_ids: list[str] | None = Field(default=None, alias="candidateIds")
    trigger_type: str = Field(default="manual", alias="triggerType")
    metadata: dict[str, Any] = Field(default_factory=dict)


class ManualReadingRequest(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    paper_ids: list[str] | None = Field(default=None, alias="paperIds")
    source_filtering_run_id: str | None = Field(default=None, alias="sourceFilteringRunId")
    trigger_type: str = Field(default="manual", alias="triggerType")
    metadata: dict[str, Any] = Field(default_factory=dict)


class ManualReadByArxivIdRequest(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    paper_id: str = Field(alias="paperId", min_length=1)
    trigger_type: str = Field(default="manual", alias="triggerType")
    metadata: dict[str, Any] = Field(default_factory=dict)


class ReportCommentUpdateRequest(BaseModel):
    comment: str = ""


class RuntimeSettingUpdateRequest(BaseModel):
    value: str = ""


class KnowledgeQuestionCreateRequest(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    question: str = Field(min_length=1)
    created_by: str = Field(default="user", alias="createdBy", min_length=1, max_length=64)


class KnowledgeQuestionUpdateRequest(BaseModel):
    question: str = Field(min_length=1)


@asynccontextmanager
async def lifespan(app: FastAPI):
    async with RegisterTortoise(
        app=app,
        db_url=_build_postgres_dsn(),
        modules={"models": ["deeplab.model"]},
        generate_schemas=True,
        use_tz=True,
        timezone="UTC",
    ):
        stop_event = asyncio.Event()
        scheduler_task = asyncio.create_task(_daily_fetch_loop(stop_event))
        try:
            yield
        finally:
            stop_event.set()
            scheduler_task.cancel()
            with suppress(asyncio.CancelledError):
                await scheduler_task


app = FastAPI(title="DeepLab API", lifespan=lifespan)


@app.post("/fetch_papers")
@app.get("/fetch_papers")
async def fetch_papers() -> list[dict[str, str]]:
    try:
        return await collect_and_persist_papers()
    except Exception as exc:
        logger.exception("Manual fetch failed")
        raise HTTPException(status_code=500, detail="Failed to fetch papers") from exc


@app.get("/screening_rules")
async def list_screening_rules() -> list[dict[str, Any]]:
    rules = await ScreeningRule.all().order_by("-created_at", "-id")
    return [_rule_to_dict(rule) for rule in rules]


@app.post("/screening_rules")
async def create_screening_rule(payload: ScreeningRuleCreateRequest) -> dict[str, Any]:
    rule_text = payload.rule.strip()
    if not rule_text:
        raise HTTPException(status_code=400, detail="rule 不能为空。")
    rule = await ScreeningRule.create(rule=rule_text, created_by=payload.created_by.strip())
    return _rule_to_dict(rule)


@app.get("/screening_rules/{rule_id}")
async def get_screening_rule(rule_id: int) -> dict[str, Any]:
    rule = await ScreeningRule.get_or_none(id=rule_id)
    if rule is None:
        raise HTTPException(status_code=404, detail="Rule not found")
    return _rule_to_dict(rule)


@app.put("/screening_rules/{rule_id}")
async def update_screening_rule(
    rule_id: int, payload: ScreeningRuleUpdateRequest
) -> dict[str, Any]:
    rule = await ScreeningRule.get_or_none(id=rule_id)
    if rule is None:
        raise HTTPException(status_code=404, detail="Rule not found")

    updates: list[str] = []
    if payload.rule is not None:
        value = payload.rule.strip()
        if not value:
            raise HTTPException(status_code=400, detail="rule 不能为空。")
        rule.rule = value
        updates.append("rule")
    if payload.created_by is not None:
        value = payload.created_by.strip()
        if not value:
            raise HTTPException(status_code=400, detail="createdBy 不能为空。")
        rule.created_by = value
        updates.append("created_by")

    if not updates:
        raise HTTPException(status_code=400, detail="没有可更新的字段。")

    await rule.save(update_fields=updates)
    return _rule_to_dict(rule)


@app.delete("/screening_rules/{rule_id}")
async def delete_screening_rule(rule_id: int) -> dict[str, bool]:
    deleted = await ScreeningRule.filter(id=rule_id).delete()
    if deleted == 0:
        raise HTTPException(status_code=404, detail="Rule not found")
    return {"deleted": True}


@app.get("/runtime_settings")
async def list_runtime_settings() -> list[dict[str, Any]]:
    keys = list_runtime_setting_keys()
    rows = await RuntimeSetting.filter(key__in=keys).all()
    by_key = {row.key: row for row in rows}
    return [_runtime_setting_to_dict(key, by_key.get(key)) for key in keys]


@app.put("/runtime_settings/{key}")
async def update_runtime_setting(
    key: str, payload: RuntimeSettingUpdateRequest
) -> dict[str, Any]:
    normalized_key = key.strip()
    if not is_runtime_setting_key_supported(normalized_key):
        raise HTTPException(status_code=404, detail="Runtime setting key not found")

    value = payload.value
    if normalized_key == "knowledge_embedding_model":
        try:
            set_embedding_model_name(value)
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc

    setting, _ = await RuntimeSetting.update_or_create(
        key=normalized_key,
        defaults={"value": value},
    )
    if normalized_key == "knowledge_embedding_model":
        try:
            await sync_embedding_model_from_runtime_settings()
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
    return _runtime_setting_to_dict(normalized_key, setting)


@app.delete("/runtime_settings/{key}")
async def delete_runtime_setting(key: str) -> dict[str, Any]:
    normalized_key = key.strip()
    if not is_runtime_setting_key_supported(normalized_key):
        raise HTTPException(status_code=404, detail="Runtime setting key not found")

    if normalized_key == "knowledge_embedding_model":
        fallback_model = default_runtime_setting_value(normalized_key)
        try:
            set_embedding_model_name(fallback_model)
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc

    await RuntimeSetting.filter(key=normalized_key).delete()
    if normalized_key == "knowledge_embedding_model":
        try:
            await sync_embedding_model_from_runtime_settings()
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
    return {"deleted": True}


@app.post("/filter_papers")
async def filter_papers(payload: ManualFilterRequest) -> dict[str, Any]:
    workflow = await WorkflowExecution.create(
        workflow_name=WORKFLOW_NAME_DAILY_PAPER_REPORTS,
        trigger_type=payload.trigger_type,
        status="running",
        context={"manualFiltering": True, "metadata": payload.metadata},
    )
    stage = await WorkflowStageExecution.create(
        workflow=workflow,
        stage=STAGE_PAPER_FILTERING,
        status="running",
        input_payload={"candidateIds": payload.candidate_ids or []},
    )

    try:
        result = await run_initial_screening(
            candidate_paper_ids=payload.candidate_ids,
            trigger_type=payload.trigger_type,
            workflow_execution=workflow,
            stage_execution=stage,
            task_metadata=payload.metadata,
        )
        await _finish_stage(stage, status="succeeded", output_payload=result)
        await _finish_workflow(workflow, status="succeeded")
        result["workflow_id"] = str(workflow.id)
        return result
    except ValueError as exc:
        await _finish_stage(stage, status="failed", error_message=str(exc))
        await _finish_workflow(workflow, status="failed", error_message=str(exc))
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        await _finish_stage(stage, status="failed", error_message=str(exc))
        await _finish_workflow(workflow, status="failed", error_message=str(exc))
        logger.exception("Manual filtering failed")
        raise HTTPException(status_code=500, detail="Failed to filter papers") from exc


@app.post("/read_papers")
async def read_papers(payload: ManualReadingRequest) -> dict[str, Any]:
    workflow = await WorkflowExecution.create(
        workflow_name=WORKFLOW_NAME_READING_REPORT_GENERATION,
        trigger_type=payload.trigger_type,
        status="running",
        context={"manualReading": True, "metadata": payload.metadata},
    )
    stage = await WorkflowStageExecution.create(
        workflow=workflow,
        stage=STAGE_PAPER_READING,
        status="running",
        input_payload={
            "paperIds": payload.paper_ids or [],
            "sourceFilteringRunId": payload.source_filtering_run_id,
        },
    )

    source_filtering_run: PaperFilteringRun | None = None
    if payload.source_filtering_run_id:
        try:
            uuid.UUID(payload.source_filtering_run_id)
        except ValueError as exc:
            await _finish_stage(stage, status="failed", error_message="sourceFilteringRunId 格式无效。")
            await _finish_workflow(
                workflow, status="failed", error_message="sourceFilteringRunId 格式无效。"
            )
            raise HTTPException(status_code=400, detail="sourceFilteringRunId 格式无效。") from exc

        source_filtering_run = await PaperFilteringRun.get_or_none(
            id=payload.source_filtering_run_id
        )
        if source_filtering_run is None:
            await _finish_stage(stage, status="failed", error_message="sourceFilteringRunId 不存在。")
            await _finish_workflow(
                workflow, status="failed", error_message="sourceFilteringRunId 不存在。"
            )
            raise HTTPException(status_code=400, detail="sourceFilteringRunId 不存在。")

    try:
        result = await run_paper_reading(
            paper_ids=payload.paper_ids,
            trigger_type=payload.trigger_type,
            workflow_execution=workflow,
            stage_execution=stage,
            source_filtering_run=source_filtering_run,
            task_metadata=payload.metadata,
        )
        await _finish_stage(stage, status="succeeded", output_payload=result)
        await _finish_workflow(workflow, status="succeeded")
        result["workflow_id"] = str(workflow.id)
        return result
    except ValueError as exc:
        await _finish_stage(stage, status="failed", error_message=str(exc))
        await _finish_workflow(workflow, status="failed", error_message=str(exc))
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        await _finish_stage(stage, status="failed", error_message=str(exc))
        await _finish_workflow(workflow, status="failed", error_message=str(exc))
        logger.exception("Manual paper reading failed")
        raise HTTPException(status_code=500, detail="Failed to generate reading reports") from exc


@app.post("/read_papers/by_arxiv_id")
async def read_paper_by_arxiv_id(payload: ManualReadByArxivIdRequest) -> dict[str, Any]:
    try:
        paper_id = _normalize_arxiv_id(payload.paper_id)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    existing_report = (
        await PaperReadingReport.filter(paper_id=paper_id, status="succeeded")
        .order_by("-created_at")
        .select_related("paper")
        .first()
    )
    if existing_report is not None:
        return {
            "paper_id": paper_id,
            "title": existing_report.paper.title if existing_report.paper else "",
            "workflow_id": None,
            "report_id": str(existing_report.id),
            "deduplicated": True,
            "message": "该论文已有精读报告，已返回历史结果。",
        }

    try:
        persisted = await collect_and_persist_paper_by_id(paper_id)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except HTTPError as exc:
        if exc.code == 404:
            raise HTTPException(status_code=404, detail=f"未找到论文元数据: {paper_id}") from exc
        logger.exception("Fetch paper metadata failed: paper_id=%s", paper_id)
        raise HTTPException(status_code=502, detail="拉取论文元数据失败。") from exc
    except Exception as exc:
        logger.exception("Fetch paper metadata failed: paper_id=%s", paper_id)
        raise HTTPException(status_code=500, detail="拉取论文元数据失败。") from exc

    workflow = await WorkflowExecution.create(
        workflow_name=WORKFLOW_NAME_READING_REPORT_GENERATION,
        trigger_type=payload.trigger_type,
        status="running",
        context={"manualReadByArxivId": True, "paperId": paper_id, "metadata": payload.metadata},
    )
    stage = await WorkflowStageExecution.create(
        workflow=workflow,
        stage=STAGE_PAPER_READING,
        status="running",
        input_payload={"paperIds": [paper_id], "sourceFilteringRunId": None},
    )

    async def _runner() -> None:
        try:
            result = await run_paper_reading(
                paper_ids=[paper_id],
                trigger_type=payload.trigger_type,
                workflow_execution=workflow,
                stage_execution=stage,
                source_filtering_run=None,
                task_metadata=payload.metadata,
            )
            await _finish_stage(stage, status="succeeded", output_payload=result)
            await _finish_workflow(workflow, status="succeeded")
        except Exception as exc:
            await _finish_stage(stage, status="failed", error_message=str(exc))
            await _finish_workflow(workflow, status="failed", error_message=str(exc))
            logger.exception("Manual paper reading by arXiv ID failed, paper_id=%s", paper_id)

    asyncio.create_task(_runner())
    return {
        "paper_id": paper_id,
        "title": persisted["title"],
        "workflow_id": str(workflow.id),
        "report_id": None,
        "deduplicated": False,
        "message": "已创建精读工作流，正在后台生成报告。",
    }


@app.get("/reading_reports")
async def list_reading_reports(
    limit: int = 20,
    paper_id: str | None = None,
    today_only: bool = False,
) -> list[dict[str, Any]]:
    safe_limit = min(max(limit, 1), 200)
    query = PaperReadingReport.all()
    if paper_id:
        query = query.filter(paper_id=paper_id.strip())
    if today_only:
        day_start_utc, day_end_utc, _ = _china_day_window_utc()
        query = query.filter(created_at__gte=day_start_utc, created_at__lt=day_end_utc)
    reports = await query.order_by("-created_at").limit(safe_limit).select_related("paper")
    return [_reading_report_to_dict(report, include_full=False) for report in reports]


@app.get("/reading_reports/{report_id}")
async def get_reading_report(report_id: str) -> dict[str, Any]:
    try:
        report_uuid = uuid.UUID(report_id)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail="Invalid report_id") from exc

    report = (
        await PaperReadingReport.filter(id=report_uuid)
        .select_related("paper")
        .first()
    )
    if report is None:
        raise HTTPException(status_code=404, detail="Reading report not found")
    data = _reading_report_to_dict(report, include_full=True)
    data.update(await get_reading_report_knowledge_payload(report))
    return data


@app.patch("/reading_reports/{report_id}/comment")
async def update_reading_report_comment(
    report_id: str, payload: ReportCommentUpdateRequest
) -> dict[str, Any]:
    try:
        report_uuid = uuid.UUID(report_id)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail="Invalid report_id") from exc

    report = await PaperReadingReport.get_or_none(id=report_uuid)
    if report is None:
        raise HTTPException(status_code=404, detail="Reading report not found")

    report.comment = payload.comment
    await report.save(update_fields=["comment", "updated_at"])
    report = (
        await PaperReadingReport.filter(id=report_uuid)
        .select_related("paper")
        .first()
    )
    return _reading_report_to_dict(report, include_full=False) if report else {"id": report_id}


@app.post("/knowledge/reports/{report_id}/extract")
async def extract_knowledge_by_report(report_id: str) -> dict[str, Any]:
    try:
        report_uuid = uuid.UUID(report_id)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail="Invalid report_id") from exc

    try:
        return await trigger_report_knowledge_extraction(report_uuid)
    except ValueError as exc:
        if "not found" in str(exc).lower():
            raise HTTPException(status_code=404, detail="Reading report not found") from exc
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        logger.exception("Knowledge extraction failed, report_id=%s", report_id)
        raise HTTPException(status_code=500, detail="Failed to extract knowledge") from exc


@app.get("/knowledge/embedding/status")
async def get_knowledge_embedding_status_api() -> dict[str, Any]:
    try:
        await sync_embedding_model_from_runtime_settings()
        return get_embedding_download_status()
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        logger.exception("Get knowledge embedding status failed")
        raise HTTPException(status_code=500, detail="Failed to get embedding status") from exc


@app.post("/knowledge/embedding/download")
async def start_knowledge_embedding_download_api() -> dict[str, Any]:
    try:
        await sync_embedding_model_from_runtime_settings()
        return start_embedding_download()
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        logger.exception("Start knowledge embedding download failed")
        raise HTTPException(status_code=500, detail="Failed to start embedding download") from exc


@app.get("/knowledge/questions")
async def list_knowledge_questions_api(
    limit: int = 20,
    search: str | None = None,
) -> list[dict[str, Any]]:
    try:
        return await list_knowledge_questions(search=search, limit=limit)
    except Exception as exc:
        logger.exception("List knowledge questions failed")
        raise HTTPException(status_code=500, detail="Failed to list knowledge questions") from exc


@app.post("/knowledge/questions")
async def create_knowledge_question_api(payload: KnowledgeQuestionCreateRequest) -> dict[str, Any]:
    try:
        return await create_manual_knowledge_question(
            question_text=payload.question,
            created_by=payload.created_by,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        logger.exception("Create knowledge question failed")
        raise HTTPException(status_code=500, detail="Failed to create knowledge question") from exc


@app.patch("/knowledge/questions/{question_id}")
async def update_knowledge_question_api(
    question_id: str, payload: KnowledgeQuestionUpdateRequest
) -> dict[str, Any]:
    try:
        question_uuid = uuid.UUID(question_id)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail="Invalid question_id") from exc

    try:
        result = await update_knowledge_question(
            question_id=question_uuid,
            question_text=payload.question,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        logger.exception("Update knowledge question failed, question_id=%s", question_id)
        raise HTTPException(status_code=500, detail="Failed to update knowledge question") from exc

    if result is None:
        raise HTTPException(status_code=404, detail="Knowledge question not found")
    return result


@app.delete("/knowledge/questions/{question_id}")
async def delete_knowledge_question_api(question_id: str) -> dict[str, Any]:
    try:
        question_uuid = uuid.UUID(question_id)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail="Invalid question_id") from exc

    try:
        result = await delete_knowledge_question(question_id=question_uuid)
    except Exception as exc:
        logger.exception("Delete knowledge question failed, question_id=%s", question_id)
        raise HTTPException(status_code=500, detail="Failed to delete knowledge question") from exc

    if result is None:
        raise HTTPException(status_code=404, detail="Knowledge question not found")
    return result


@app.get("/knowledge/questions/{question_id}")
async def get_knowledge_question_detail_api(question_id: str) -> dict[str, Any]:
    try:
        question_uuid = uuid.UUID(question_id)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail="Invalid question_id") from exc

    try:
        data = await get_knowledge_question_detail(question_uuid)
    except Exception as exc:
        logger.exception("Get knowledge question detail failed, question_id=%s", question_id)
        raise HTTPException(status_code=500, detail="Failed to get knowledge question detail") from exc

    if data is None:
        raise HTTPException(status_code=404, detail="Knowledge question not found")
    return data


@app.get("/workflow_runs")
async def list_workflow_runs(limit: int = 20) -> list[dict[str, Any]]:
    safe_limit = min(max(limit, 1), 200)
    runs = await WorkflowExecution.all().order_by("-started_at").limit(safe_limit)
    return [_workflow_to_dict(run) for run in runs]


@app.get("/workflow_runs/{workflow_id}")
async def get_workflow_run(workflow_id: str) -> dict[str, Any]:
    try:
        workflow_uuid = uuid.UUID(workflow_id)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail="Invalid workflow_id") from exc

    workflow = await WorkflowExecution.get_or_none(id=workflow_uuid)
    if workflow is None:
        raise HTTPException(status_code=404, detail="Workflow run not found")

    stages = (
        await WorkflowStageExecution.filter(workflow=workflow)
        .order_by("started_at")
        .all()
    )
    return {
        "workflow": _workflow_to_dict(workflow),
        "stages": [_stage_to_dict(stage) for stage in stages],
    }


@app.post("/workflow_runs/daily/trigger")
@app.get("/workflow_runs/daily/trigger")
async def trigger_daily_workflow_api() -> dict[str, str]:
    workflow_id = await trigger_daily_workflow(
        trigger_type="manual",
        context={"manualTrigger": True},
    )
    return {"workflow_id": workflow_id}


def _parse_bool_env(name: str, default: bool = False) -> bool:
    value = os.getenv(name)
    if value is None:
        return default
    return value.strip().lower() in {"1", "true", "yes", "on"}


def run() -> None:
    try:
        import uvicorn
    except ModuleNotFoundError as exc:
        raise RuntimeError(
            "uvicorn is required to serve the FastAPI app. "
            "Please install it, e.g. `uv add uvicorn`."
        ) from exc

    host = os.getenv("APP_HOST", "0.0.0.0")
    port = int(os.getenv("APP_PORT", "8000"))
    reload = _parse_bool_env("APP_RELOAD", default=False)
    uvicorn.run("deeplab.main:app", host=host, port=port, reload=reload)


if __name__ == "__main__":
    run()
