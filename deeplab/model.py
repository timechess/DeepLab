from tortoise import fields
from tortoise.models import Model


class Paper(Model):
    id = fields.CharField(max_length=32, pk=True, description="ArXiv ID")
    title = fields.TextField(description="Paper title")
    authors = fields.JSONField(default=list, description="Author list")
    organization = fields.TextField(null=True, description="Organization")
    summary = fields.TextField(description="Paper abstract")
    ai_summary = fields.TextField(null=True, description="AI-generated abstract summary")
    ai_keywords = fields.JSONField(default=list, description="AI-generated keywords")
    upvotes = fields.IntField(default=0, description="Upvote count")
    github_repo = fields.CharField(
        max_length=500,
        null=True,
        source_field="githubRepo",
        description="GitHub repository URL",
    )
    github_stars = fields.IntField(
        null=True,
        source_field="githubStars",
        description="GitHub repository stars",
    )
    published_at = fields.DatetimeField(
        source_field="publishedAt",
        description="Publication datetime",
    )
    collected_at = fields.DatetimeField(
        auto_now_add=True,
        source_field="collectedAt",
        index=True,
        description="Record collection datetime",
    )

    class Meta:
        table = "papers"
        ordering = ["-collected_at"]


class ScreeningRule(Model):
    id = fields.IntField(pk=True, description="Rule ID")
    rule = fields.TextField(description="Rule description")
    created_by = fields.CharField(
        max_length=64,
        source_field="createdBy",
        description="Rule creator: user or ai",
    )
    created_at = fields.DatetimeField(
        auto_now_add=True,
        source_field="createdAt",
        index=True,
        description="Rule creation datetime",
    )

    class Meta:
        table = "screening_rules"
        ordering = ["-created_at", "-id"]


class WorkflowExecution(Model):
    id = fields.UUIDField(pk=True, description="Workflow run ID")
    workflow_name = fields.CharField(
        max_length=64,
        source_field="workflowName",
        index=True,
        description="Workflow name",
    )
    trigger_type = fields.CharField(
        max_length=32,
        source_field="triggerType",
        index=True,
        description="Trigger source: manual/scheduled",
    )
    status = fields.CharField(max_length=32, default="running", index=True)
    context = fields.JSONField(default=dict, description="Workflow context")
    error_message = fields.TextField(
        null=True,
        source_field="errorMessage",
        description="Workflow-level error message",
    )
    started_at = fields.DatetimeField(
        auto_now_add=True,
        source_field="startedAt",
        index=True,
        description="Workflow start datetime",
    )
    finished_at = fields.DatetimeField(
        null=True,
        source_field="finishedAt",
        description="Workflow finish datetime",
    )

    class Meta:
        table = "workflow_executions"
        ordering = ["-started_at"]


class WorkflowStageExecution(Model):
    id = fields.UUIDField(pk=True, description="Stage run ID")
    workflow = fields.ForeignKeyField(
        "models.WorkflowExecution",
        related_name="stages",
        source_field="workflowId",
        description="Parent workflow execution",
    )
    stage = fields.CharField(max_length=64, index=True, description="Stage name")
    status = fields.CharField(max_length=32, default="running", index=True)
    input_payload = fields.JSONField(
        default=dict,
        source_field="inputPayload",
        description="Stage input payload",
    )
    output_payload = fields.JSONField(
        null=True,
        source_field="outputPayload",
        description="Stage output payload",
    )
    error_message = fields.TextField(
        null=True,
        source_field="errorMessage",
        description="Stage-level error message",
    )
    started_at = fields.DatetimeField(
        auto_now_add=True,
        source_field="startedAt",
        index=True,
        description="Stage start datetime",
    )
    finished_at = fields.DatetimeField(
        null=True,
        source_field="finishedAt",
        description="Stage finish datetime",
    )

    class Meta:
        table = "workflow_stage_executions"
        ordering = ["-started_at"]


class LLMInvocationLog(Model):
    id = fields.UUIDField(pk=True, description="LLM invocation ID")
    provider = fields.CharField(max_length=32, default="google-genai", index=True)
    model = fields.CharField(max_length=128, index=True)
    stage = fields.CharField(max_length=64, index=True, description="Workflow stage")
    task = fields.CharField(max_length=128, description="Task name")
    workflow = fields.ForeignKeyField(
        "models.WorkflowExecution",
        null=True,
        related_name="llm_invocations",
        source_field="workflowId",
    )
    stage_execution = fields.ForeignKeyField(
        "models.WorkflowStageExecution",
        null=True,
        related_name="llm_invocations",
        source_field="stageExecutionId",
    )
    input_payload = fields.JSONField(
        source_field="inputPayload",
        description="Complete request payload sent to LLM",
    )
    output_payload = fields.JSONField(
        null=True,
        source_field="outputPayload",
        description="Complete LLM raw response payload",
    )
    output_text = fields.TextField(
        null=True,
        source_field="outputText",
        description="LLM output text",
    )
    metadata = fields.JSONField(
        default=dict,
        description="Task metadata (paper IDs, trigger, etc.)",
    )
    status = fields.CharField(max_length=32, default="running", index=True)
    latency_ms = fields.IntField(null=True, source_field="latencyMs")
    error_message = fields.TextField(
        null=True,
        source_field="errorMessage",
        description="Invocation error details",
    )
    created_at = fields.DatetimeField(
        auto_now_add=True,
        source_field="createdAt",
        index=True,
    )

    class Meta:
        table = "llm_invocation_logs"
        ordering = ["-created_at"]


class PaperFilteringRun(Model):
    id = fields.UUIDField(pk=True, description="Paper filtering run ID")
    trigger_type = fields.CharField(
        max_length=32,
        source_field="triggerType",
        index=True,
        description="manual/scheduled/workflow",
    )
    status = fields.CharField(max_length=32, default="running", index=True)
    workflow = fields.ForeignKeyField(
        "models.WorkflowExecution",
        null=True,
        related_name="filtering_runs",
        source_field="workflowId",
    )
    stage_execution = fields.ForeignKeyField(
        "models.WorkflowStageExecution",
        null=True,
        related_name="filtering_runs",
        source_field="stageExecutionId",
    )
    llm_invocation = fields.ForeignKeyField(
        "models.LLMInvocationLog",
        null=True,
        related_name="filtering_runs",
        source_field="llmInvocationId",
    )
    candidate_paper_ids = fields.JSONField(
        default=list,
        source_field="candidatePaperIds",
        description="Papers considered in this run",
    )
    selected_paper_ids = fields.JSONField(
        default=list,
        source_field="selectedPaperIds",
        description="Selected paper IDs",
    )
    raw_result = fields.JSONField(
        null=True,
        source_field="rawResult",
        description="Structured result parsed from LLM output",
    )
    summary = fields.TextField(null=True, description="Screening summary")
    error_message = fields.TextField(
        null=True,
        source_field="errorMessage",
        description="Filtering run error message",
    )
    started_at = fields.DatetimeField(
        auto_now_add=True,
        source_field="startedAt",
        index=True,
    )
    finished_at = fields.DatetimeField(
        null=True,
        source_field="finishedAt",
    )

    class Meta:
        table = "paper_filtering_runs"
        ordering = ["-started_at"]


class PaperFilteringDecision(Model):
    id = fields.UUIDField(pk=True, description="Decision record ID")
    filtering_run = fields.ForeignKeyField(
        "models.PaperFilteringRun",
        related_name="decisions",
        source_field="filtering_run_id",
    )
    paper = fields.ForeignKeyField(
        "models.Paper",
        related_name="filtering_decisions",
        source_field="paper_id",
    )
    selected = fields.BooleanField(default=False, index=True)
    reason = fields.TextField(null=True, description="Selection reason")
    score = fields.FloatField(null=True, description="Selection score")
    rank = fields.IntField(null=True, description="Optional rank for selected papers")
    extra = fields.JSONField(default=dict, description="Additional structured metadata")
    created_at = fields.DatetimeField(
        auto_now_add=True,
        source_field="createdAt",
        index=True,
    )

    class Meta:
        table = "paper_filtering_decisions"
        ordering = ["rank", "-score", "-created_at"]
        unique_together = (("filtering_run", "paper"),)


class PaperReadingRun(Model):
    id = fields.UUIDField(pk=True, description="Paper reading run ID")
    trigger_type = fields.CharField(
        max_length=32,
        source_field="triggerType",
        index=True,
        description="manual/scheduled/workflow",
    )
    status = fields.CharField(max_length=32, default="running", index=True)
    workflow = fields.ForeignKeyField(
        "models.WorkflowExecution",
        null=True,
        related_name="reading_runs",
    )
    stage_execution = fields.ForeignKeyField(
        "models.WorkflowStageExecution",
        null=True,
        related_name="reading_runs",
    )
    source_filtering_run = fields.ForeignKeyField(
        "models.PaperFilteringRun",
        null=True,
        related_name="reading_runs",
        source_field="sourceFilteringRunId",
    )
    paper_ids = fields.JSONField(
        default=list,
        source_field="paperIds",
        description="Target paper IDs for reading",
    )
    succeeded_paper_ids = fields.JSONField(
        default=list,
        source_field="succeededPaperIds",
        description="Successfully generated report paper IDs",
    )
    failed_paper_ids = fields.JSONField(
        default=list,
        source_field="failedPaperIds",
        description="Failed paper IDs",
    )
    error_message = fields.TextField(
        null=True,
        source_field="errorMessage",
        description="Reading run error message",
    )
    started_at = fields.DatetimeField(
        auto_now_add=True,
        source_field="startedAt",
        index=True,
    )
    finished_at = fields.DatetimeField(
        null=True,
        source_field="finishedAt",
    )

    class Meta:
        table = "paper_reading_runs"
        ordering = ["-started_at"]


class PaperReadingReport(Model):
    id = fields.UUIDField(pk=True, description="Reading report ID")
    reading_run = fields.ForeignKeyField(
        "models.PaperReadingRun",
        related_name="reports",
        source_field="reading_run_id",
    )
    paper = fields.ForeignKeyField(
        "models.Paper",
        related_name="reading_reports",
        source_field="paper_id",
    )
    llm_invocation_stage1 = fields.ForeignKeyField(
        "models.LLMInvocationLog",
        null=True,
        related_name="reading_reports_stage1",
        source_field="llmInvocationStage1Id",
    )
    llm_invocation_stage2 = fields.ForeignKeyField(
        "models.LLMInvocationLog",
        null=True,
        related_name="reading_reports_stage2",
        source_field="llmInvocationStage2Id",
    )
    status = fields.CharField(max_length=32, default="succeeded", index=True)
    stage1_overview = fields.TextField(
        default="",
        source_field="stage1Overview",
        description="Stage-1 primary output content",
    )
    stage1_outline = fields.JSONField(
        default=list,
        source_field="stage1Outline",
        description="Stage-1 paper outline",
    )
    stage1_questions = fields.JSONField(
        default=list,
        source_field="stage1Questions",
        description="Stage-1 research questions",
    )
    overview = fields.TextField(default="", description="Deprecated structured section")
    method_details = fields.TextField(
        default="",
        source_field="methodDetails",
        description="Deprecated structured section",
    )
    experiment_analysis = fields.TextField(
        default="",
        source_field="experimentAnalysis",
        description="Deprecated structured section",
    )
    qa_answers = fields.TextField(
        default="",
        source_field="qaAnswers",
        description="Deprecated structured section",
    )
    review = fields.TextField(default="", description="Deprecated structured section")
    related_readings = fields.JSONField(
        default=list,
        source_field="relatedReadings",
        description="Section 6 related reading list",
    )
    full_report = fields.TextField(
        default="",
        source_field="fullReport",
        description="Stage-2 primary output content",
    )
    comment = fields.TextField(default="", description="User comment/note")
    created_at = fields.DatetimeField(
        auto_now_add=True,
        source_field="createdAt",
        index=True,
    )
    updated_at = fields.DatetimeField(
        auto_now=True,
        source_field="updatedAt",
        index=True,
    )

    class Meta:
        table = "paper_reading_reports"
        ordering = ["-created_at"]
        unique_together = (("reading_run", "paper"),)


class RuntimeSetting(Model):
    key = fields.CharField(max_length=128, pk=True, description="Runtime setting key")
    value = fields.TextField(default="", description="Runtime setting value")
    created_at = fields.DatetimeField(
        auto_now_add=True,
        source_field="createdAt",
        index=True,
    )
    updated_at = fields.DatetimeField(
        auto_now=True,
        source_field="updatedAt",
        index=True,
    )

    class Meta:
        table = "runtime_settings"
        ordering = ["key"]
