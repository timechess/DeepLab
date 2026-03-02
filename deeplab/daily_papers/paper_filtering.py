import asyncio
import json
import logging
import re
from datetime import UTC, datetime
from typing import Any

from deeplab.llm_provider import LLMRuntimeSettings, get_llm_runtime_settings, invoke_llm_sync
from deeplab.model import (
    LLMInvocationLog,
    Paper,
    PaperFilteringDecision,
    PaperFilteringRun,
    ScreeningRule,
    WorkflowExecution,
    WorkflowStageExecution,
)
from deeplab.runtime_settings import (
    DEFAULT_INITIAL_SCREENING_SYSTEM_PROMPT,
    DEFAULT_INITIAL_SCREENING_TEMPERATURE,
    DEFAULT_INITIAL_SCREENING_USER_PROMPT_TEMPLATE,
    INITIAL_SCREENING_TEMPERATURE_ENV_KEYS,
    resolve_setting_value,
)

WORKFLOW_NAME_DAILY_PAPER_REPORTS = "daily_paper_reports"
STAGE_PAPER_FILTERING = "paper_filtering"
TASK_INITIAL_SCREENING = "initial_screening"

TOP_N_CANDIDATES = 15
MAX_SELECTED_PAPERS = 5
DEFAULT_TEMPERATURE = 1

logger = logging.getLogger(__name__)


def _render_prompt_template(template: str, variables: dict[str, str]) -> str:
    rendered = template
    for key, value in variables.items():
        rendered = rendered.replace(f"{{{{{key}}}}}", value)
    return rendered.strip()


async def _get_initial_screening_prompt_templates() -> tuple[str, str]:
    system_prompt = await resolve_setting_value(
        key="initial_screening_system_prompt",
        env_keys=(),
        default=DEFAULT_INITIAL_SCREENING_SYSTEM_PROMPT,
    )
    if not system_prompt:
        system_prompt = DEFAULT_INITIAL_SCREENING_SYSTEM_PROMPT

    user_prompt_template = await resolve_setting_value(
        key="initial_screening_user_prompt_template",
        env_keys=(),
        default=DEFAULT_INITIAL_SCREENING_USER_PROMPT_TEMPLATE,
    )
    if not user_prompt_template:
        user_prompt_template = DEFAULT_INITIAL_SCREENING_USER_PROMPT_TEMPLATE

    return system_prompt, user_prompt_template


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


async def _get_initial_screening_temperature() -> float:
    raw_value = await resolve_setting_value(
        key="initial_screening_temperature",
        env_keys=INITIAL_SCREENING_TEMPERATURE_ENV_KEYS,
        default=DEFAULT_INITIAL_SCREENING_TEMPERATURE,
    )
    return _parse_temperature(
        raw_value,
        field_name="initial_screening_temperature",
        default=DEFAULT_TEMPERATURE,
    )


async def _mark_workflow_llm_usage(
    workflow_execution: WorkflowExecution | None,
    *,
    provider: str,
    model: str,
    temperature: float,
    google_thinking_level: str | None,
) -> None:
    if workflow_execution is None:
        return

    context = dict(workflow_execution.context or {})
    llm_usage = context.get("llmUsage")
    if not isinstance(llm_usage, dict):
        llm_usage = {}

    llm_usage[STAGE_PAPER_FILTERING] = {
        "provider": provider,
        "model": model,
        "temperature": temperature,
        "google_thinking_level": google_thinking_level,
    }

    context["llmUsage"] = llm_usage
    workflow_execution.context = context
    await workflow_execution.save(update_fields=["context"])


def _paper_to_prompt_record(paper: Paper) -> dict[str, Any]:
    return {
        "id": paper.id,
        "title": paper.title,
        "summary": paper.summary,
        "ai_keywords": paper.ai_keywords or [],
        "upvotes": paper.upvotes,
    }


def _rule_to_prompt_record(rule: ScreeningRule) -> str:
    return str(rule.rule).strip()


def _build_initial_screening_prompts(
    candidates: list[Paper],
    rules: list[ScreeningRule],
    system_prompt_template: str,
    user_prompt_template: str,
) -> tuple[str, str]:
    system_prompt = (system_prompt_template or "").strip()
    if not system_prompt:
        system_prompt = DEFAULT_INITIAL_SCREENING_SYSTEM_PROMPT

    candidate_json = json.dumps(
        [_paper_to_prompt_record(p) for p in candidates], ensure_ascii=False, indent=2
    )
    rule_list = "\n".join([_rule_to_prompt_record(rule) for rule in rules]).strip() or "（无）"

    template = (user_prompt_template or "").strip()
    if not template:
        template = DEFAULT_INITIAL_SCREENING_USER_PROMPT_TEMPLATE
    user_prompt = _render_prompt_template(
        template,
        {
            "TOP_N_CANDIDATES": str(TOP_N_CANDIDATES),
            "MAX_SELECTED_PAPERS": str(MAX_SELECTED_PAPERS),
            "CANDIDATES_JSON": candidate_json,
            "RULE_LIST": rule_list,
        },
    )
    return system_prompt, user_prompt


def _extract_json_from_text(text: str) -> dict[str, Any]:
    content = text.strip()
    if not content:
        raise ValueError("模型返回为空。")

    try:
        return json.loads(content)
    except json.JSONDecodeError:
        pass

    fenced_blocks = re.findall(r"```(?:json)?\s*(\{.*?\})\s*```", content, flags=re.DOTALL)
    for block in fenced_blocks:
        try:
            return json.loads(block)
        except json.JSONDecodeError:
            continue

    left = content.find("{")
    right = content.rfind("}")
    if left != -1 and right != -1 and right > left:
        candidate = content[left : right + 1]
        try:
            return json.loads(candidate)
        except json.JSONDecodeError as exc:
            raise ValueError("模型返回不是合法 JSON。") from exc

    raise ValueError("模型返回中未找到可解析的 JSON 对象。")


def _safe_float(value: Any) -> float | None:
    if value is None:
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def _safe_int(value: Any) -> int | None:
    if value is None:
        return None
    try:
        return int(value)
    except (TypeError, ValueError):
        return None


def _normalize_llm_result(
    llm_result: dict[str, Any], candidates: list[Paper]
) -> tuple[str, list[dict[str, Any]], list[str]]:
    if not isinstance(llm_result, dict):
        raise ValueError("模型返回结构不正确，期望为 JSON 对象。")

    summary = str(llm_result.get("summary", "")).strip()
    selected_ids_hint = {
        str(item).strip()
        for item in llm_result.get("selected_ids", [])
        if str(item).strip()
    }
    candidate_map = {paper.id: paper for paper in candidates}
    decisions_map: dict[str, dict[str, Any]] = {}

    raw_decisions = llm_result.get("decisions", [])
    if not isinstance(raw_decisions, list):
        raw_decisions = []

    for raw in raw_decisions:
        if not isinstance(raw, dict):
            continue
        paper_id = str(raw.get("id", "")).strip()
        if not paper_id or paper_id not in candidate_map:
            continue

        selected = (
            bool(raw.get("selected"))
            if "selected" in raw
            else paper_id in selected_ids_hint
        )
        reason = str(raw.get("reason", "")).strip() or "模型未给出明确理由。"
        score = _safe_float(raw.get("score"))
        rank = _safe_int(raw.get("rank")) if selected else None
        tags = raw.get("tags", [])
        if not isinstance(tags, list):
            tags = [str(tags)]

        extra = {
            key: value
            for key, value in raw.items()
            if key not in {"id", "selected", "reason", "score", "rank", "tags"}
        }

        decisions_map[paper_id] = {
            "id": paper_id,
            "selected": selected,
            "reason": reason,
            "score": score,
            "rank": rank,
            "tags": tags,
            "extra": extra,
        }

    for paper in candidates:
        if paper.id in decisions_map:
            continue
        inferred_selected = paper.id in selected_ids_hint
        decisions_map[paper.id] = {
            "id": paper.id,
            "selected": inferred_selected,
            "reason": "模型未返回该论文的结构化判断，已自动补全。",
            "score": None,
            "rank": None,
            "tags": [],
            "extra": {},
        }

    selected_candidates = [d for d in decisions_map.values() if d["selected"]]
    selected_candidates.sort(
        key=lambda d: (
            d["rank"] if d["rank"] is not None else 10**9,
            -(d["score"] if d["score"] is not None else -1),
            -candidate_map[d["id"]].upvotes,
        )
    )
    kept_selected = {item["id"] for item in selected_candidates[:MAX_SELECTED_PAPERS]}

    for decision in decisions_map.values():
        if decision["selected"] and decision["id"] not in kept_selected:
            decision["selected"] = False
            decision["rank"] = None
            decision["reason"] = (
                decision["reason"] + f"（超出最多 {MAX_SELECTED_PAPERS} 篇的上限，系统自动降级为未入选）"
            )

    final_selected = [item["id"] for item in selected_candidates[:MAX_SELECTED_PAPERS]]
    for idx, paper_id in enumerate(final_selected, start=1):
        decisions_map[paper_id]["rank"] = idx

    decisions = list(decisions_map.values())
    decisions.sort(
        key=lambda d: (
            0 if d["selected"] else 1,
            d["rank"] if d["rank"] is not None else 10**9,
            -(d["score"] if d["score"] is not None else -1),
            -candidate_map[d["id"]].upvotes,
        )
    )
    return summary, decisions, final_selected


async def _load_candidate_papers(candidate_paper_ids: list[str] | None) -> list[Paper]:
    query = Paper.all()
    if candidate_paper_ids:
        clean_ids = [paper_id.strip() for paper_id in candidate_paper_ids if paper_id.strip()]
        if not clean_ids:
            return []
        query = query.filter(id__in=clean_ids)
    return await query.order_by("-upvotes", "-published_at").limit(TOP_N_CANDIDATES)


async def run_initial_screening(
    candidate_paper_ids: list[str] | None = None,
    trigger_type: str = "manual",
    workflow_execution: WorkflowExecution | None = None,
    stage_execution: WorkflowStageExecution | None = None,
    task_metadata: dict[str, Any] | None = None,
) -> dict[str, Any]:
    task_metadata = task_metadata or {}
    candidates = await _load_candidate_papers(candidate_paper_ids)
    if not candidates:
        raise ValueError("没有可用于初筛的论文，请先执行论文抓取。")

    rules = await ScreeningRule.all().order_by("id")
    candidate_ids = [paper.id for paper in candidates]

    filtering_run = await PaperFilteringRun.create(
        trigger_type=trigger_type,
        status="running",
        workflow=workflow_execution,
        stage_execution=stage_execution,
        candidate_paper_ids=candidate_ids,
    )

    llm_settings: LLMRuntimeSettings | None = None
    system_prompt = ""
    user_prompt = ""
    temperature = DEFAULT_TEMPERATURE
    invocation: LLMInvocationLog | None = None
    try:
        llm_settings = await get_llm_runtime_settings()
        system_prompt_template, user_prompt_template = await _get_initial_screening_prompt_templates()
        temperature = await _get_initial_screening_temperature()
        await _mark_workflow_llm_usage(
            workflow_execution,
            provider=llm_settings.provider,
            model=llm_settings.model,
            temperature=temperature,
            google_thinking_level=llm_settings.google_thinking_level,
        )
        system_prompt, user_prompt = _build_initial_screening_prompts(
            candidates,
            rules,
            system_prompt_template,
            user_prompt_template,
        )

        invocation = await LLMInvocationLog.create(
            provider=llm_settings.provider,
            model=llm_settings.model,
            stage=STAGE_PAPER_FILTERING,
            task=TASK_INITIAL_SCREENING,
            workflow=workflow_execution,
            stage_execution=stage_execution,
            input_payload={
                "provider": llm_settings.provider,
                "model": llm_settings.model,
                "base_url": llm_settings.base_url,
                "google_thinking_level": llm_settings.google_thinking_level,
                "temperature": temperature,
                "system_prompt": system_prompt,
                "user_prompt": user_prompt,
                "candidate_paper_ids": candidate_ids,
                "rule_ids": [rule.id for rule in rules],
                "trigger_type": trigger_type,
            },
            metadata={
                "task_metadata": task_metadata,
                "candidate_count": len(candidates),
                "rule_count": len(rules),
            },
            status="running",
        )
        filtering_run.llm_invocation_id = invocation.id
        await filtering_run.save(update_fields=["llm_invocation_id"])

        response_text, response_payload, latency_ms = await asyncio.to_thread(
            invoke_llm_sync,
            settings=llm_settings,
            system_prompt=system_prompt,
            user_prompt=user_prompt,
            temperature=temperature,
            response_mime_type="application/json",
        )
        llm_result = response_payload.get("parsed")
        if llm_result is None:
            llm_result = _extract_json_from_text(response_text)
        elif isinstance(llm_result, str):
            llm_result = _extract_json_from_text(llm_result)
        elif not isinstance(llm_result, dict):
            llm_result = _extract_json_from_text(json.dumps(llm_result, ensure_ascii=False))

        summary, decisions, selected_ids = _normalize_llm_result(llm_result, candidates)

        papers_by_id = {paper.id: paper for paper in candidates}
        for decision in decisions:
            paper = papers_by_id[decision["id"]]
            await PaperFilteringDecision.create(
                filtering_run=filtering_run,
                paper=paper,
                selected=decision["selected"],
                reason=decision["reason"],
                score=decision["score"],
                rank=decision["rank"],
                extra={
                    "tags": decision.get("tags", []),
                    "extra": decision.get("extra", {}),
                },
            )

        now = datetime.now(tz=UTC)
        filtering_run.status = "succeeded"
        filtering_run.selected_paper_ids = selected_ids
        filtering_run.raw_result = llm_result
        filtering_run.summary = summary
        filtering_run.finished_at = now
        await filtering_run.save(
            update_fields=["status", "selected_paper_ids", "raw_result", "summary", "finished_at"]
        )

        if invocation:
            invocation.status = "succeeded"
            invocation.output_payload = response_payload
            invocation.output_text = response_text
            invocation.latency_ms = latency_ms
            await invocation.save(
                update_fields=["status", "output_payload", "output_text", "latency_ms"]
            )

        selected_details = []
        for selected_id in selected_ids:
            paper = papers_by_id[selected_id]
            decision = next(item for item in decisions if item["id"] == selected_id)
            selected_details.append(
                {
                    "id": paper.id,
                    "title": paper.title,
                    "reason": decision["reason"],
                    "score": decision["score"],
                    "rank": decision["rank"],
                }
            )

        return {
            "run_id": str(filtering_run.id),
            "llm_invocation_id": str(invocation.id) if invocation else None,
            "summary": summary,
            "candidate_count": len(candidates),
            "selected_count": len(selected_ids),
            "selected_papers": selected_details,
            "candidate_ids": candidate_ids,
            "selected_ids": selected_ids,
        }
    except Exception as exc:
        now = datetime.now(tz=UTC)
        filtering_run.status = "failed"
        filtering_run.error_message = str(exc)
        filtering_run.finished_at = now
        await filtering_run.save(update_fields=["status", "error_message", "finished_at"])

        if invocation:
            invocation.status = "failed"
            invocation.error_message = str(exc)
            await invocation.save(update_fields=["status", "error_message"])

        logger.exception("Initial screening failed")
        raise
