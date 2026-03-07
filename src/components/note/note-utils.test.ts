import { describe, expect, test } from "vitest";
import type { JSONContent } from "@tiptap/core";
import {
  fallbackMarkdownFromJson,
  hasNoteReferenceNode,
} from "@/components/note/note-utils";

describe("note-utils markdown export", () => {
  test("exports all reference types as [[type:id | label]]", () => {
    const doc: JSONContent = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            {
              type: "noteReference",
              attrs: { refType: "paper", refId: "2501.01234", label: "论文A" },
            },
            { type: "text", text: " " },
            {
              type: "noteReference",
              attrs: { refType: "task", refId: "42", label: "任务B" },
            },
            { type: "text", text: " " },
            {
              type: "noteReference",
              attrs: { refType: "note", refId: "7", label: "笔记C" },
            },
            { type: "text", text: " " },
            {
              type: "noteReference",
              attrs: {
                refType: "work_report",
                refId: "2026-03-07",
                label: "日报D",
              },
            },
          ],
        },
      ],
    };

    expect(hasNoteReferenceNode(doc)).toBe(true);
    expect(fallbackMarkdownFromJson(doc)).toBe(
      "[[paper:2501.01234 | 论文A]] [[task:42 | 任务B]] [[note:7 | 笔记C]] [[work_report:2026-03-07 | 日报D]]",
    );
  });
});
