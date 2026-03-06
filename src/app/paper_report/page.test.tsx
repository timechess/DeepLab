import { render, screen } from "@testing-library/react";
import { expect, test, vi } from "vitest";
import PaperReportPage from "./page";

vi.mock("@/lib/paperReport", () => ({
  getPaperReportHistory: vi.fn().mockResolvedValue({
    page: 1,
    pageSize: 10,
    total: 0,
    items: [],
  }),
  startPaperReadingWorkflow: vi.fn(),
}));

vi.mock("@/lib/workflow", () => ({
  getWorkflowStatus: vi.fn(),
}));

test("PaperReportPage", () => {
  render(<PaperReportPage />);
  expect(screen.getByRole("main")).toBeDefined();
});
