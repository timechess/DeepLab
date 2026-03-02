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
  knowledgeExtraction: z
    .object({
      runId: z.string().uuid().nullable(),
      status: z.enum(['not_started', 'running', 'succeeded', 'failed']),
      locked: z.boolean(),
      attemptCount: z.number().int(),
      errorMessage: z.string().nullable(),
      startedAt: z.string().nullable(),
      finishedAt: z.string().nullable(),
      questionIds: z.array(z.string()),
    })
    .optional(),
  knowledgeQuestions: z
    .array(
      z.object({
        id: z.string().uuid(),
        question: z.string(),
        createdBy: z.string(),
        createdAt: z.string(),
        updatedAt: z.string(),
        solutionCount: z.number().int(),
      }),
    )
    .optional(),
});

export const knowledgeQuestionSummarySchema = z.object({
  id: z.string().uuid(),
  question: z.string(),
  createdBy: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
  solutionCount: z.number().int(),
});

export const knowledgeSolutionSchema = z.object({
  id: z.string().uuid(),
  questionId: z.string().uuid(),
  paperId: z.string(),
  paperTitle: z.string().nullable(),
  reportId: z.string().uuid().nullable(),
  methodSummary: z.string(),
  effectSummary: z.string(),
  limitations: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export const knowledgeQuestionDetailSchema = knowledgeQuestionSummarySchema.extend({
  solutions: z.array(knowledgeSolutionSchema),
});

export const triggerKnowledgeExtractionResultSchema = z.object({
  runId: z.string().uuid(),
  status: z.enum(['running', 'succeeded', 'failed']),
  locked: z.boolean(),
  attemptCount: z.number().int(),
  questionIds: z.array(z.string()),
  errorMessage: z.string().nullable(),
  startedAt: z.string().nullable(),
  finishedAt: z.string().nullable(),
  deduplicated: z.boolean(),
  message: z.string(),
});

export const createKnowledgeQuestionResultSchema = z.object({
  questionId: z.string().uuid(),
  deduplicated: z.boolean(),
  question: knowledgeQuestionSummarySchema,
});

export const updateKnowledgeQuestionResultSchema = z.object({
  questionId: z.string().uuid(),
  question: knowledgeQuestionSummarySchema,
});

export const deleteKnowledgeQuestionResultSchema = z.object({
  deleted: z.boolean(),
  questionId: z.string().uuid(),
  deletedSolutions: z.number().int(),
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
  reused_count: z.number().int().optional(),
  succeeded_paper_ids: z.array(z.string()),
  failed_paper_ids: z.array(z.string()),
  reused_paper_ids: z.array(z.string()).optional(),
  reports: z.array(
    z.object({
      report_id: z.string().uuid(),
      paper_id: z.string(),
      title: z.string(),
      reused: z.boolean().optional(),
    }),
  ),
  workflow_id: z.string().uuid().optional(),
});

export const readByArxivIdResultSchema = z.object({
  paper_id: z.string(),
  title: z.string(),
  workflow_id: z.string().uuid().nullable(),
  report_id: z.string().uuid().nullable(),
  deduplicated: z.boolean(),
  message: z.string(),
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
export type ReadByArxivIdResult = z.infer<typeof readByArxivIdResultSchema>;
export type KnowledgeQuestionSummary = z.infer<typeof knowledgeQuestionSummarySchema>;
export type KnowledgeQuestionDetail = z.infer<typeof knowledgeQuestionDetailSchema>;
export type KnowledgeSolution = z.infer<typeof knowledgeSolutionSchema>;
export type TriggerKnowledgeExtractionResult = z.infer<typeof triggerKnowledgeExtractionResultSchema>;
export type CreateKnowledgeQuestionResult = z.infer<typeof createKnowledgeQuestionResultSchema>;
export type UpdateKnowledgeQuestionResult = z.infer<typeof updateKnowledgeQuestionResultSchema>;
export type DeleteKnowledgeQuestionResult = z.infer<typeof deleteKnowledgeQuestionResultSchema>;
