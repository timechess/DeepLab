import { invoke } from "@tauri-apps/api/core";

export type NoteRefType = "paper" | "task" | "note" | "work_report";

export interface NoteListItem {
  id: number;
  title: string;
  createdAt: string;
  updatedAt: string;
}

export interface NoteHistoryResponse {
  page: number;
  pageSize: number;
  total: number;
  items: NoteListItem[];
}

export interface NoteDetail {
  id: number;
  title: string;
  content: string;
  createdAt: string;
  updatedAt: string;
}

export interface NoteSaveResult {
  detail: NoteDetail;
  savedHash: string;
  revisionId: number;
  savedAt: string;
  skippedLinks: string[];
}

export interface NoteRevisionListItem {
  revisionId: number;
  noteId: number;
  source: string;
  createdAt: string;
  snapshotSize: number;
  contentHash: string;
}

export interface NoteRevisionResponse {
  page: number;
  pageSize: number;
  total: number;
  items: NoteRevisionListItem[];
}

export interface NoteRevisionDetail {
  revisionId: number;
  noteId: number;
  title: string;
  content: string;
  source: string;
  createdAt: string;
  snapshotSize: number;
  contentHash: string;
}

export interface NoteLinkRefInput {
  refType: NoteRefType;
  refId: string;
  label?: string;
}

export interface NoteUpsertInput {
  title: string;
  content: string;
  expectedUpdatedAt?: string | null;
  saveSource?: "autosave" | "shortcut" | "visibility" | "restore" | "manual";
}

export interface NotePaperLink {
  paperId: string;
  title: string;
  arxivUrl: string;
  hasReport: boolean;
}

export interface NotePaperOption {
  paperId: string;
  title: string;
  hasReport: boolean;
}

export interface NoteTaskLink {
  taskId: number;
  title: string;
  description?: string | null;
  priority: "low" | "medium" | "high";
  completedDate?: string | null;
  updatedAt: string;
}

export interface NoteRefNote {
  noteId: number;
  title: string;
  updatedAt: string;
}

export interface NoteWorkReportLink {
  reportId: number;
  reportDate: string;
  startDate: string;
  updatedAt: string;
}

export interface NoteWorkReportOption {
  reportId: number;
  reportDate: string;
  startDate: string;
}

export interface NoteLinkedContext {
  papers: NotePaperLink[];
  tasks: NoteTaskLink[];
  notes: NoteRefNote[];
  workReports: NoteWorkReportLink[];
}

export function getNoteHistory(
  page: number,
  query: string,
): Promise<NoteHistoryResponse> {
  return invoke<NoteHistoryResponse>("get_note_history", {
    page,
    query: query.trim() || null,
  });
}

export function createNoteItem(): Promise<NoteDetail> {
  return invoke<NoteDetail>("create_note_item");
}

export function deleteNoteItem(id: number): Promise<void> {
  return invoke<void>("delete_note_item", { id });
}

export function getNoteDetail(id: number): Promise<NoteDetail> {
  return invoke<NoteDetail>("get_note_detail", { id });
}

export function updateNoteContent(
  id: number,
  input: NoteUpsertInput,
): Promise<NoteSaveResult> {
  return invoke<NoteSaveResult>("update_note_content", { id, input });
}

export function getNoteRevisions(
  id: number,
  page = 1,
  pageSize = 20,
): Promise<NoteRevisionResponse> {
  return invoke<NoteRevisionResponse>("get_note_revisions", {
    id,
    page,
    pageSize,
  });
}

export function getNoteRevisionDetail(
  id: number,
  revisionId: number,
): Promise<NoteRevisionDetail> {
  return invoke<NoteRevisionDetail>("get_note_revision_detail", {
    id,
    revisionId,
  });
}

export function restoreNoteRevision(
  id: number,
  revisionId: number,
  expectedUpdatedAt?: string | null,
): Promise<NoteSaveResult> {
  return invoke<NoteSaveResult>("restore_note_revision", {
    id,
    revisionId,
    expectedUpdatedAt: expectedUpdatedAt ?? null,
  });
}

export function getNoteLinkedContext(id: number): Promise<NoteLinkedContext> {
  return invoke<NoteLinkedContext>("get_note_linked_context", { id });
}

export function searchNotePapers(query: string): Promise<NotePaperOption[]> {
  return invoke<NotePaperOption[]>("search_note_papers", {
    query: query.trim() || null,
  });
}

export function searchNoteWorkReports(
  query: string,
): Promise<NoteWorkReportOption[]> {
  return invoke<NoteWorkReportOption[]>("search_note_work_reports", {
    query: query.trim() || null,
  });
}
