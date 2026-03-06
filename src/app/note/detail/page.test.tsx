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
    content: '{"type":"doc","content":[{"type":"paragraph"}]}',
  }),
  getNoteHistory: vi
    .fn()
    .mockResolvedValue({ page: 1, pageSize: 10, total: 0, items: [] }),
  getNoteLinkedContext: vi
    .fn()
    .mockResolvedValue({ papers: [], tasks: [], notes: [] }),
  searchNotePapers: vi.fn().mockResolvedValue([]),
  updateNoteContent: vi.fn().mockResolvedValue({
    id: 1,
    title: "未命名笔记",
    content: '{"type":"doc","content":[{"type":"paragraph"}]}',
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
