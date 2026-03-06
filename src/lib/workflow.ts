import { invoke } from "@tauri-apps/api/core";

export type WorkflowStage = "running" | "success" | "failed";
export type TodayStatus = "none" | "running" | "ready" | "failed";

export interface StartWorkflowResponse {
  workflowId: number;
  reused: boolean;
}

export interface PaperCardDTO {
  id: string;
  title: string;
  summary: string;
  authors: string[];
  keywords: string[];
  arxivUrl: string;
  githubRepo?: string | null;
  upvotes?: number | null;
  githubStars?: number | null;
  organization?: string | null;
  score?: number | null;
  rank?: number | null;
  reason?: string | null;
  tags: string[];
}

export interface TodayRecommendationResponse {
  dayKey: string;
  status: TodayStatus;
  summary?: string;
  papers?: PaperCardDTO[];
  workflowId?: number;
  error?: string;
}

export interface WorkflowStatusResponse {
  id: number;
  name: string;
  stage: WorkflowStage;
  error?: string;
  payload: Record<string, unknown>;
}

export interface WorkflowListItem {
  id: number;
  name: string;
  stage: WorkflowStage;
  dayKey?: string | null;
  error?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface WorkflowHistoryResponse {
  page: number;
  pageSize: number;
  total: number;
  items: WorkflowListItem[];
}

export function startPaperRecommendationWorkflow(): Promise<StartWorkflowResponse> {
  return invoke<StartWorkflowResponse>("start_paper_recommendation_workflow");
}

export function getTodayPaperRecommendation(): Promise<TodayRecommendationResponse> {
  return invoke<TodayRecommendationResponse>("get_today_paper_recommendation");
}

export function getWorkflowStatus(
  workflowId: number,
): Promise<WorkflowStatusResponse> {
  return invoke<WorkflowStatusResponse>("get_workflow_status", { workflowId });
}

export function getWorkflowHistory(
  page: number,
): Promise<WorkflowHistoryResponse> {
  return invoke<WorkflowHistoryResponse>("get_workflow_history", { page });
}
