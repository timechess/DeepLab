import asyncio
import logging
import os
import uuid
from contextlib import asynccontextmanager, suppress
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.parse import quote_plus

from fastapi import FastAPI, HTTPException
from dotenv import load_dotenv
from tortoise import Tortoise
from tortoise.contrib.fastapi import RegisterTortoise

from deeplab.api.presenters import (
    _reading_report_to_dict,
    _rule_to_dict,
    _runtime_setting_to_dict,
    _stage_to_dict,
    _workflow_to_dict,
)
from deeplab.api.schemas import (
    KnowledgeNoteCreateRequest,
    KnowledgeNoteUpdateRequest,
    KnowledgeQuestionCreateRequest,
    KnowledgeQuestionUpdateRequest,
    ManualFilterRequest,
    ManualReadByArxivIdRequest,
    ManualReadingRequest,
    ReportCommentUpdateRequest,
    RuntimeSettingUpdateRequest,
    ScreeningRuleCreateRequest,
    ScreeningRuleUpdateRequest,
)
from deeplab.daily_papers.paper_collection import (
    collect_and_persist_papers,
)
from deeplab.daily_papers.paper_filtering import (
    STAGE_PAPER_FILTERING,
    WORKFLOW_NAME_DAILY_PAPER_REPORTS,
    run_initial_screening,
)
from deeplab.daily_papers.paper_reading import (
    STAGE_PAPER_READING,
    run_paper_reading,
)
from deeplab.db.schema_setup import (
    ensure_knowledge_note_schema_columns,
    normalize_knowledge_note_schema_columns,
)
from deeplab.knowledge_base.embedding import (
    get_embedding_download_status,
    set_embedding_model_name,
    start_embedding_download,
    sync_embedding_model_from_runtime_settings,
)
from deeplab.knowledge_base.note_service import (
    create_knowledge_note,
    delete_knowledge_note,
    get_knowledge_note_detail,
    list_knowledge_notes,
    search_knowledge_link_targets,
    update_knowledge_note,
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
)
from deeplab.workflows.common import finish_stage, finish_workflow
from deeplab.workflows.daily_reports import (
    china_day_window_utc,
    daily_fetch_loop,
    trigger_daily_workflow,
)
from deeplab.workflows.manual_reading import (
    WORKFLOW_NAME_READING_REPORT_GENERATION,
    build_external_pdf_paper_id,
    classify_manual_paper_input,
    deduplicated_read_response,
    find_latest_succeeded_report_for_paper,
    normalize_text_field,
    normalize_text_list,
    probe_downloadable_pdf,
    to_utc_datetime,
    trigger_arxiv_paper_reading_workflow,
    trigger_single_paper_reading_workflow,
)

load_dotenv()

logger = logging.getLogger(__name__)


def _build_postgres_dsn() -> str:
    user = os.getenv("POSTGRES_USER", "postgres")
    password = os.getenv("POSTGRES_PASSWORD", "")
    host = os.getenv("POSTGRES_HOST", "127.0.0.1")
    port = os.getenv("POSTGRES_PORT", "5432")
    db_name = os.getenv("POSTGRES_DB", "deeplab")
    return f"postgres://{quote_plus(user)}:{quote_plus(password)}@{host}:{port}/{quote_plus(db_name)}"


@asynccontextmanager
async def lifespan(app: FastAPI):
    async with RegisterTortoise(
        app=app,
        db_url=_build_postgres_dsn(),
        modules={"models": ["deeplab.model"]},
        generate_schemas=False,
        use_tz=True,
        timezone="UTC",
    ):
        await normalize_knowledge_note_schema_columns()
        await ensure_knowledge_note_schema_columns()
        await Tortoise.generate_schemas(safe=True)
        stop_event = asyncio.Event()
        scheduler_task = asyncio.create_task(daily_fetch_loop(stop_event))
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
        await finish_stage(stage, status="succeeded", output_payload=result)
        await finish_workflow(workflow, status="succeeded")
        result["workflow_id"] = str(workflow.id)
        return result
    except ValueError as exc:
        await finish_stage(stage, status="failed", error_message=str(exc))
        await finish_workflow(workflow, status="failed", error_message=str(exc))
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        await finish_stage(stage, status="failed", error_message=str(exc))
        await finish_workflow(workflow, status="failed", error_message=str(exc))
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
            await finish_stage(stage, status="failed", error_message="sourceFilteringRunId 格式无效。")
            await finish_workflow(
                workflow, status="failed", error_message="sourceFilteringRunId 格式无效。"
            )
            raise HTTPException(status_code=400, detail="sourceFilteringRunId 格式无效。") from exc

        source_filtering_run = await PaperFilteringRun.get_or_none(
            id=payload.source_filtering_run_id
        )
        if source_filtering_run is None:
            await finish_stage(stage, status="failed", error_message="sourceFilteringRunId 不存在。")
            await finish_workflow(
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
        await finish_stage(stage, status="succeeded", output_payload=result)
        await finish_workflow(workflow, status="succeeded")
        result["workflow_id"] = str(workflow.id)
        return result
    except ValueError as exc:
        await finish_stage(stage, status="failed", error_message=str(exc))
        await finish_workflow(workflow, status="failed", error_message=str(exc))
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        await finish_stage(stage, status="failed", error_message=str(exc))
        await finish_workflow(workflow, status="failed", error_message=str(exc))
        logger.exception("Manual paper reading failed")
        raise HTTPException(status_code=500, detail="Failed to generate reading reports") from exc


@app.post("/read_papers/by_arxiv_id")
async def read_paper_by_arxiv_id(payload: ManualReadByArxivIdRequest) -> dict[str, Any]:
    raw_input = normalize_text_field(payload.paper_id, field_name="paperId", required=True)
    try:
        input_kind, normalized = classify_manual_paper_input(raw_input)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    if input_kind == "arxiv":
        paper_id = normalized
        existing_report = await find_latest_succeeded_report_for_paper(paper_id)
        if existing_report is not None:
            response = deduplicated_read_response(paper_id=paper_id, report=existing_report)
            response["resolved_input_type"] = "arxiv"
            return response

        try:
            return await trigger_arxiv_paper_reading_workflow(
                requested_paper_id=paper_id,
                trigger_type=payload.trigger_type,
                metadata=payload.metadata,
            )
        except Exception as exc:
            logger.exception("Create arXiv reading workflow shell failed: paper_id=%s", paper_id)
            raise HTTPException(status_code=500, detail="创建精读任务失败。") from exc

    pdf_url = normalized
    try:
        await asyncio.to_thread(probe_downloadable_pdf, pdf_url)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except HTTPError as exc:
        detail = f"PDF 地址不可访问（HTTP {exc.code}）。"
        raise HTTPException(status_code=400, detail=detail) from exc
    except URLError as exc:
        raise HTTPException(status_code=400, detail="PDF 地址不可访问，请检查网络或 URL。") from exc
    except Exception as exc:
        logger.exception("Probe PDF url failed: %s", pdf_url)
        raise HTTPException(status_code=500, detail="校验 PDF 地址失败。") from exc

    paper_id = build_external_pdf_paper_id(pdf_url)
    existing_report = await find_latest_succeeded_report_for_paper(paper_id)
    if existing_report is not None:
        response = deduplicated_read_response(paper_id=paper_id, report=existing_report)
        response["resolved_input_type"] = "pdf_url"
        response["resolved_pdf_url"] = pdf_url
        return response

    if payload.paper_metadata is None:
        return {
            "paper_id": paper_id,
            "title": "",
            "workflow_id": None,
            "report_id": None,
            "deduplicated": False,
            "requires_metadata": True,
            "resolved_input_type": "pdf_url",
            "resolved_pdf_url": pdf_url,
            "message": "已确认 PDF 可下载，请先补充论文元信息。",
        }

    try:
        meta_title = normalize_text_field(
            payload.paper_metadata.title,
            field_name="paperMetadata.title",
            required=True,
        )
        meta_summary = normalize_text_field(
            payload.paper_metadata.summary,
            field_name="paperMetadata.summary",
            required=True,
        )
        meta_authors = normalize_text_list(
            payload.paper_metadata.authors,
            field_name="paperMetadata.authors",
            min_items=1,
        )
        meta_organization = normalize_text_field(
            payload.paper_metadata.organization,
            field_name="paperMetadata.organization",
            required=False,
        )
        meta_keywords = normalize_text_list(
            payload.paper_metadata.ai_keywords,
            field_name="paperMetadata.aiKeywords",
            min_items=0,
        )
        meta_published_at = to_utc_datetime(payload.paper_metadata.published_at)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    try:
        paper, _ = await Paper.update_or_create(
            id=paper_id,
            defaults={
                "title": meta_title,
                "authors": meta_authors,
                "organization": meta_organization or None,
                "summary": meta_summary,
                "ai_summary": None,
                "ai_keywords": meta_keywords,
                "upvotes": 0,
                "github_repo": None,
                "github_stars": None,
                "published_at": meta_published_at,
            },
        )
    except Exception as exc:
        logger.exception("Persist manual PDF metadata failed: paper_id=%s", paper_id)
        raise HTTPException(status_code=500, detail="保存论文元信息失败。") from exc

    response = await trigger_single_paper_reading_workflow(
        paper_id=paper_id,
        title=paper.title,
        trigger_type=payload.trigger_type,
        metadata=payload.metadata,
        workflow_context={
            "manualReadByArxivId": True,
            "manualInputType": "pdf_url",
            "paperId": paper_id,
            "sourcePdfUrl": pdf_url,
            "metadata": payload.metadata,
        },
        task_metadata_extra={"paperPdfUrlMap": {paper_id: pdf_url}},
    )
    response["resolved_input_type"] = "pdf_url"
    response["resolved_pdf_url"] = pdf_url
    return response


@app.get("/reading_reports")
async def list_reading_reports(
    limit: int = 20,
    offset: int = 0,
    paper_id: str | None = None,
    paper_title: str | None = None,
    comment_status: str | None = None,
    today_only: bool = False,
) -> list[dict[str, Any]]:
    safe_limit = min(max(limit, 1), 200)
    safe_offset = max(offset, 0)
    query = PaperReadingReport.all()
    if paper_id:
        query = query.filter(paper_id=paper_id.strip())
    if paper_title:
        query = query.filter(paper__title__icontains=paper_title.strip())
    normalized_comment_status = (comment_status or "").strip().lower()
    if normalized_comment_status == "commented":
        query = query.exclude(comment="")
    elif normalized_comment_status == "uncommented":
        query = query.filter(comment="")
    if today_only:
        day_start_utc, day_end_utc, _ = china_day_window_utc()
        query = query.filter(created_at__gte=day_start_utc, created_at__lt=day_end_utc)
    reports = (
        await query.order_by("-created_at")
        .offset(safe_offset)
        .limit(safe_limit)
        .select_related("paper")
    )
    return [_reading_report_to_dict(report, include_full=False) for report in reports]


@app.get("/reading_reports/count")
async def count_reading_reports(
    paper_id: str | None = None,
    paper_title: str | None = None,
    comment_status: str | None = None,
    today_only: bool = False,
) -> dict[str, int]:
    query = PaperReadingReport.all()
    if paper_id:
        query = query.filter(paper_id=paper_id.strip())
    if paper_title:
        query = query.filter(paper__title__icontains=paper_title.strip())
    normalized_comment_status = (comment_status or "").strip().lower()
    if normalized_comment_status == "commented":
        query = query.exclude(comment="")
    elif normalized_comment_status == "uncommented":
        query = query.filter(comment="")
    if today_only:
        day_start_utc, day_end_utc, _ = china_day_window_utc()
        query = query.filter(created_at__gte=day_start_utc, created_at__lt=day_end_utc)
    total = await query.count()
    return {"total": int(total)}


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


@app.get("/knowledge/notes")
async def list_knowledge_notes_api(
    limit: int = 20,
    search: str | None = None,
) -> list[dict[str, Any]]:
    try:
        return await list_knowledge_notes(search=search, limit=limit)
    except Exception as exc:
        logger.exception("List knowledge notes failed")
        raise HTTPException(status_code=500, detail="Failed to list knowledge notes") from exc


@app.post("/knowledge/notes")
async def create_knowledge_note_api(payload: KnowledgeNoteCreateRequest) -> dict[str, Any]:
    try:
        return await create_knowledge_note(
            title=payload.title,
            content_json=payload.content_json,
            created_by=payload.created_by,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        logger.exception("Create knowledge note failed")
        raise HTTPException(status_code=500, detail="Failed to create knowledge note") from exc


@app.get("/knowledge/notes/{note_id}")
async def get_knowledge_note_detail_api(note_id: str) -> dict[str, Any]:
    try:
        note_uuid = uuid.UUID(note_id)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail="Invalid note_id") from exc

    try:
        data = await get_knowledge_note_detail(note_uuid)
    except Exception as exc:
        logger.exception("Get knowledge note detail failed, note_id=%s", note_id)
        raise HTTPException(status_code=500, detail="Failed to get knowledge note detail") from exc

    if data is None:
        raise HTTPException(status_code=404, detail="Knowledge note not found")
    return data


@app.patch("/knowledge/notes/{note_id}")
async def update_knowledge_note_api(
    note_id: str, payload: KnowledgeNoteUpdateRequest
) -> dict[str, Any]:
    try:
        note_uuid = uuid.UUID(note_id)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail="Invalid note_id") from exc

    try:
        result = await update_knowledge_note(
            note_id=note_uuid,
            title=payload.title,
            content_json=payload.content_json,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        logger.exception("Update knowledge note failed, note_id=%s", note_id)
        raise HTTPException(status_code=500, detail="Failed to update knowledge note") from exc

    if result is None:
        raise HTTPException(status_code=404, detail="Knowledge note not found")
    return result


@app.delete("/knowledge/notes/{note_id}")
async def delete_knowledge_note_api(note_id: str) -> dict[str, Any]:
    try:
        note_uuid = uuid.UUID(note_id)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail="Invalid note_id") from exc

    try:
        result = await delete_knowledge_note(note_id=note_uuid)
    except Exception as exc:
        logger.exception("Delete knowledge note failed, note_id=%s", note_id)
        raise HTTPException(status_code=500, detail="Failed to delete knowledge note") from exc

    if result is None:
        raise HTTPException(status_code=404, detail="Knowledge note not found")
    return result


@app.get("/knowledge/link-targets")
async def search_knowledge_link_targets_api(
    type: str,
    q: str | None = None,
    limit: int = 20,
    exclude_note_id: str | None = None,
) -> list[dict[str, Any]]:
    try:
        if exclude_note_id:
            uuid.UUID(exclude_note_id)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail="Invalid exclude_note_id") from exc

    try:
        return await search_knowledge_link_targets(
            target_type=type,
            q=q,
            limit=limit,
            exclude_note_id=exclude_note_id,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        logger.exception("Search knowledge link targets failed")
        raise HTTPException(status_code=500, detail="Failed to search knowledge link targets") from exc


@app.get("/workflow_runs")
async def list_workflow_runs(
    limit: int = 20,
    offset: int = 0,
    status: str | None = None,
) -> list[dict[str, Any]]:
    safe_limit = min(max(limit, 1), 200)
    safe_offset = max(offset, 0)

    query = WorkflowExecution.all()
    normalized_status = (status or "").strip().lower()
    if normalized_status in {"running", "succeeded", "failed", "partial_succeeded"}:
        query = query.filter(status=normalized_status)

    runs = await query.order_by("-started_at").offset(safe_offset).limit(safe_limit)
    return [_workflow_to_dict(run) for run in runs]


@app.get("/workflow_runs/count")
async def count_workflow_runs(status: str | None = None) -> dict[str, int]:
    query = WorkflowExecution.all()
    normalized_status = (status or "").strip().lower()
    if normalized_status in {"running", "succeeded", "failed", "partial_succeeded"}:
        query = query.filter(status=normalized_status)
    total = await query.count()
    return {"total": int(total)}


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
