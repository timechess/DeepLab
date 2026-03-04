CREATE SEQUENCE IF NOT EXISTS screening_rules_id_seq START 1;
CREATE SEQUENCE IF NOT EXISTS todo_tasks_id_seq START 1;

CREATE TABLE IF NOT EXISTS papers (
    id VARCHAR PRIMARY KEY,
    title TEXT NOT NULL,
    authors JSON NOT NULL DEFAULT CAST('[]' AS JSON),
    organization TEXT,
    summary TEXT NOT NULL,
    ai_summary TEXT,
    ai_keywords JSON NOT NULL DEFAULT CAST('[]' AS JSON),
    upvotes INTEGER NOT NULL DEFAULT 0,
    "githubRepo" VARCHAR,
    "githubStars" INTEGER,
    "publishedAt" TIMESTAMPTZ NOT NULL,
    "collectedAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_papers_collected_at ON papers ("collectedAt");

CREATE TABLE IF NOT EXISTS screening_rules (
    id INTEGER PRIMARY KEY DEFAULT nextval('screening_rules_id_seq'),
    rule TEXT NOT NULL,
    "createdBy" VARCHAR NOT NULL,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_screening_rules_created_at ON screening_rules ("createdAt");

CREATE TABLE IF NOT EXISTS todo_tasks (
    id INTEGER PRIMARY KEY DEFAULT nextval('todo_tasks_id_seq'),
    title VARCHAR NOT NULL,
    description TEXT NOT NULL,
    "isCompleted" BOOLEAN NOT NULL DEFAULT FALSE,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_todo_tasks_is_completed ON todo_tasks ("isCompleted");
CREATE INDEX IF NOT EXISTS idx_todo_tasks_created_at ON todo_tasks ("createdAt");
CREATE INDEX IF NOT EXISTS idx_todo_tasks_completed_at ON todo_tasks ("completedAt");

CREATE TABLE IF NOT EXISTS workflow_executions (
    id UUID PRIMARY KEY,
    "workflowName" VARCHAR NOT NULL,
    "triggerType" VARCHAR NOT NULL,
    status VARCHAR NOT NULL DEFAULT 'running',
    context JSON NOT NULL DEFAULT CAST('{}' AS JSON),
    "errorMessage" TEXT,
    "startedAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_workflow_executions_workflow_name ON workflow_executions ("workflowName");
CREATE INDEX IF NOT EXISTS idx_workflow_executions_trigger_type ON workflow_executions ("triggerType");
CREATE INDEX IF NOT EXISTS idx_workflow_executions_status ON workflow_executions (status);
CREATE INDEX IF NOT EXISTS idx_workflow_executions_started_at ON workflow_executions ("startedAt");

CREATE TABLE IF NOT EXISTS workflow_stage_executions (
    id UUID PRIMARY KEY,
    "workflowId" UUID NOT NULL,
    stage VARCHAR NOT NULL,
    status VARCHAR NOT NULL DEFAULT 'running',
    "inputPayload" JSON NOT NULL DEFAULT CAST('{}' AS JSON),
    "outputPayload" JSON,
    "errorMessage" TEXT,
    "startedAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMPTZ,
    FOREIGN KEY ("workflowId") REFERENCES workflow_executions (id)
);
CREATE INDEX IF NOT EXISTS idx_workflow_stage_executions_workflow_id ON workflow_stage_executions ("workflowId");
CREATE INDEX IF NOT EXISTS idx_workflow_stage_executions_stage ON workflow_stage_executions (stage);
CREATE INDEX IF NOT EXISTS idx_workflow_stage_executions_status ON workflow_stage_executions (status);
CREATE INDEX IF NOT EXISTS idx_workflow_stage_executions_started_at ON workflow_stage_executions ("startedAt");

CREATE TABLE IF NOT EXISTS llm_invocation_logs (
    id UUID PRIMARY KEY,
    provider VARCHAR NOT NULL DEFAULT 'google-genai',
    model VARCHAR NOT NULL,
    stage VARCHAR NOT NULL,
    task VARCHAR NOT NULL,
    "workflowId" UUID,
    "stageExecutionId" UUID,
    "inputPayload" JSON NOT NULL,
    "outputPayload" JSON,
    "outputText" TEXT,
    metadata JSON NOT NULL DEFAULT CAST('{}' AS JSON),
    status VARCHAR NOT NULL DEFAULT 'running',
    "latencyMs" INTEGER,
    "errorMessage" TEXT,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY ("workflowId") REFERENCES workflow_executions (id),
    FOREIGN KEY ("stageExecutionId") REFERENCES workflow_stage_executions (id)
);
CREATE INDEX IF NOT EXISTS idx_llm_invocation_logs_provider ON llm_invocation_logs (provider);
CREATE INDEX IF NOT EXISTS idx_llm_invocation_logs_model ON llm_invocation_logs (model);
CREATE INDEX IF NOT EXISTS idx_llm_invocation_logs_stage ON llm_invocation_logs (stage);
CREATE INDEX IF NOT EXISTS idx_llm_invocation_logs_status ON llm_invocation_logs (status);
CREATE INDEX IF NOT EXISTS idx_llm_invocation_logs_created_at ON llm_invocation_logs ("createdAt");

CREATE TABLE IF NOT EXISTS paper_filtering_runs (
    id UUID PRIMARY KEY,
    "triggerType" VARCHAR NOT NULL,
    status VARCHAR NOT NULL DEFAULT 'running',
    "workflowId" UUID,
    "stageExecutionId" UUID,
    "llmInvocationId" UUID,
    "candidatePaperIds" JSON NOT NULL DEFAULT CAST('[]' AS JSON),
    "selectedPaperIds" JSON NOT NULL DEFAULT CAST('[]' AS JSON),
    "rawResult" JSON,
    summary TEXT,
    "errorMessage" TEXT,
    "startedAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMPTZ,
    FOREIGN KEY ("workflowId") REFERENCES workflow_executions (id),
    FOREIGN KEY ("stageExecutionId") REFERENCES workflow_stage_executions (id),
    FOREIGN KEY ("llmInvocationId") REFERENCES llm_invocation_logs (id)
);
CREATE INDEX IF NOT EXISTS idx_paper_filtering_runs_trigger_type ON paper_filtering_runs ("triggerType");
CREATE INDEX IF NOT EXISTS idx_paper_filtering_runs_status ON paper_filtering_runs (status);
CREATE INDEX IF NOT EXISTS idx_paper_filtering_runs_started_at ON paper_filtering_runs ("startedAt");

CREATE TABLE IF NOT EXISTS paper_filtering_decisions (
    id UUID PRIMARY KEY,
    filtering_run_id UUID NOT NULL,
    paper_id VARCHAR NOT NULL,
    selected BOOLEAN NOT NULL DEFAULT FALSE,
    reason TEXT,
    score DOUBLE,
    rank INTEGER,
    extra JSON NOT NULL DEFAULT CAST('{}' AS JSON),
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (filtering_run_id, paper_id),
    FOREIGN KEY (filtering_run_id) REFERENCES paper_filtering_runs (id),
    FOREIGN KEY (paper_id) REFERENCES papers (id)
);
CREATE INDEX IF NOT EXISTS idx_paper_filtering_decisions_selected ON paper_filtering_decisions (selected);
CREATE INDEX IF NOT EXISTS idx_paper_filtering_decisions_created_at ON paper_filtering_decisions ("createdAt");

CREATE TABLE IF NOT EXISTS paper_reading_runs (
    id UUID PRIMARY KEY,
    "triggerType" VARCHAR NOT NULL,
    status VARCHAR NOT NULL DEFAULT 'running',
    workflow_id UUID,
    stage_execution_id UUID,
    "sourceFilteringRunId" UUID,
    "paperIds" JSON NOT NULL DEFAULT CAST('[]' AS JSON),
    "succeededPaperIds" JSON NOT NULL DEFAULT CAST('[]' AS JSON),
    "failedPaperIds" JSON NOT NULL DEFAULT CAST('[]' AS JSON),
    "errorMessage" TEXT,
    "startedAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMPTZ,
    FOREIGN KEY (workflow_id) REFERENCES workflow_executions (id),
    FOREIGN KEY (stage_execution_id) REFERENCES workflow_stage_executions (id),
    FOREIGN KEY ("sourceFilteringRunId") REFERENCES paper_filtering_runs (id)
);
CREATE INDEX IF NOT EXISTS idx_paper_reading_runs_trigger_type ON paper_reading_runs ("triggerType");
CREATE INDEX IF NOT EXISTS idx_paper_reading_runs_status ON paper_reading_runs (status);
CREATE INDEX IF NOT EXISTS idx_paper_reading_runs_started_at ON paper_reading_runs ("startedAt");

CREATE TABLE IF NOT EXISTS paper_reading_reports (
    id UUID PRIMARY KEY,
    reading_run_id UUID NOT NULL,
    paper_id VARCHAR NOT NULL,
    "llmInvocationStage1Id" UUID,
    "llmInvocationStage2Id" UUID,
    status VARCHAR NOT NULL DEFAULT 'succeeded',
    "stage1Overview" TEXT NOT NULL DEFAULT '',
    "stage1Outline" JSON NOT NULL DEFAULT CAST('[]' AS JSON),
    "stage1Questions" JSON NOT NULL DEFAULT CAST('[]' AS JSON),
    overview TEXT NOT NULL DEFAULT '',
    "methodDetails" TEXT NOT NULL DEFAULT '',
    "experimentAnalysis" TEXT NOT NULL DEFAULT '',
    "qaAnswers" TEXT NOT NULL DEFAULT '',
    review TEXT NOT NULL DEFAULT '',
    "relatedReadings" JSON NOT NULL DEFAULT CAST('[]' AS JSON),
    "fullReport" TEXT NOT NULL DEFAULT '',
    comment TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (reading_run_id, paper_id),
    FOREIGN KEY (reading_run_id) REFERENCES paper_reading_runs (id),
    FOREIGN KEY (paper_id) REFERENCES papers (id),
    FOREIGN KEY ("llmInvocationStage1Id") REFERENCES llm_invocation_logs (id),
    FOREIGN KEY ("llmInvocationStage2Id") REFERENCES llm_invocation_logs (id)
);
CREATE INDEX IF NOT EXISTS idx_paper_reading_reports_status ON paper_reading_reports (status);
CREATE INDEX IF NOT EXISTS idx_paper_reading_reports_created_at ON paper_reading_reports ("createdAt");
CREATE INDEX IF NOT EXISTS idx_paper_reading_reports_updated_at ON paper_reading_reports ("updatedAt");

CREATE TABLE IF NOT EXISTS knowledge_questions (
    id UUID PRIMARY KEY,
    question TEXT NOT NULL,
    fingerprint VARCHAR NOT NULL UNIQUE,
    embedding JSON NOT NULL DEFAULT CAST('[]' AS JSON),
    "embeddingModel" VARCHAR NOT NULL,
    "createdBy" VARCHAR NOT NULL,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_knowledge_questions_fingerprint ON knowledge_questions (fingerprint);
CREATE INDEX IF NOT EXISTS idx_knowledge_questions_created_at ON knowledge_questions ("createdAt");
CREATE INDEX IF NOT EXISTS idx_knowledge_questions_updated_at ON knowledge_questions ("updatedAt");

CREATE TABLE IF NOT EXISTS knowledge_solutions (
    id UUID PRIMARY KEY,
    question_id UUID NOT NULL,
    paper_id VARCHAR NOT NULL,
    report_id UUID NOT NULL,
    "methodSummary" TEXT NOT NULL,
    "effectSummary" TEXT NOT NULL,
    limitations TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (question_id, report_id),
    FOREIGN KEY (question_id) REFERENCES knowledge_questions (id),
    FOREIGN KEY (paper_id) REFERENCES papers (id),
    FOREIGN KEY (report_id) REFERENCES paper_reading_reports (id)
);
CREATE INDEX IF NOT EXISTS idx_knowledge_solutions_created_at ON knowledge_solutions ("createdAt");
CREATE INDEX IF NOT EXISTS idx_knowledge_solutions_updated_at ON knowledge_solutions ("updatedAt");

CREATE TABLE IF NOT EXISTS knowledge_extraction_runs (
    id UUID PRIMARY KEY,
    report_id UUID NOT NULL UNIQUE,
    status VARCHAR NOT NULL DEFAULT 'running',
    "attemptCount" INTEGER NOT NULL DEFAULT 1,
    "questionIds" JSON NOT NULL DEFAULT CAST('[]' AS JSON),
    "rawCandidatesXml" TEXT,
    "rawFinalXml" TEXT,
    "errorMessage" TEXT,
    llm_invocation_stage1_id UUID,
    llm_invocation_stage2_id UUID,
    "startedAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMPTZ,
    "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (report_id) REFERENCES paper_reading_reports (id),
    FOREIGN KEY (llm_invocation_stage1_id) REFERENCES llm_invocation_logs (id),
    FOREIGN KEY (llm_invocation_stage2_id) REFERENCES llm_invocation_logs (id)
);
CREATE INDEX IF NOT EXISTS idx_knowledge_extraction_runs_status ON knowledge_extraction_runs (status);
CREATE INDEX IF NOT EXISTS idx_knowledge_extraction_runs_started_at ON knowledge_extraction_runs ("startedAt");
CREATE INDEX IF NOT EXISTS idx_knowledge_extraction_runs_updated_at ON knowledge_extraction_runs ("updatedAt");

CREATE TABLE IF NOT EXISTS knowledge_notes (
    id UUID PRIMARY KEY,
    title TEXT NOT NULL,
    content_json JSON NOT NULL DEFAULT CAST('{}' AS JSON),
    plain_text TEXT NOT NULL DEFAULT '',
    created_by VARCHAR NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_knowledge_notes_created_at ON knowledge_notes (created_at);
CREATE INDEX IF NOT EXISTS idx_knowledge_notes_updated_at ON knowledge_notes (updated_at);

CREATE TABLE IF NOT EXISTS knowledge_note_links (
    id UUID PRIMARY KEY,
    source_note_id UUID NOT NULL,
    target_type VARCHAR NOT NULL,
    target_id VARCHAR NOT NULL,
    target_label TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (source_note_id, target_type, target_id),
    FOREIGN KEY (source_note_id) REFERENCES knowledge_notes (id)
);
CREATE INDEX IF NOT EXISTS idx_knowledge_note_links_created_at ON knowledge_note_links (created_at);
CREATE INDEX IF NOT EXISTS idx_knowledge_note_links_target_type_target_id ON knowledge_note_links (target_type, target_id);

CREATE TABLE IF NOT EXISTS runtime_settings (
    key VARCHAR PRIMARY KEY,
    value TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_runtime_settings_created_at ON runtime_settings ("createdAt");
CREATE INDEX IF NOT EXISTS idx_runtime_settings_updated_at ON runtime_settings ("updatedAt");

CREATE TABLE IF NOT EXISTS daily_work_reports (
    id UUID PRIMARY KEY,
    "workflowId" UUID,
    "businessDate" VARCHAR NOT NULL UNIQUE,
    "sourceDate" VARCHAR NOT NULL,
    status VARCHAR NOT NULL DEFAULT 'succeeded',
    "sourceMarkdown" TEXT NOT NULL DEFAULT '',
    "activitySummary" JSON NOT NULL DEFAULT CAST('{}' AS JSON),
    "reportMarkdown" TEXT NOT NULL DEFAULT '',
    "errorMessage" TEXT,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY ("workflowId") REFERENCES workflow_executions (id)
);
CREATE INDEX IF NOT EXISTS idx_daily_work_reports_status ON daily_work_reports (status);
CREATE INDEX IF NOT EXISTS idx_daily_work_reports_created_at ON daily_work_reports ("createdAt");
CREATE INDEX IF NOT EXISTS idx_daily_work_reports_updated_at ON daily_work_reports ("updatedAt");

CREATE TABLE IF NOT EXISTS daily_work_note_snapshots (
    id UUID PRIMARY KEY,
    "noteId" UUID NOT NULL UNIQUE,
    "snapshotMarkdown" TEXT NOT NULL DEFAULT '',
    "noteUpdatedAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "snapshotUpdatedAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY ("noteId") REFERENCES knowledge_notes (id)
);
CREATE INDEX IF NOT EXISTS idx_daily_work_note_snapshots_note_updated_at ON daily_work_note_snapshots ("noteUpdatedAt");
CREATE INDEX IF NOT EXISTS idx_daily_work_note_snapshots_snapshot_updated_at ON daily_work_note_snapshots ("snapshotUpdatedAt");
CREATE INDEX IF NOT EXISTS idx_daily_work_note_snapshots_created_at ON daily_work_note_snapshots ("createdAt");
