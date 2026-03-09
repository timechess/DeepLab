import { describe, expect, test } from "vitest";
import {
  findSourceSlashTrigger,
  getSourceCommandInsertion,
  replaceSourceTextRange,
} from "./sourceMarkdown";

describe("sourceMarkdown", () => {
  test("finds slash trigger at current line tail", () => {
    const content = "第一行\n这里输入 /pap";
    const cursor = content.length;
    expect(findSourceSlashTrigger(content, cursor)).toEqual({
      query: "pap",
      range: { from: content.length - 4, to: content.length },
    });
  });

  test("returns null when slash command is broken by space", () => {
    const content = "输入 /paper test";
    expect(findSourceSlashTrigger(content, content.length)).toBeNull();
  });

  test("provides markdown insertion template for code command", () => {
    expect(getSourceCommandInsertion("code")).toEqual({
      text: "```text\n\n```",
      cursorOffset: "```text\n".length,
    });
  });

  test("replaces range and returns next cursor selection", () => {
    const replaced = replaceSourceTextRange(
      "abc/pa def",
      { from: 3, to: 6 },
      "- ",
    );
    expect(replaced).toEqual({
      value: "abc-  def",
      selection: 5,
    });
  });
});
