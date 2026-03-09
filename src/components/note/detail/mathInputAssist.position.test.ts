import { describe, expect, test } from "vitest";
import { calculateMathMenuPlacement } from "./mathInputAssist";

describe("calculateMathMenuPlacement", () => {
  test("anchors below cursor when there is enough space", () => {
    const placement = calculateMathMenuPlacement({
      anchorRect: { left: 120, top: 120, bottom: 140 },
      menuSize: { width: 260, height: 180 },
      viewportSize: { width: 1200, height: 800 },
    });

    expect(placement.side).toBe("bottom");
    expect(placement.top).toBe(148);
    expect(placement.left).toBe(120);
  });

  test("keeps anchoring below cursor when below space is insufficient", () => {
    const placement = calculateMathMenuPlacement({
      anchorRect: { left: 120, top: 740, bottom: 760 },
      menuSize: { width: 260, height: 220 },
      viewportSize: { width: 1200, height: 800 },
    });

    expect(placement.side).toBe("bottom");
    expect(placement.top).toBe(768);
    expect(placement.left).toBe(120);
  });

  test("clamps horizontal position inside viewport", () => {
    const placement = calculateMathMenuPlacement({
      anchorRect: { left: 780, top: 120, bottom: 140 },
      menuSize: { width: 300, height: 180 },
      viewportSize: { width: 900, height: 800 },
    });

    expect(placement.left).toBe(592);
  });
});
