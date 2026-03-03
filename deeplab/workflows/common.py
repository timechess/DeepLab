from datetime import UTC, datetime
from typing import Any

from deeplab.model import WorkflowExecution, WorkflowStageExecution


async def finish_stage(
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


async def finish_workflow(
    workflow: WorkflowExecution,
    *,
    status: str,
    error_message: str | None = None,
) -> None:
    workflow.status = status
    workflow.error_message = error_message
    workflow.finished_at = datetime.now(tz=UTC)
    await workflow.save(update_fields=["status", "error_message", "finished_at"])
