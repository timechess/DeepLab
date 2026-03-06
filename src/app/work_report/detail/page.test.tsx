import { render, screen } from "@testing-library/react";
import { expect, test, vi } from "vitest";
import WorkReportDetailPage from "./page";

vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams("reportId=1"),
}));

vi.mock("@/lib/workReport", () => ({
  getWorkReportDetail: vi.fn().mockResolvedValue({
    id: 1,
    report: "## test",
    statistics: {
      newTasks: 0,
      completedTasks: 0,
      newComments: 0,
      updatedComments: 0,
      newNotes: 0,
      updatedNotes: 0,
    },
    startDate: "2026-03-06",
    endDate: "2026-03-07",
    workflowId: 1,
    createdAt: "2026-03-07T00:00:00+08:00",
    updatedAt: "2026-03-07T00:00:00+08:00",
  }),
}));

test("WorkReportDetailPage", () => {
  render(<WorkReportDetailPage />);
  expect(screen.getByRole("main")).toBeDefined();
});
