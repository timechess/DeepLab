import { z } from 'zod';

export const workflowStatusSchema = z.enum([
  'running',
  'succeeded',
  'failed',
  'partial_succeeded',
]);

export const workflowRunSchema = z.object({
  id: z.string().uuid(),
  workflowName: z.string(),
  triggerType: z.string(),
  status: workflowStatusSchema,
  context: z.record(z.unknown()).default({}),
  errorMessage: z.string().nullable(),
  startedAt: z.string(),
  finishedAt: z.string().nullable(),
});

export const workflowStageSchema = z.object({
  id: z.string().uuid(),
  workflowId: z.string().uuid(),
  stage: z.string(),
  status: workflowStatusSchema,
  inputPayload: z.unknown(),
  outputPayload: z.unknown().nullable(),
  errorMessage: z.string().nullable(),
  startedAt: z.string(),
  finishedAt: z.string().nullable(),
});

export const workflowRunDetailSchema = z.object({
  workflow: workflowRunSchema,
  stages: z.array(workflowStageSchema),
});

export const screeningRuleSchema = z.object({
  id: z.number().int(),
  rule: z.string(),
  createdBy: z.string(),
  createdAt: z.string(),
});

export const runtimeSettingSchema = z.object({
  key: z.string(),
  label: z.string(),
  description: z.string(),
  isSecret: z.boolean(),
  value: z.string(),
  source: z.enum(['database', 'default', 'unset']),
  createdAt: z.string().nullable(),
  updatedAt: z.string().nullable(),
});

export const paperMetaSchema = z.object({
  id: z.string(),
  title: z.string(),
  authors: z.array(z.string()),
  organization: z.string().nullable(),
  aiKeywords: z.array(z.string()),
  upvotes: z.number().int(),
  githubRepo: z.string().nullable(),
  githubStars: z.number().int().nullable(),
  publishedAt: z.string(),
  summary: z.string().optional(),
  aiSummary: z.string().nullable().optional(),
});

export const readingReportSchema = z.object({
  id: z.string().uuid(),
  readingRunId: z.string().uuid(),
  paperId: z.string(),
  paperTitle: z.string().nullable(),
  status: z.string(),
  stage1Content: z.string(),
  stage2Content: z.string(),
  comment: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
  paperMeta: paperMetaSchema.nullable().optional(),
  fullReport: z.string().optional(),
});

export const triggerResponseSchema = z.object({
  workflow_id: z.string().uuid(),
});

export const filterResultSchema = z.object({
  run_id: z.string().uuid(),
  llm_invocation_id: z.string().uuid().nullable(),
  summary: z.string(),
  candidate_count: z.number().int(),
  selected_count: z.number().int(),
  selected_papers: z.array(
    z.object({
      id: z.string(),
      title: z.string(),
      reason: z.string(),
      score: z.number().nullable(),
      rank: z.number().nullable(),
    }),
  ),
  candidate_ids: z.array(z.string()),
  selected_ids: z.array(z.string()),
  workflow_id: z.string().uuid().optional(),
});

export const readResultSchema = z.object({
  run_id: z.string().uuid(),
  source_filtering_run_id: z.string().uuid().nullable(),
  paper_count: z.number().int(),
  succeeded_count: z.number().int(),
  failed_count: z.number().int(),
  succeeded_paper_ids: z.array(z.string()),
  failed_paper_ids: z.array(z.string()),
  reports: z.array(
    z.object({
      report_id: z.string().uuid(),
      paper_id: z.string(),
      title: z.string(),
    }),
  ),
  workflow_id: z.string().uuid().optional(),
});

export type WorkflowRun = z.infer<typeof workflowRunSchema>;
export type WorkflowStage = z.infer<typeof workflowStageSchema>;
export type WorkflowRunDetail = z.infer<typeof workflowRunDetailSchema>;
export type ScreeningRule = z.infer<typeof screeningRuleSchema>;
export type RuntimeSetting = z.infer<typeof runtimeSettingSchema>;
export type ReadingReport = z.infer<typeof readingReportSchema>;
export type PaperMeta = z.infer<typeof paperMetaSchema>;
export type TriggerResponse = z.infer<typeof triggerResponseSchema>;
export type FilterResult = z.infer<typeof filterResultSchema>;
export type ReadResult = z.infer<typeof readResultSchema>;
