import { invoke } from "@tauri-apps/api/core";

export type WorkReportStatus = "none" | "running" | "ready" | "failed";

export interface WorkReportDeltaStats {
  newTasks: number;
  completedTasks: number;
  newComments: number;
  updatedComments: number;
  newNotes: number;
  updatedNotes: number;
}

export interface WorkReportOverviewResponse {
  dayKey: string;
  status: WorkReportStatus;
  canTrigger: boolean;
  blockReason?: string | null;
  workflowId?: number | null;
  reportId?: number | null;
  reportUpdatedAt?: string | null;
  stats: WorkReportDeltaStats;
}

export interface WorkReportListItem {
  id: number;
  status: string;
  startDate: string;
  endDate: string;
  updatedAt: string;
}

export interface WorkReportHistoryResponse {
  page: number;
  pageSize: number;
  total: number;
  items: WorkReportListItem[];
}

export interface WorkReportDetail {
  id: number;
  report: string;
  statistics: WorkReportDeltaStats;
  startDate: string;
  endDate: string;
  workflowId?: number | null;
  createdAt: string;
  updatedAt: string;
}

export interface StartWorkReportResponse {
  workflowId: number;
  reused: boolean;
}

export function getTodayWorkReportOverview(): Promise<WorkReportOverviewResponse> {
  return invoke<WorkReportOverviewResponse>("get_today_work_report_overview");
}

export function startWorkReportWorkflow(): Promise<StartWorkReportResponse> {
  return invoke<StartWorkReportResponse>("start_work_report_workflow");
}

export function getWorkReportHistory(page: number): Promise<WorkReportHistoryResponse> {
  return invoke<WorkReportHistoryResponse>("get_work_report_history", { page });
}

export function getWorkReportDetail(reportId: number): Promise<WorkReportDetail> {
  return invoke<WorkReportDetail>("get_work_report_detail", { reportId });
}
