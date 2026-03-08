import { render, screen } from "@testing-library/react";
import { expect, test, vi } from "vitest";
import NoteDetailPage from "./page";

vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams("noteId=1"),
}));

vi.mock("@/lib/note", () => ({
  getNoteDetail: vi.fn().mockResolvedValue({
    id: 1,
    title: "未命名笔记",
    content:
      '{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"hello"}]}]}',
    createdAt: "2026-03-09 00:00:00.000",
    updatedAt: "2026-03-09 00:00:00.000",
  }),
  getNoteHistory: vi
    .fn()
    .mockResolvedValue({ page: 1, pageSize: 10, total: 0, items: [] }),
  getNoteLinkedContext: vi
    .fn()
    .mockResolvedValue({ papers: [], tasks: [], notes: [], workReports: [] }),
  getNoteRevisions: vi
    .fn()
    .mockResolvedValue({ page: 1, pageSize: 20, total: 0, items: [] }),
  getNoteRevisionDetail: vi.fn(),
  restoreNoteRevision: vi.fn(),
  searchNotePapers: vi.fn().mockResolvedValue([]),
  searchNoteWorkReports: vi.fn().mockResolvedValue([]),
  updateNoteContent: vi.fn().mockResolvedValue({
    detail: {
      id: 1,
      title: "未命名笔记",
      content:
        '{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"hello"}]}]}',
      createdAt: "2026-03-09 00:00:00.000",
      updatedAt: "2026-03-09 00:00:00.000",
    },
    savedHash: "0",
    revisionId: 1,
    savedAt: "2026-03-09 00:00:00.000",
    skippedLinks: [],
  }),
}));

vi.mock("@/lib/paperReport", () => ({
  getPaperReportDetail: vi.fn(),
}));

vi.mock("@/lib/tasks", () => ({
  getTaskHistory: vi.fn().mockResolvedValue({
    page: 1,
    pageSize: 10,
    total: 0,
    pendingTotal: 0,
    completedTotal: 0,
    items: [],
  }),
}));

test("NoteDetailPage", () => {
  render(<NoteDetailPage />);
  expect(screen.getByRole("main")).toBeDefined();
});
