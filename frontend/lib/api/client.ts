import { z } from 'zod';

import {
  filterResultSchema,
  readResultSchema,
  readingReportSchema,
  runtimeSettingSchema,
  screeningRuleSchema,
  triggerResponseSchema,
  type FilterResult,
  type ReadResult,
  type ReadingReport,
  type RuntimeSetting,
  type ScreeningRule,
  type TriggerResponse,
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

export function getWorkflowRuns(limit = 20): Promise<WorkflowRun[]> {
  return backendFetch<WorkflowRun[]>('/workflow_runs', {
    query: { limit },
    schema: z.array(workflowRunSchema),
  });
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

export function getScreeningRules(): Promise<ScreeningRule[]> {
  return backendFetch<ScreeningRule[]>('/screening_rules', {
    schema: z.array(screeningRuleSchema),
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

export function getReadingReports({
  limit = 20,
  paperId,
}: {
  limit?: number;
  paperId?: string;
} = {}): Promise<ReadingReport[]> {
  return backendFetch<ReadingReport[]>('/reading_reports', {
    query: {
      limit,
      paper_id: paperId,
    },
    schema: z.array(readingReportSchema),
  });
}

export function getReadingReport(reportId: string): Promise<ReadingReport> {
  return backendFetch<ReadingReport>(`/reading_reports/${reportId}`, {
    schema: readingReportSchema,
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
