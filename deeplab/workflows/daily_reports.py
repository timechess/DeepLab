import asyncio
import logging
from datetime import UTC, datetime, timedelta
from typing import Any

from deeplab.api.presenters import (
    _extract_collection_candidate_ids,
    _is_reading_result_compatible,
    _normalize_collection_result,
    _normalize_filtering_result,
    _normalize_reading_result,
)
from deeplab.daily_papers.paper_collection import collect_and_persist_papers
from deeplab.daily_papers.paper_filtering import (
    STAGE_PAPER_FILTERING,
    WORKFLOW_NAME_DAILY_PAPER_REPORTS,
    run_initial_screening,
)
from deeplab.daily_papers.paper_reading import STAGE_PAPER_READING, run_paper_reading
from deeplab.db.engine import create_background_task
from deeplab.model import Paper, PaperFilteringRun, WorkflowExecution, WorkflowStageExecution
from deeplab.workflows.common import finish_stage, finish_workflow

logger = logging.getLogger(__name__)

STAGE_PAPER_COLLECTION = "paper_collection"
CHINA_UTC_OFFSET = timedelta(hours=8)
_DAILY_WORKFLOW_TRIGGER_LOCK = asyncio.Lock()


def seconds_until_next_daily_utc_run(now: datetime | None = None) -> float:
    current = now or datetime.now(tz=UTC)
    next_run = current.replace(hour=0, minute=0, second=0, microsecond=0)
    if current >= next_run:
        next_run += timedelta(days=1)
    return (next_run - current).total_seconds()


def china_day_window_utc(now: datetime | None = None) -> tuple[datetime, datetime, str]:
    current_utc = now or datetime.now(tz=UTC)
    china_now = current_utc + CHINA_UTC_OFFSET
    china_day_start_utc = (
        china_now.replace(hour=0, minute=0, second=0, microsecond=0) - CHINA_UTC_OFFSET
    )
    china_day_end_utc = china_day_start_utc + timedelta(days=1)
    return china_day_start_utc, china_day_end_utc, china_now.date().isoformat()


async def find_latest_daily_workflow(
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


async def filter_newly_collected_candidate_ids(
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


async def workflow_has_complete_daily_outputs(workflow: WorkflowExecution) -> bool:
    collection = _normalize_collection_result(
        await get_latest_succeeded_stage_payload(workflow, STAGE_PAPER_COLLECTION)
    )
    if collection is None:
        return False

    filtering = _normalize_filtering_result(
        await get_latest_succeeded_stage_payload(workflow, STAGE_PAPER_FILTERING)
    )
    if filtering is None:
        return False

    reading = _normalize_reading_result(
        await get_latest_succeeded_stage_payload(workflow, STAGE_PAPER_READING)
    )
    if reading is None:
        return False

    return _is_reading_result_compatible(reading, filtering)


async def prepare_daily_workflow_execution(
    trigger_type: str,
    context: dict[str, Any] | None = None,
) -> tuple[WorkflowExecution, bool, str | None]:
    day_start_utc, day_end_utc, business_date_cst = china_day_window_utc()

    async with _DAILY_WORKFLOW_TRIGGER_LOCK:
        running = await find_latest_daily_workflow(
            start_utc=day_start_utc,
            end_utc=day_end_utc,
            statuses=("running",),
        )
        if running is not None:
            return running, False, "running"

        succeeded = await find_latest_daily_workflow(
            start_utc=day_start_utc,
            end_utc=day_end_utc,
            statuses=("succeeded",),
        )
        if succeeded is not None and await workflow_has_complete_daily_outputs(succeeded):
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
            if await workflow_has_complete_daily_outputs(resumable):
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


async def execute_daily_workflow(workflow: WorkflowExecution) -> dict[str, Any]:
    try:
        collection = _normalize_collection_result(
            await get_latest_succeeded_stage_payload(workflow, STAGE_PAPER_COLLECTION)
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
                await finish_stage(
                    collection_stage,
                    status="succeeded",
                    output_payload=collection_payload,
                )
                collection = _normalize_collection_result(collection_payload)
                if collection is None:
                    raise RuntimeError("paper_collection 阶段成功但输出结构无效。")
            except Exception as exc:
                await finish_stage(
                    collection_stage,
                    status="failed",
                    error_message=str(exc),
                )
                raise
        else:
            logger.info("Reusing paper_collection result, workflow_id=%s", workflow.id)

        filtering_result = _normalize_filtering_result(
            await get_latest_succeeded_stage_payload(workflow, STAGE_PAPER_FILTERING)
        )
        filtering_reran = False
        if filtering_result is None:
            original_candidate_ids = _extract_collection_candidate_ids(collection)
            candidate_ids = await filter_newly_collected_candidate_ids(
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
                await finish_stage(
                    filtering_stage,
                    status="succeeded",
                    output_payload=filtering_result_raw,
                )
                filtering_result = _normalize_filtering_result(filtering_result_raw)
                if filtering_result is None:
                    raise RuntimeError("paper_filtering 阶段成功但输出结构无效。")
                filtering_reran = True
            except Exception as exc:
                await finish_stage(
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
                await get_latest_succeeded_stage_payload(workflow, STAGE_PAPER_READING)
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
                await finish_stage(
                    reading_stage,
                    status="succeeded",
                    output_payload=reading_result_raw,
                )
                reading_result = _normalize_reading_result(reading_result_raw)
                if reading_result is None:
                    raise RuntimeError("paper_reading 阶段成功但输出结构无效。")
            except Exception as exc:
                await finish_stage(
                    reading_stage,
                    status="failed",
                    error_message=str(exc),
                )
                raise

        await finish_workflow(workflow, status="succeeded")
        return {
            "workflow_id": str(workflow.id),
            "collection": collection,
            "filtering": filtering_result,
            "reading": reading_result,
        }
    except Exception as exc:
        await finish_workflow(workflow, status="failed", error_message=str(exc))
        raise


async def run_daily_workflow(
    trigger_type: str,
    context: dict[str, Any] | None = None,
) -> dict[str, Any]:
    workflow, should_execute, dedupe_reason = await prepare_daily_workflow_execution(
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

    result = await execute_daily_workflow(workflow)
    result["deduplicated"] = False
    return result


async def trigger_daily_workflow(trigger_type: str, context: dict[str, Any] | None = None) -> str:
    workflow, should_execute, dedupe_reason = await prepare_daily_workflow_execution(
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
            await execute_daily_workflow(workflow)
        except Exception:
            logger.exception("Background daily workflow failed, workflow_id=%s", workflow.id)

    create_background_task(_runner())
    return str(workflow.id)


async def daily_fetch_loop(stop_event: asyncio.Event) -> None:
    # 北京时间 08:00 == UTC 00:00
    while not stop_event.is_set():
        wait_seconds = seconds_until_next_daily_utc_run()
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
