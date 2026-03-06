import { render, screen } from "@testing-library/react";
import { expect, test, vi } from "vitest";
import WorkReportPage from "./page";

vi.mock("@/lib/workReport", () => ({
  getWorkReportHistory: vi.fn().mockResolvedValue({
    page: 1,
    pageSize: 10,
    total: 0,
    items: [],
  }),
}));

test("WorkReportPage", () => {
  render(<WorkReportPage />);
  expect(screen.getByRole("main")).toBeDefined();
});
