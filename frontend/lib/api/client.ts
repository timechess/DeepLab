import { z } from 'zod';

import {
  createKnowledgeQuestionResultSchema,
  dailyWorkActivityPreviewSchema,
  dailyWorkReportSchema,
  deleteKnowledgeNoteResultSchema,
  deleteKnowledgeQuestionResultSchema,
  filterResultSchema,
  knowledgeLinkTargetSchema,
  knowledgeNoteDetailSchema,
  knowledgeNoteSummarySchema,
  knowledgeQuestionDetailSchema,
  knowledgeQuestionSummarySchema,
  readByArxivIdResultSchema,
  readResultSchema,
  readingReportSchema,
  runtimeSettingSchema,
  screeningRuleSchema,
  todoTaskSchema,
  triggerKnowledgeExtractionResultSchema,
  triggerResponseSchema,
  updateKnowledgeQuestionResultSchema,
  type CreateKnowledgeQuestionResult,
  type DeleteKnowledgeQuestionResult,
  type DailyWorkReport,
  type DailyWorkActivityPreview,
  type ReadByArxivIdResult,
  type FilterResult,
  type KnowledgeLinkTarget,
  type KnowledgeNoteDetail,
  type KnowledgeNoteSummary,
  type KnowledgeQuestionDetail,
  type KnowledgeQuestionSummary,
  type ReadResult,
  type ReadingReport,
  type RuntimeSetting,
  type ScreeningRule,
  type TodoTask,
  type TriggerKnowledgeExtractionResult,
  type TriggerResponse,
  type UpdateKnowledgeQuestionResult,
  type DeleteKnowledgeNoteResult,
  type WorkflowRun,
  type WorkflowRunDetail,
  workflowRunDetailSchema,
  workflowRunSchema,
} from '@/lib/api/schemas';

type NextFetchOptions = {
  next?: {
    revalidate?: number;
    tags?: string[];
  };
};

type BackendFetchOptions = {
  body?: unknown;
  cache?: RequestCache;
  headers?: HeadersInit;
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  query?: Record<string, string | number | boolean | undefined | null>;
  schema?: z.ZodTypeAny;
  timeoutMs?: number;
} & NextFetchOptions;

const DEFAULT_TIMEOUT_MS = 15000;
const BACKEND_BASE_URL =
  process.env.BACKEND_BASE_URL?.trim() || 'http://127.0.0.1:8000';

function buildBackendUrl(
  path: string,
  query?: Record<string, string | number | boolean | undefined | null>,
): URL {
  const normalized = path.startsWith('/') ? path : `/${path}`;
  const url = new URL(normalized, BACKEND_BASE_URL);

  if (query) {
    for (const [key, value] of Object.entries(query)) {
      if (value === undefined || value === null || value === '') {
        continue;
      }
      url.searchParams.set(key, String(value));
    }
  }

  return url;
}

function parseBackendError(payload: unknown): string | undefined {
  if (!payload || typeof payload !== 'object') {
    return undefined;
  }

  const detail = (payload as { detail?: unknown }).detail;
  if (typeof detail === 'string') {
    return detail;
  }

  return undefined;
}

async function backendFetch<T>(
  path: string,
  {
    body,
    cache = 'no-store',
    headers,
    method = 'GET',
    next,
    query,
    schema,
    timeoutMs = DEFAULT_TIMEOUT_MS,
  }: BackendFetchOptions = {},
): Promise<T> {
  const url = buildBackendUrl(path, query);
  const response = await fetch(url, {
    method,
    cache,
    next,
    headers: {
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...headers,
    },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(timeoutMs),
  });

  const isJson =
    response.headers.get('content-type')?.includes('application/json') ?? false;

  if (!response.ok) {
    const errorPayload = isJson ? await response.json().catch(() => null) : null;
    const detail = parseBackendError(errorPayload);
    throw new Error(
      detail
        ? `${response.status} ${response.statusText}: ${detail}`
        : `${response.status} ${response.statusText}`,
    );
  }

  if (response.status === 204) {
    return undefined as T;
  }

  const payload = isJson ? await response.json() : null;
  if (!schema) {
    return payload as T;
  }
  return schema.parse(payload) as T;
}

export function getWorkflowRuns(
  options:
    | number
    | {
        limit?: number;
        offset?: number;
        status?: string;
      } = 20,
): Promise<WorkflowRun[]> {
  const normalized =
    typeof options === 'number'
      ? { limit: options }
      : {
          limit: options.limit ?? 20,
          offset: options.offset,
          status: options.status,
        };
  return backendFetch<WorkflowRun[]>('/workflow_runs', {
    query: normalized,
    schema: z.array(workflowRunSchema),
  });
}

export function getWorkflowRunsCount({
  status,
}: {
  status?: string;
} = {}): Promise<number> {
  return backendFetch<{ total: number }>('/workflow_runs/count', {
    query: { status },
    schema: z.object({ total: z.number().int().nonnegative() }),
  }).then((payload) => payload.total);
}

export function getWorkflowRun(id: string): Promise<WorkflowRunDetail> {
  return backendFetch<WorkflowRunDetail>(`/workflow_runs/${id}`, {
    schema: workflowRunDetailSchema,
  });
}

export function triggerDailyWorkflow(): Promise<TriggerResponse> {
  return backendFetch<TriggerResponse>('/workflow_runs/daily/trigger', {
    method: 'POST',
    schema: triggerResponseSchema,
  });
}

export function triggerDailyWorkReportWorkflow(): Promise<TriggerResponse> {
  return backendFetch<TriggerResponse>('/workflow_runs/daily_work_reports/trigger', {
    method: 'POST',
    schema: triggerResponseSchema,
  });
}

export function triggerFetchPapers(): Promise<Array<Record<string, string>>> {
  return backendFetch<Array<Record<string, string>>>('/fetch_papers', {
    method: 'POST',
    schema: z.array(z.record(z.string())),
  });
}

export function triggerFilterPapers(): Promise<FilterResult> {
  return backendFetch<FilterResult>('/filter_papers', {
    method: 'POST',
    schema: filterResultSchema,
    body: {},
    timeoutMs: 120000,
  });
}

export function triggerReadPapers(): Promise<ReadResult> {
  return backendFetch<ReadResult>('/read_papers', {
    method: 'POST',
    schema: readResultSchema,
    body: {},
    timeoutMs: 120000,
  });
}

export function triggerReadPaperByArxivId(
  paperId: string,
  paperMetadata?: {
    title: string;
    authors: string[];
    summary: string;
    organization?: string;
    publishedAt?: string;
    aiKeywords?: string[];
  },
): Promise<ReadByArxivIdResult> {
  return backendFetch<ReadByArxivIdResult>('/read_papers/by_arxiv_id', {
    method: 'POST',
    schema: readByArxivIdResultSchema,
    body: paperMetadata ? { paperId, paperMetadata } : { paperId },
    timeoutMs: 120000,
  });
}

export function getScreeningRules(): Promise<ScreeningRule[]> {
  return backendFetch<ScreeningRule[]>('/screening_rules', {
    schema: z.array(screeningRuleSchema),
  });
}

export function getTodoTasks(): Promise<TodoTask[]> {
  return backendFetch<TodoTask[]>('/todo_tasks', {
    schema: z.array(todoTaskSchema),
  });
}

export function getRuntimeSettings(): Promise<RuntimeSetting[]> {
  return backendFetch<RuntimeSetting[]>('/runtime_settings', {
    schema: z.array(runtimeSettingSchema),
  });
}

export function updateRuntimeSetting(
  key: string,
  payload: { value: string },
): Promise<RuntimeSetting> {
  return backendFetch<RuntimeSetting>(`/runtime_settings/${encodeURIComponent(key)}`, {
    method: 'PUT',
    schema: runtimeSettingSchema,
    body: payload,
  });
}

export function deleteRuntimeSetting(key: string): Promise<{ deleted: boolean }> {
  return backendFetch<{ deleted: boolean }>(`/runtime_settings/${encodeURIComponent(key)}`, {
    method: 'DELETE',
    schema: z.object({ deleted: z.boolean() }),
  });
}

export function createScreeningRule(payload: {
  rule: string;
  createdBy: string;
}): Promise<ScreeningRule> {
  return backendFetch<ScreeningRule>('/screening_rules', {
    method: 'POST',
    schema: screeningRuleSchema,
    body: payload,
  });
}

export function updateScreeningRule(
  ruleId: number,
  payload: {
    rule?: string;
    createdBy?: string;
  },
): Promise<ScreeningRule> {
  return backendFetch<ScreeningRule>(`/screening_rules/${ruleId}`, {
    method: 'PUT',
    schema: screeningRuleSchema,
    body: payload,
  });
}

export function deleteScreeningRule(ruleId: number): Promise<{ deleted: boolean }> {
  return backendFetch<{ deleted: boolean }>(`/screening_rules/${ruleId}`, {
    method: 'DELETE',
    schema: z.object({ deleted: z.boolean() }),
  });
}

export function createTodoTask(payload: {
  title: string;
  description: string;
}): Promise<TodoTask> {
  return backendFetch<TodoTask>('/todo_tasks', {
    method: 'POST',
    schema: todoTaskSchema,
    body: payload,
  });
}

export function updateTodoTaskCompletion(
  taskId: number,
  payload: { completed: boolean },
): Promise<TodoTask> {
  return backendFetch<TodoTask>(`/todo_tasks/${taskId}/completion`, {
    method: 'PUT',
    schema: todoTaskSchema,
    body: payload,
  });
}

export function deleteTodoTask(taskId: number): Promise<{ deleted: boolean }> {
  return backendFetch<{ deleted: boolean }>(`/todo_tasks/${taskId}`, {
    method: 'DELETE',
    schema: z.object({ deleted: z.boolean() }),
  });
}

export function getReadingReports({
  limit = 20,
  offset,
  paperId,
  paperTitle,
  commentStatus,
  todayOnly,
}: {
  limit?: number;
  offset?: number;
  paperId?: string;
  paperTitle?: string;
  commentStatus?: 'commented' | 'uncommented';
  todayOnly?: boolean;
} = {}): Promise<ReadingReport[]> {
  return backendFetch<ReadingReport[]>('/reading_reports', {
    query: {
      limit,
      offset,
      paper_id: paperId,
      paper_title: paperTitle,
      comment_status: commentStatus,
      today_only: todayOnly,
    },
    schema: z.array(readingReportSchema),
  });
}

export function getReadingReportsCount({
  paperId,
  paperTitle,
  commentStatus,
  todayOnly,
}: {
  paperId?: string;
  paperTitle?: string;
  commentStatus?: 'commented' | 'uncommented';
  todayOnly?: boolean;
} = {}): Promise<number> {
  return backendFetch<{ total: number }>('/reading_reports/count', {
    query: {
      paper_id: paperId,
      paper_title: paperTitle,
      comment_status: commentStatus,
      today_only: todayOnly,
    },
    schema: z.object({ total: z.number().int().nonnegative() }),
  }).then((payload) => payload.total);
}

export function getReadingReport(reportId: string): Promise<ReadingReport> {
  return backendFetch<ReadingReport>(`/reading_reports/${reportId}`, {
    schema: readingReportSchema,
  });
}

export function getDailyWorkReports({
  limit = 20,
  offset,
  businessDate,
  todayOnly,
}: {
  limit?: number;
  offset?: number;
  businessDate?: string;
  todayOnly?: boolean;
} = {}): Promise<DailyWorkReport[]> {
  return backendFetch<DailyWorkReport[]>('/daily_work_reports', {
    query: {
      limit,
      offset,
      business_date: businessDate,
      today_only: todayOnly,
    },
    schema: z.array(dailyWorkReportSchema),
  });
}

export function getDailyWorkReportsCount({
  businessDate,
  todayOnly,
}: {
  businessDate?: string;
  todayOnly?: boolean;
} = {}): Promise<number> {
  return backendFetch<{ total: number }>('/daily_work_reports/count', {
    query: {
      business_date: businessDate,
      today_only: todayOnly,
    },
    schema: z.object({ total: z.number().int().nonnegative() }),
  }).then((payload) => payload.total);
}

export function getDailyWorkReport(reportId: string): Promise<DailyWorkReport> {
  return backendFetch<DailyWorkReport>(`/daily_work_reports/${reportId}`, {
    schema: dailyWorkReportSchema,
  });
}

export function getDailyWorkActivityPreview(): Promise<DailyWorkActivityPreview> {
  return backendFetch<DailyWorkActivityPreview>('/daily_work_reports/activity_preview', {
    schema: dailyWorkActivityPreviewSchema,
  });
}

export function updateReadingReportComment(
  reportId: string,
  comment: string,
): Promise<ReadingReport> {
  return backendFetch<ReadingReport>(`/reading_reports/${reportId}/comment`, {
    method: 'PATCH',
    schema: readingReportSchema,
    body: { comment },
  });
}

export function triggerKnowledgeExtraction(
  reportId: string,
): Promise<TriggerKnowledgeExtractionResult> {
  return backendFetch<TriggerKnowledgeExtractionResult>(`/knowledge/reports/${reportId}/extract`, {
    method: 'POST',
    schema: triggerKnowledgeExtractionResultSchema,
    timeoutMs: 120000,
  });
}

export function getKnowledgeQuestions({
  search,
  limit = 20,
}: {
  search?: string;
  limit?: number;
} = {}): Promise<KnowledgeQuestionSummary[]> {
  return backendFetch<KnowledgeQuestionSummary[]>('/knowledge/questions', {
    query: { search, limit },
    schema: z.array(knowledgeQuestionSummarySchema),
  });
}

export function getKnowledgeQuestion(
  questionId: string,
): Promise<KnowledgeQuestionDetail> {
  return backendFetch<KnowledgeQuestionDetail>(`/knowledge/questions/${questionId}`, {
    schema: knowledgeQuestionDetailSchema,
  });
}

export function createKnowledgeQuestion(payload: {
  question: string;
  createdBy?: string;
}): Promise<CreateKnowledgeQuestionResult> {
  return backendFetch<CreateKnowledgeQuestionResult>('/knowledge/questions', {
    method: 'POST',
    schema: createKnowledgeQuestionResultSchema,
    body: payload,
  });
}

export function updateKnowledgeQuestion(
  questionId: string,
  payload: { question: string },
): Promise<UpdateKnowledgeQuestionResult> {
  return backendFetch<UpdateKnowledgeQuestionResult>(`/knowledge/questions/${questionId}`, {
    method: 'PATCH',
    schema: updateKnowledgeQuestionResultSchema,
    body: payload,
  });
}

export function deleteKnowledgeQuestion(
  questionId: string,
): Promise<DeleteKnowledgeQuestionResult> {
  return backendFetch<DeleteKnowledgeQuestionResult>(`/knowledge/questions/${questionId}`, {
    method: 'DELETE',
    schema: deleteKnowledgeQuestionResultSchema,
  });
}

export function getKnowledgeNotes({
  search,
  limit = 20,
}: {
  search?: string;
  limit?: number;
} = {}): Promise<KnowledgeNoteSummary[]> {
  return backendFetch<KnowledgeNoteSummary[]>('/knowledge/notes', {
    query: { search, limit },
    schema: z.array(knowledgeNoteSummarySchema),
  });
}

export function getKnowledgeNote(noteId: string): Promise<KnowledgeNoteDetail> {
  return backendFetch<KnowledgeNoteDetail>(`/knowledge/notes/${noteId}`, {
    schema: knowledgeNoteDetailSchema,
  });
}

export function createKnowledgeNote(payload: {
  title?: string;
  contentJson?: Record<string, unknown>;
  createdBy?: string;
}): Promise<KnowledgeNoteDetail> {
  return backendFetch<KnowledgeNoteDetail>('/knowledge/notes', {
    method: 'POST',
    schema: knowledgeNoteDetailSchema,
    body: payload,
  });
}

export function updateKnowledgeNote(
  noteId: string,
  payload: {
    title?: string;
    contentJson?: Record<string, unknown>;
  },
): Promise<KnowledgeNoteDetail> {
  return backendFetch<KnowledgeNoteDetail>(`/knowledge/notes/${noteId}`, {
    method: 'PATCH',
    schema: knowledgeNoteDetailSchema,
    body: payload,
  });
}

export function deleteKnowledgeNote(
  noteId: string,
): Promise<DeleteKnowledgeNoteResult> {
  return backendFetch<DeleteKnowledgeNoteResult>(`/knowledge/notes/${noteId}`, {
    method: 'DELETE',
    schema: deleteKnowledgeNoteResultSchema,
  });
}

export function searchKnowledgeLinkTargets({
  type,
  q,
  limit = 10,
  excludeNoteId,
}: {
  type: 'paper' | 'question' | 'note' | 'task';
  q?: string;
  limit?: number;
  excludeNoteId?: string;
}): Promise<KnowledgeLinkTarget[]> {
  return backendFetch<KnowledgeLinkTarget[]>('/knowledge/link-targets', {
    query: {
      type,
      q,
      limit,
      exclude_note_id: excludeNoteId,
    },
    schema: z.array(knowledgeLinkTargetSchema),
  });
}
