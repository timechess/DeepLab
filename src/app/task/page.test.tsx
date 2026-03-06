import { render, screen } from "@testing-library/react";
import { expect, test, vi } from "vitest";
import TaskPage from "./page";

vi.mock("@/lib/tasks", () => ({
  createTaskItem: vi.fn(),
  deleteTaskItem: vi.fn(),
  getTaskHistory: vi.fn().mockResolvedValue({
    page: 1,
    pageSize: 10,
    total: 0,
    pendingTotal: 0,
    completedTotal: 0,
    items: [],
  }),
  toggleTaskCompleted: vi.fn(),
  updateTaskItem: vi.fn(),
}));

test("TaskPage", () => {
  render(<TaskPage />);
  expect(screen.getByRole("main")).toBeDefined();
  expect(screen.getByText("任务清单")).toBeDefined();
});
