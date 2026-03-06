import { render, screen } from "@testing-library/react";
import { expect, test, vi } from "vitest";
import NotePage from "./page";

vi.mock("@/lib/note", () => ({
  createNoteItem: vi.fn(),
  deleteNoteItem: vi.fn(),
  getNoteHistory: vi.fn().mockResolvedValue({
    page: 1,
    pageSize: 10,
    total: 0,
    items: [],
  }),
}));

test("NotePage", () => {
  render(<NotePage />);
  expect(screen.getByRole("main")).toBeDefined();
  expect(screen.getByText("双链笔记")).toBeDefined();
});
