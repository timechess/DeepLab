from __future__ import annotations

import argparse
import asyncio
from datetime import UTC, datetime, timedelta
from typing import Any

from deeplab.db.engine import execute, init_duckdb, open_session
from deeplab.db.migrate import apply_migrations, default_migrations_dir
from deeplab.model import DailyWorkReport, WorkflowExecution, WorkflowStageExecution
from deeplab.workflows.daily_work_reports import (
    NO_ACTIVITY_REPORT_MARKDOWN,
)

def _is_stale(
    workflow: WorkflowExecution,
    *,
    stale_running_minutes: int,
) -> bool:
    if workflow.started_at is None:
        return True
    cutoff = datetime.now(tz=UTC) - timedelta(minutes=stale_running_minutes)
    return workflow.started_at <= cutoff


def _delete_workflow_dependencies(workflow_id: Any) -> dict[str, int]:
    deleted: dict[str, int] = {}
    deleted["daily_work_reports"] = execute(
        'DELETE FROM daily_work_reports WHERE "workflowId" = ?;',
        [workflow_id],
    )
    deleted["knowledge_extraction_runs"] = execute(
        """
        DELETE FROM knowledge_extraction_runs
        WHERE report_id IN (
            SELECT r.id
            FROM paper_reading_reports r
            JOIN paper_reading_runs rr ON r.reading_run_id = rr.id
            WHERE rr.workflow_id = ?
        );
        """,
        [workflow_id],
    )
    deleted["knowledge_solutions"] = execute(
        """
        DELETE FROM knowledge_solutions
        WHERE report_id IN (
            SELECT r.id
            FROM paper_reading_reports r
            JOIN paper_reading_runs rr ON r.reading_run_id = rr.id
            WHERE rr.workflow_id = ?
        );
        """,
        [workflow_id],
    )
    deleted["paper_reading_reports"] = execute(
        """
        DELETE FROM paper_reading_reports
        WHERE reading_run_id IN (
            SELECT id FROM paper_reading_runs WHERE workflow_id = ?
        );
        """,
        [workflow_id],
    )
    deleted["paper_reading_runs"] = execute(
        "DELETE FROM paper_reading_runs WHERE workflow_id = ?;",
        [workflow_id],
    )
    deleted["paper_filtering_decisions"] = execute(
        """
        DELETE FROM paper_filtering_decisions
        WHERE filtering_run_id IN (
            SELECT id FROM paper_filtering_runs WHERE "workflowId" = ?
        );
        """,
        [workflow_id],
    )
    deleted["paper_filtering_runs"] = execute(
        'DELETE FROM paper_filtering_runs WHERE "workflowId" = ?;',
        [workflow_id],
    )
    deleted["llm_invocation_logs_by_stage"] = execute(
        """
        DELETE FROM llm_invocation_logs
        WHERE "stageExecutionId" IN (
            SELECT id FROM workflow_stage_executions WHERE "workflowId" = ?
        );
        """,
        [workflow_id],
    )
    deleted["llm_invocation_logs_by_workflow"] = execute(
        'DELETE FROM llm_invocation_logs WHERE "workflowId" = ?;',
        [workflow_id],
    )
    deleted["workflow_stage_executions"] = execute(
        'DELETE FROM workflow_stage_executions WHERE "workflowId" = ?;',
        [workflow_id],
    )
    deleted["workflow_executions"] = execute(
        "DELETE FROM workflow_executions WHERE id = ?;",
        [workflow_id],
    )
    return deleted


async def cleanup(*, apply: bool, stale_running_minutes: int) -> dict[str, Any]:
    running_workflows = await WorkflowExecution.filter(status="running").all()

    deleted_workflow_count = 0
    skipped_non_pathological = 0
    inspected = 0
    deleted_rows_by_table: dict[str, int] = {}

    for workflow in running_workflows:
        inspected += 1
        stages = (
            await WorkflowStageExecution.filter(workflow=workflow).order_by("started_at").all()
        )
        has_running_stage = any(stage.status == "running" for stage in stages)
        is_pathological = (not stages) or (not has_running_stage) or (
            has_running_stage and _is_stale(workflow, stale_running_minutes=stale_running_minutes)
        )
        if not is_pathological:
            skipped_non_pathological += 1
            continue

        if apply:
            deleted = _delete_workflow_dependencies(workflow.id)
            for key, value in deleted.items():
                deleted_rows_by_table[key] = deleted_rows_by_table.get(key, 0) + int(value)
        deleted_workflow_count += 1

    stale_no_activity_reports = await DailyWorkReport.filter(
        report_markdown=NO_ACTIVITY_REPORT_MARKDOWN
    ).count()
    if apply and stale_no_activity_reports:
        deleted = await DailyWorkReport.filter(
            report_markdown=NO_ACTIVITY_REPORT_MARKDOWN
        ).delete()
        deleted_rows_by_table["daily_work_reports"] = (
            deleted_rows_by_table.get("daily_work_reports", 0) + int(deleted)
        )

    return {
        "mode": "apply" if apply else "dry-run",
        "stale_running_minutes": stale_running_minutes,
        "running_workflows_inspected": inspected,
        "pathological_workflows_to_delete": deleted_workflow_count,
        "running_workflows_skipped_as_non_pathological": skipped_non_pathological,
        "stale_no_activity_reports": int(stale_no_activity_reports),
        "deleted_rows_by_table": deleted_rows_by_table if apply else {},
    }


async def main() -> None:
    parser = argparse.ArgumentParser(
        description=(
            "Repair pathological workflow rows stuck in running state and "
            "clean no-activity daily reports."
        )
    )
    parser.add_argument(
        "--apply",
        action="store_true",
        help="Apply changes. Without this flag, the script runs in dry-run mode.",
    )
    parser.add_argument(
        "--stale-running-minutes",
        type=int,
        default=30,
        help=(
            "Treat running workflows older than this threshold as pathological, "
            "even if they still have running stages."
        ),
    )
    args = parser.parse_args()

    init_duckdb()
    apply_migrations(migrations_dir=default_migrations_dir(), verbose=False)
    async with open_session():
        summary = await cleanup(
            apply=args.apply,
            stale_running_minutes=max(1, int(args.stale_running_minutes)),
        )

    print(summary)


if __name__ == "__main__":
    asyncio.run(main())
