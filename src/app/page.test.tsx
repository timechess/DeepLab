import { render, screen } from "@testing-library/react";
import { expect, test, vi } from "vitest";
import Page from "../app/page";

vi.mock("@/lib/workflow", () => ({
  getTodayPaperRecommendation: vi.fn().mockResolvedValue({
    dayKey: "2026-03-07",
    status: "none",
  }),
  startPaperRecommendationWorkflow: vi.fn(),
}));

vi.mock("@/lib/workReport", () => ({
  getTodayWorkReportOverview: vi.fn().mockResolvedValue({
    dayKey: "2026-03-07",
    status: "none",
    canTrigger: false,
    blockReason: "当前无可汇总的行为增量",
    stats: {
      newTasks: 0,
      completedTasks: 0,
      newComments: 0,
      updatedComments: 0,
      newNotes: 0,
      updatedNotes: 0,
    },
  }),
  startWorkReportWorkflow: vi.fn(),
}));

test("Page", () => {
  render(<Page />);
  expect(screen.getByRole("main")).toBeDefined();
});
