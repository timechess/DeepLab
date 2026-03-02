import asyncio
import hashlib
import logging
import uuid
from datetime import UTC, datetime
from typing import Any

from deeplab.daily_papers.paper_reading import normalize_stage2_markdown_text
from deeplab.knowledge_base.embedding import (
    assert_embedding_model_ready,
    encode_text,
    encode_texts,
    get_embedding_model_name,
    sync_embedding_model_from_runtime_settings,
)
from deeplab.knowledge_base.similarity import (
    rebuild_persistent_question_index,
    search_similar_questions,
)
from deeplab.knowledge_base.xml_parser import (
    candidates_to_xml,
    parse_final_question_set,
    parse_question_candidates,
    recall_context_to_json_like,
)
from deeplab.llm_provider import get_llm_runtime_settings, invoke_llm_sync
from deeplab.model import (
    KnowledgeExtractionRun,
    KnowledgeQuestion,
    KnowledgeSolution,
    LLMInvocationLog,
    Paper,
    PaperReadingReport,
)
from deeplab.runtime_settings import (
    DEFAULT_KNOWLEDGE_CANDIDATE_SYSTEM_PROMPT,
    DEFAULT_KNOWLEDGE_CANDIDATE_USER_PROMPT_TEMPLATE,
    DEFAULT_KNOWLEDGE_FINAL_SYSTEM_PROMPT,
    DEFAULT_KNOWLEDGE_FINAL_USER_PROMPT_TEMPLATE,
    resolve_setting_value,
)

logger = logging.getLogger(__name__)

STAGE_KNOWLEDGE_BASE = "knowledge_base"
TASK_QUESTION_CANDIDATES = "knowledge_question_candidates"
TASK_FINAL_QUESTION_SET = "knowledge_final_question_set"

DEFAULT_CANDIDATE_TEMPERATURE = 0.6
DEFAULT_FINAL_TEMPERATURE = 0.4
DEFAULT_RECALL_TOP_K = 8

DEFAULT_CANDIDATE_SYSTEM_PROMPT = DEFAULT_KNOWLEDGE_CANDIDATE_SYSTEM_PROMPT
DEFAULT_CANDIDATE_USER_PROMPT_TEMPLATE = DEFAULT_KNOWLEDGE_CANDIDATE_USER_PROMPT_TEMPLATE
DEFAULT_FINAL_SYSTEM_PROMPT = DEFAULT_KNOWLEDGE_FINAL_SYSTEM_PROMPT
DEFAULT_FINAL_USER_PROMPT_TEMPLATE = DEFAULT_KNOWLEDGE_FINAL_USER_PROMPT_TEMPLATE


def _render_prompt_template(template: str, variables: dict[str, str]) -> str:
    rendered = template
    for key, value in variables.items():
        rendered = rendered.replace(f"{{{{{key}}}}}", value)
    return rendered.strip()


async def _get_knowledge_prompt_templates() -> tuple[str, str, str, str]:
    candidate_system_prompt = await resolve_setting_value(
        key="knowledge_candidate_system_prompt",
        env_keys=(),
        default=DEFAULT_KNOWLEDGE_CANDIDATE_SYSTEM_PROMPT,
    )
    if not candidate_system_prompt:
        candidate_system_prompt = DEFAULT_KNOWLEDGE_CANDIDATE_SYSTEM_PROMPT

    candidate_user_template = await resolve_setting_value(
        key="knowledge_candidate_user_prompt_template",
        env_keys=(),
        default=DEFAULT_KNOWLEDGE_CANDIDATE_USER_PROMPT_TEMPLATE,
    )
    if not candidate_user_template:
        candidate_user_template = DEFAULT_KNOWLEDGE_CANDIDATE_USER_PROMPT_TEMPLATE

    final_system_prompt = await resolve_setting_value(
        key="knowledge_final_system_prompt",
        env_keys=(),
        default=DEFAULT_KNOWLEDGE_FINAL_SYSTEM_PROMPT,
    )
    if not final_system_prompt:
        final_system_prompt = DEFAULT_KNOWLEDGE_FINAL_SYSTEM_PROMPT

    final_user_template = await resolve_setting_value(
        key="knowledge_final_user_prompt_template",
        env_keys=(),
        default=DEFAULT_KNOWLEDGE_FINAL_USER_PROMPT_TEMPLATE,
    )
    if not final_user_template:
        final_user_template = DEFAULT_KNOWLEDGE_FINAL_USER_PROMPT_TEMPLATE

    return (
        candidate_system_prompt,
        candidate_user_template,
        final_system_prompt,
        final_user_template,
    )


def _normalize_question_text(text: str) -> str:
    return " ".join(str(text).split()).strip()


def question_fingerprint(text: str) -> str:
    normalized = _normalize_question_text(text).lower()
    return hashlib.sha256(normalized.encode("utf-8")).hexdigest()


def _paper_meta_for_prompt(paper: Paper) -> dict[str, str]:
    authors = "、".join([str(a).strip() for a in (paper.authors or []) if str(a).strip()]) or "未知"
    keywords = "、".join([str(k).strip() for k in (paper.ai_keywords or []) if str(k).strip()]) or "无"
    return {
        "PAPER_ID": paper.id,
        "PAPER_TITLE": paper.title,
        "PAPER_AUTHORS": authors,
        "PAPER_ORGANIZATION": paper.organization or "未知",
        "PAPER_KEYWORDS": keywords,
    }


async def _invoke_llm_text(
    *,
    llm_settings: Any,
    system_prompt: str,
    user_prompt: str,
    temperature: float,
) -> tuple[str, dict[str, Any], int]:
    response_text, response_payload, latency_ms = await asyncio.to_thread(
        invoke_llm_sync,
        settings=llm_settings,
        system_prompt=system_prompt,
        user_prompt=user_prompt,
        temperature=temperature,
        response_mime_type="text/plain",
    )
    text = (response_text or "").strip()
    if not text:
        raise ValueError("模型返回为空。")
    return text, response_payload, latency_ms


async def _load_report_with_paper(report_id: uuid.UUID) -> PaperReadingReport:
    report = (
        await PaperReadingReport.filter(id=report_id)
        .select_related("paper")
        .first()
    )
    if report is None:
        raise ValueError("Reading report not found")
    return report


async def _prepare_run(report: PaperReadingReport) -> tuple[KnowledgeExtractionRun, bool]:
    run = await KnowledgeExtractionRun.get_or_none(report=report)
    if run is not None and run.status == "succeeded":
        return run, False
    if run is not None and run.status == "running":
        return run, False

    if run is None:
        run = await KnowledgeExtractionRun.create(
            report=report,
            status="running",
            attempt_count=1,
            question_ids=[],
            finished_at=None,
            error_message=None,
            raw_candidates_xml=None,
            raw_final_xml=None,
        )
        return run, True

    run.status = "running"
    run.attempt_count = int(run.attempt_count) + 1
    run.question_ids = []
    run.error_message = None
    run.raw_candidates_xml = None
    run.raw_final_xml = None
    run.finished_at = None
    run.llm_invocation_stage1_id = None
    run.llm_invocation_stage2_id = None
    await run.save(
        update_fields=[
            "status",
            "attempt_count",
            "question_ids",
            "error_message",
            "raw_candidates_xml",
            "raw_final_xml",
            "finished_at",
            "llm_invocation_stage1_id",
            "llm_invocation_stage2_id",
            "updated_at",
        ]
    )
    return run, True


async def _load_all_questions_for_recall() -> list[dict[str, Any]]:
    questions = await KnowledgeQuestion.all().order_by("-updated_at")
    records: list[dict[str, Any]] = []
    for item in questions:
        embedding = item.embedding if isinstance(item.embedding, list) else []
        records.append(
            {
                "id": str(item.id),
                "question": item.question,
                "embedding": embedding,
            }
        )
    return records


async def _sync_persistent_faiss_index() -> None:
    await sync_embedding_model_from_runtime_settings()
    records = await _load_all_questions_for_recall()
    await asyncio.to_thread(rebuild_persistent_question_index, records)


async def _materialize_question(
    *,
    action: str,
    target_question_id: str,
    question_text: str,
    created_by: str,
    existing_question_by_id: dict[str, KnowledgeQuestion],
) -> KnowledgeQuestion:
    normalized = _normalize_question_text(question_text)
    if not normalized:
        raise ValueError("最终问题 text 为空。")

    if action == "reuse":
        question = existing_question_by_id.get(target_question_id)
        if question is None:
            raise ValueError(f"target_question_id 不存在: {target_question_id}")
        return question

    fingerprint = question_fingerprint(normalized)
    existing = await KnowledgeQuestion.get_or_none(fingerprint=fingerprint)
    if existing is not None:
        return existing

    embedding = encode_text(normalized)
    question = await KnowledgeQuestion.create(
        question=normalized,
        fingerprint=fingerprint,
        embedding=embedding,
        embedding_model=get_embedding_model_name(),
        created_by=created_by,
    )
    return question


async def _persist_final_question_set(
    *,
    report: PaperReadingReport,
    final_items: list[dict[str, str]],
    recall_question_ids: set[str],
) -> list[str]:
    paper = report.paper if hasattr(report, "paper") else None
    if paper is None:
        paper = await Paper.get(id=report.paper_id)

    existing_questions = await KnowledgeQuestion.all()
    existing_question_by_id = {str(item.id): item for item in existing_questions}

    persisted_question_ids: list[str] = []
    for item in final_items:
        action = item["action"]
        target_question_id = item["target_question_id"].strip()
        if action == "reuse" and target_question_id not in recall_question_ids:
            raise ValueError(
                f"LLM 选择复用的问题不在召回候选中: {target_question_id}"
            )

        question = await _materialize_question(
            action=action,
            target_question_id=target_question_id,
            question_text=item["text"],
            created_by="agent",
            existing_question_by_id=existing_question_by_id,
        )
        existing_question_by_id[str(question.id)] = question

        await KnowledgeSolution.update_or_create(
            question=question,
            report=report,
            defaults={
                "paper": paper,
                "method_summary": item["method_summary"].strip(),
                "effect_summary": item["effect_summary"].strip(),
                "limitations": item["limitations"].strip(),
            },
        )
        persisted_question_ids.append(str(question.id))

    ordered_unique = list(dict.fromkeys(persisted_question_ids))
    return ordered_unique


def _run_to_response(
    run: KnowledgeExtractionRun,
    *,
    deduplicated: bool = False,
    message: str | None = None,
) -> dict[str, Any]:
    return {
        "runId": str(run.id),
        "status": run.status,
        "locked": run.status == "succeeded",
        "attemptCount": int(run.attempt_count),
        "questionIds": [str(item) for item in (run.question_ids or [])],
        "errorMessage": run.error_message,
        "startedAt": run.started_at.isoformat() if run.started_at else None,
        "finishedAt": run.finished_at.isoformat() if run.finished_at else None,
        "deduplicated": deduplicated,
        "message": message
        or (
            "该报告的知识提炼已成功，结果已锁定。"
            if deduplicated
            else "知识提炼已执行。"
        ),
    }


_BACKGROUND_EXTRACTION_TASKS: set[asyncio.Task[None]] = set()


async def _prepare_extraction_prerequisites(report: PaperReadingReport) -> str:
    full_report = normalize_stage2_markdown_text(report.full_report or "")
    if not full_report:
        raise ValueError("full report 为空，无法提炼知识库问题。")
    await sync_embedding_model_from_runtime_settings()
    assert_embedding_model_ready()
    return full_report


def _track_background_task(task: asyncio.Task[None]) -> None:
    _BACKGROUND_EXTRACTION_TASKS.add(task)

    def _cleanup(done_task: asyncio.Task[None]) -> None:
        _BACKGROUND_EXTRACTION_TASKS.discard(done_task)

    task.add_done_callback(_cleanup)


async def _execute_prepared_extraction_run(
    *,
    report: PaperReadingReport,
    run: KnowledgeExtractionRun,
    full_report: str | None = None,
) -> dict[str, Any]:
    invocation1: LLMInvocationLog | None = None
    invocation2: LLMInvocationLog | None = None

    try:
        await sync_embedding_model_from_runtime_settings()
        llm_settings = await get_llm_runtime_settings()
        paper = report.paper if hasattr(report, "paper") else None
        if paper is None:
            paper = await Paper.get(id=report.paper_id)
        prepared_full_report = full_report or await _prepare_extraction_prerequisites(report)

        paper_meta = _paper_meta_for_prompt(paper)
        (
            candidate_system_prompt,
            candidate_user_prompt_template,
            final_system_prompt,
            final_user_prompt_template,
        ) = await _get_knowledge_prompt_templates()

        candidate_user_prompt = _render_prompt_template(
            candidate_user_prompt_template,
            {
                **paper_meta,
                "FULL_REPORT": prepared_full_report,
            },
        )
        invocation1 = await LLMInvocationLog.create(
            provider=llm_settings.provider,
            model=llm_settings.model,
            stage=STAGE_KNOWLEDGE_BASE,
            task=TASK_QUESTION_CANDIDATES,
            workflow=None,
            stage_execution=None,
            input_payload={
                "provider": llm_settings.provider,
                "model": llm_settings.model,
                "base_url": llm_settings.base_url,
                "google_thinking_level": llm_settings.google_thinking_level,
                "temperature": DEFAULT_CANDIDATE_TEMPERATURE,
                "system_prompt": candidate_system_prompt,
                "user_prompt": candidate_user_prompt,
                "report_id": str(report.id),
                "paper_id": paper.id,
            },
            metadata={"report_id": str(report.id), "paper_id": paper.id},
            status="running",
        )

        candidate_raw_text, candidate_payload, candidate_latency = await _invoke_llm_text(
            llm_settings=llm_settings,
            system_prompt=candidate_system_prompt,
            user_prompt=candidate_user_prompt,
            temperature=DEFAULT_CANDIDATE_TEMPERATURE,
        )
        candidate_questions, candidate_xml = parse_question_candidates(
            candidate_raw_text,
            min_items=1,
            max_items=5,
        )
        invocation1.status = "succeeded"
        invocation1.output_payload = candidate_payload
        invocation1.output_text = candidate_raw_text
        invocation1.latency_ms = candidate_latency
        await invocation1.save(
            update_fields=["status", "output_payload", "output_text", "latency_ms"]
        )

        candidate_embeddings = encode_texts(candidate_questions)
        existing_questions = await _load_all_questions_for_recall()
        recall_results = search_similar_questions(
            query_embeddings=candidate_embeddings,
            questions=existing_questions,
            top_k=DEFAULT_RECALL_TOP_K,
        )
        recall_rows: list[dict[str, Any]] = []
        for question, retrieved in zip(candidate_questions, recall_results, strict=True):
            recall_rows.append({"candidate_question": question, "retrieved": retrieved})
        recall_question_ids = {
            str(item["id"])
            for row in recall_rows
            for item in row.get("retrieved", [])
            if isinstance(item, dict) and item.get("id")
        }

        final_user_prompt = _render_prompt_template(
            final_user_prompt_template,
            {
                **paper_meta,
                "FULL_REPORT": "",
                "CANDIDATE_XML": candidates_to_xml(candidate_questions),
                "RECALL_CONTEXT": recall_context_to_json_like(recall_rows),
            },
        )
        invocation2 = await LLMInvocationLog.create(
            provider=llm_settings.provider,
            model=llm_settings.model,
            stage=STAGE_KNOWLEDGE_BASE,
            task=TASK_FINAL_QUESTION_SET,
            workflow=None,
            stage_execution=None,
            input_payload={
                "provider": llm_settings.provider,
                "model": llm_settings.model,
                "base_url": llm_settings.base_url,
                "google_thinking_level": llm_settings.google_thinking_level,
                "temperature": DEFAULT_FINAL_TEMPERATURE,
                "system_prompt": final_system_prompt,
                "user_prompt": final_user_prompt,
                "report_id": str(report.id),
                "paper_id": paper.id,
                "candidate_questions": candidate_questions,
                "recall_rows": recall_rows,
            },
            metadata={"report_id": str(report.id), "paper_id": paper.id},
            status="running",
        )

        final_raw_text, final_payload, final_latency = await _invoke_llm_text(
            llm_settings=llm_settings,
            system_prompt=final_system_prompt,
            user_prompt=final_user_prompt,
            temperature=DEFAULT_FINAL_TEMPERATURE,
        )
        final_items, final_xml = parse_final_question_set(
            final_raw_text,
            min_items=1,
            max_items=5,
        )

        invocation2.status = "succeeded"
        invocation2.output_payload = final_payload
        invocation2.output_text = final_raw_text
        invocation2.latency_ms = final_latency
        await invocation2.save(
            update_fields=["status", "output_payload", "output_text", "latency_ms"]
        )

        question_ids = await _persist_final_question_set(
            report=report,
            final_items=final_items,
            recall_question_ids=recall_question_ids,
        )

        run.status = "succeeded"
        run.question_ids = question_ids
        run.error_message = None
        run.raw_candidates_xml = candidate_xml
        run.raw_final_xml = final_xml
        run.llm_invocation_stage1_id = invocation1.id if invocation1 else None
        run.llm_invocation_stage2_id = invocation2.id if invocation2 else None
        run.finished_at = datetime.now(tz=UTC)
        await run.save(
            update_fields=[
                "status",
                "question_ids",
                "error_message",
                "raw_candidates_xml",
                "raw_final_xml",
                "llm_invocation_stage1_id",
                "llm_invocation_stage2_id",
                "finished_at",
                "updated_at",
            ]
        )
        await _sync_persistent_faiss_index()
        return _run_to_response(run)
    except Exception as exc:
        if invocation1 is not None and invocation1.status == "running":
            invocation1.status = "failed"
            invocation1.error_message = str(exc)
            await invocation1.save(update_fields=["status", "error_message"])
        if invocation2 is not None and invocation2.status == "running":
            invocation2.status = "failed"
            invocation2.error_message = str(exc)
            await invocation2.save(update_fields=["status", "error_message"])

        run.status = "failed"
        run.error_message = str(exc)
        run.finished_at = datetime.now(tz=UTC)
        run.llm_invocation_stage1_id = invocation1.id if invocation1 else None
        run.llm_invocation_stage2_id = invocation2.id if invocation2 else None
        await run.save(
            update_fields=[
                "status",
                "error_message",
                "finished_at",
                "llm_invocation_stage1_id",
                "llm_invocation_stage2_id",
                "updated_at",
            ]
        )
        try:
            await _sync_persistent_faiss_index()
        except Exception:
            logger.exception(
                "Faiss persistent index sync failed after extraction error: report_id=%s",
                report.id,
            )
        logger.exception("Knowledge extraction failed: report_id=%s", report.id)
        raise


async def extract_knowledge_from_report(report_id: uuid.UUID) -> dict[str, Any]:
    report = await _load_report_with_paper(report_id)
    run, should_execute = await _prepare_run(report)

    if not should_execute:
        if run.status == "succeeded":
            return _run_to_response(run, deduplicated=True)
        return _run_to_response(run, deduplicated=True, message="知识提炼正在运行中。")

    return await _execute_prepared_extraction_run(report=report, run=run)


async def trigger_knowledge_extraction_in_background(report_id: uuid.UUID) -> dict[str, Any]:
    report = await _load_report_with_paper(report_id)
    prepared_full_report = await _prepare_extraction_prerequisites(report)
    run, should_execute = await _prepare_run(report)

    if not should_execute:
        if run.status == "succeeded":
            return _run_to_response(run, deduplicated=True)
        return _run_to_response(run, deduplicated=True, message="知识提炼正在运行中。")

    async def _runner() -> None:
        try:
            await _execute_prepared_extraction_run(
                report=report,
                run=run,
                full_report=prepared_full_report,
            )
        except Exception:
            logger.exception("Background knowledge extraction failed: report_id=%s", report.id)

    task = asyncio.create_task(_runner())
    _track_background_task(task)
    return _run_to_response(run, message="知识提炼任务已提交，正在后台执行。")
