from typing import Any

from deeplab.daily_papers.paper_reading import normalize_stage2_markdown_text
from deeplab.model import (
    Paper,
    PaperReadingReport,
    RuntimeSetting,
    ScreeningRule,
    WorkflowExecution,
    WorkflowStageExecution,
)
from deeplab.runtime_settings import default_runtime_setting_value, runtime_setting_spec


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

