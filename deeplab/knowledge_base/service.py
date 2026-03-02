import asyncio
import hashlib
import uuid
from typing import Any

from deeplab.knowledge_base.embedding import encode_text, get_embedding_model_name
from deeplab.knowledge_base.embedding import sync_embedding_model_from_runtime_settings
from deeplab.knowledge_base.similarity import rebuild_persistent_question_index
from deeplab.model import (
    KnowledgeExtractionRun,
    KnowledgeQuestion,
    KnowledgeSolution,
    PaperReadingReport,
)


def _normalize_question_text(text: str) -> str:
    return " ".join(str(text).split()).strip()


def question_fingerprint(text: str) -> str:
    normalized = _normalize_question_text(text).lower()
    return hashlib.sha256(normalized.encode("utf-8")).hexdigest()


def _question_to_summary_dict(question: KnowledgeQuestion, *, solution_count: int) -> dict[str, Any]:
    return {
        "id": str(question.id),
        "question": question.question,
        "createdBy": question.created_by,
        "createdAt": question.created_at.isoformat(),
        "updatedAt": question.updated_at.isoformat(),
        "solutionCount": solution_count,
    }


def knowledge_extraction_state_dict(
    run: KnowledgeExtractionRun | None,
) -> dict[str, Any]:
    if run is None:
        return {
            "runId": None,
            "status": "not_started",
            "locked": False,
            "attemptCount": 0,
            "errorMessage": None,
            "startedAt": None,
            "finishedAt": None,
            "questionIds": [],
        }
    return {
        "runId": str(run.id),
        "status": run.status,
        "locked": run.status == "succeeded",
        "attemptCount": int(run.attempt_count),
        "errorMessage": run.error_message,
        "startedAt": run.started_at.isoformat() if run.started_at else None,
        "finishedAt": run.finished_at.isoformat() if run.finished_at else None,
        "questionIds": [str(item) for item in (run.question_ids or [])],
    }


async def _sync_persistent_faiss_index() -> None:
    await sync_embedding_model_from_runtime_settings()
    all_questions = await KnowledgeQuestion.all().order_by("-updated_at")
    records: list[dict[str, Any]] = []
    for question in all_questions:
        embedding = question.embedding if isinstance(question.embedding, list) else []
        records.append(
            {
                "id": str(question.id),
                "question": question.question,
                "embedding": embedding,
            }
        )
    await asyncio.to_thread(rebuild_persistent_question_index, records)


async def trigger_report_knowledge_extraction(report_id: uuid.UUID) -> dict[str, Any]:
    from deeplab.knowledge_base.extraction import (
        trigger_knowledge_extraction_in_background,
    )

    return await trigger_knowledge_extraction_in_background(report_id)


async def list_knowledge_questions(
    *,
    search: str | None = None,
    limit: int = 20,
) -> list[dict[str, Any]]:
    safe_limit = min(max(limit, 1), 200)
    query = KnowledgeQuestion.all()
    keyword = (search or "").strip()
    if keyword:
        query = query.filter(question__icontains=keyword)

    questions = await query.order_by("-updated_at").limit(safe_limit).prefetch_related("solutions")
    return [
        _question_to_summary_dict(
            question,
            solution_count=len(question.solutions) if hasattr(question, "solutions") else 0,
        )
        for question in questions
    ]


async def create_manual_knowledge_question(
    *,
    question_text: str,
    created_by: str = "user",
) -> dict[str, Any]:
    await sync_embedding_model_from_runtime_settings()
    normalized = _normalize_question_text(question_text)
    if not normalized:
        raise ValueError("question 不能为空。")

    fingerprint = question_fingerprint(normalized)
    existing = await KnowledgeQuestion.get_or_none(fingerprint=fingerprint)
    if existing is not None:
        solution_count = await KnowledgeSolution.filter(question=existing).count()
        return {
            "questionId": str(existing.id),
            "deduplicated": True,
            "question": _question_to_summary_dict(existing, solution_count=solution_count),
        }

    embedding = encode_text(normalized)
    created = await KnowledgeQuestion.create(
        question=normalized,
        fingerprint=fingerprint,
        embedding=embedding,
        embedding_model=get_embedding_model_name(),
        created_by=(created_by or "user").strip() or "user",
    )
    await _sync_persistent_faiss_index()
    return {
        "questionId": str(created.id),
        "deduplicated": False,
        "question": _question_to_summary_dict(created, solution_count=0),
    }


async def update_knowledge_question(
    *,
    question_id: uuid.UUID,
    question_text: str,
) -> dict[str, Any] | None:
    await sync_embedding_model_from_runtime_settings()
    question = await KnowledgeQuestion.get_or_none(id=question_id)
    if question is None:
        return None

    normalized = _normalize_question_text(question_text)
    if not normalized:
        raise ValueError("question 不能为空。")

    fingerprint = question_fingerprint(normalized)
    duplicated = await KnowledgeQuestion.get_or_none(fingerprint=fingerprint)
    if duplicated is not None and duplicated.id != question.id:
        raise ValueError("已存在相同问题，无法修改为重复问题。")

    question.question = normalized
    question.fingerprint = fingerprint
    question.embedding = encode_text(normalized)
    question.embedding_model = get_embedding_model_name()
    await question.save(
        update_fields=[
            "question",
            "fingerprint",
            "embedding",
            "embedding_model",
            "updated_at",
        ]
    )
    await _sync_persistent_faiss_index()

    solution_count = await KnowledgeSolution.filter(question=question).count()
    return {
        "questionId": str(question.id),
        "question": _question_to_summary_dict(question, solution_count=solution_count),
    }


async def delete_knowledge_question(*, question_id: uuid.UUID) -> dict[str, Any] | None:
    question = await KnowledgeQuestion.get_or_none(id=question_id)
    if question is None:
        return None

    deleted_solutions = await KnowledgeSolution.filter(question=question).delete()
    deleted_questions = await KnowledgeQuestion.filter(id=question_id).delete()
    if deleted_questions == 0:
        return None
    await _sync_persistent_faiss_index()

    return {
        "deleted": True,
        "questionId": str(question_id),
        "deletedSolutions": int(deleted_solutions),
    }


async def get_knowledge_question_detail(question_id: uuid.UUID) -> dict[str, Any] | None:
    question = await KnowledgeQuestion.get_or_none(id=question_id)
    if question is None:
        return None

    solutions = (
        await KnowledgeSolution.filter(question=question)
        .select_related("paper", "report")
        .order_by("-updated_at")
        .all()
    )
    payload_solutions: list[dict[str, Any]] = []
    for item in solutions:
        paper = item.paper if hasattr(item, "paper") else None
        report = item.report if hasattr(item, "report") else None
        payload_solutions.append(
            {
                "id": str(item.id),
                "questionId": str(item.question_id),
                "paperId": item.paper_id,
                "paperTitle": paper.title if paper else None,
                "reportId": str(item.report_id) if item.report_id else None,
                "methodSummary": item.method_summary,
                "effectSummary": item.effect_summary,
                "limitations": item.limitations,
                "createdAt": item.created_at.isoformat(),
                "updatedAt": item.updated_at.isoformat(),
            }
        )

    return {
        **_question_to_summary_dict(question, solution_count=len(payload_solutions)),
        "solutions": payload_solutions,
    }


async def get_reading_report_knowledge_payload(report: PaperReadingReport) -> dict[str, Any]:
    run = await KnowledgeExtractionRun.get_or_none(report=report)
    solutions = (
        await KnowledgeSolution.filter(report=report)
        .select_related("question")
        .order_by("-updated_at")
        .all()
    )

    questions: list[dict[str, Any]] = []
    seen_question_ids: set[str] = set()
    for solution in solutions:
        question = solution.question if hasattr(solution, "question") else None
        if question is None:
            continue
        question_id = str(question.id)
        if question_id in seen_question_ids:
            continue
        seen_question_ids.add(question_id)
        solution_count = await KnowledgeSolution.filter(question=question).count()
        questions.append(_question_to_summary_dict(question, solution_count=solution_count))

    return {
        "knowledgeExtraction": knowledge_extraction_state_dict(run),
        "knowledgeQuestions": questions,
    }
