import { invoke } from "@tauri-apps/api/core";

export interface PaperReadingTriggerInput {
  paperIdOrUrl: string;
}

export interface StartPaperReadingResponse {
  workflowId: number;
  paperId: string;
  reused: boolean;
}

export type PaperReportStatus = "running" | "ready" | "failed";

export interface PaperReportListItem {
  paperId: string;
  title: string;
  status: PaperReportStatus;
  updatedAt: string;
  hasComment: boolean;
}

export interface PaperReportListResponse {
  page: number;
  pageSize: number;
  total: number;
  items: PaperReportListItem[];
}

export interface PaperReportDetail {
  paperId: string;
  title: string;
  authors: string[];
  organization?: string | null;
  summary: string;
  arxivUrl: string;
  githubRepo?: string | null;
  report?: string | null;
  comment?: string | null;
  status: PaperReportStatus;
  error?: string | null;
  updatedAt: string;
}

export interface PaperReportCommentInput {
  comment: string;
}

export function startPaperReadingWorkflow(
  input: PaperReadingTriggerInput,
): Promise<StartPaperReadingResponse> {
  return invoke<StartPaperReadingResponse>("start_paper_reading_workflow", {
    input,
  });
}

export function getPaperReportHistory(
  page: number,
): Promise<PaperReportListResponse> {
  return invoke<PaperReportListResponse>("get_paper_report_history", { page });
}

export function getPaperReportDetail(
  paperId: string,
): Promise<PaperReportDetail> {
  return invoke<PaperReportDetail>("get_paper_report_detail", { paperId });
}

export function updatePaperReportComment(
  paperId: string,
  input: PaperReportCommentInput,
): Promise<void> {
  return invoke<void>("update_paper_report_comment", { paperId, input });
}
