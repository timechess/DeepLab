import type { JSONContent } from "@tiptap/core";
import { Editor } from "@tiptap/core";
import { Markdown } from "@tiptap/markdown";
import { TextSelection } from "@tiptap/pm/state";
import StarterKit from "@tiptap/starter-kit";
import { afterEach, describe, expect, test } from "vitest";
import { InlineDisplayMathematics } from "./inlineDisplayMathematics";
import { MathInputAssist } from "./mathInputAssist";

function createEditor(content: JSONContent): Editor {
  document.body.innerHTML = "<div id='ed'></div>";
  const mount = document.getElementById("ed");
  if (!(mount instanceof HTMLDivElement)) {
    throw new Error("missing editor mount");
  }
  return new Editor({
    element: mount,
    extensions: [
      StarterKit,
      Markdown,
      InlineDisplayMathematics.configure({
        katexOptions: { throwOnError: false },
      }),
      MathInputAssist,
    ],
    content,
  });
}

function insertAt(editor: Editor, position: number, text: string) {
  const tr = editor.state.tr.insertText(text, position, position);
  tr.setSelection(TextSelection.create(tr.doc, position + text.length));
  editor.view.dispatch(tr);
}

function pressKey(editor: Editor, key: string): boolean {
  const event = new KeyboardEvent("keydown", {
    key,
    bubbles: true,
    cancelable: true,
  });
  let handled = false;
  editor.view.someProp("handleKeyDown", (fn) => {
    handled = fn(editor.view, event) || handled;
    return handled;
  });
  return handled;
}

function findParagraphCursorByText(
  editor: Editor,
  text: string,
  occurrence = 0,
  atEnd = false,
): number {
  let matched = -1;
  let cursor = -1;
  editor.state.doc.descendants((node, pos) => {
    if (node.type.name !== "paragraph" || node.textContent !== text) {
      return true;
    }
    matched += 1;
    if (matched !== occurrence) {
      return true;
    }
    cursor = atEnd ? pos + node.nodeSize - 1 : pos + 1;
    return false;
  });
  if (cursor < 0) {
    throw new Error(`paragraph not found: ${text}#${occurrence}`);
  }
  return cursor;
}

afterEach(() => {
  document.body.innerHTML = "";
});

describe("MathInputAssist display block behaviors", () => {
  test("typing $$ creates enter-aligned block structure", () => {
    const editor = createEditor({
      type: "doc",
      content: [{ type: "paragraph" }],
    });

    expect(pressKey(editor, "$")).toBe(true);
    expect(pressKey(editor, "$")).toBe(true);

    expect(editor.getJSON()).toEqual({
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [{ type: "text", text: "$$" }],
        },
        {
          type: "paragraph",
        },
        {
          type: "paragraph",
          content: [{ type: "text", text: "$$" }],
        },
      ],
    });
    editor.destroy();
  });

  test("normalizes same-paragraph display block when pressing Enter on opening line", () => {
    const editor = createEditor({
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [{ type: "text", text: "$$\n\n$$" }],
        },
      ],
    });

    const positionAfterOpeningFence = 3;
    const setSelectionTr = editor.state.tr.setSelection(
      TextSelection.create(editor.state.doc, positionAfterOpeningFence),
    );
    editor.view.dispatch(setSelectionTr);
    editor.commands.enter();

    expect(editor.getJSON()).toEqual({
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [{ type: "text", text: "$$" }],
        },
        {
          type: "paragraph",
        },
        {
          type: "paragraph",
          content: [{ type: "text", text: "$$" }],
        },
      ],
    });

    editor.destroy();
  });

  test("does not open command menu on display fence line", async () => {
    const editor = createEditor({
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [{ type: "text", text: "$$\n\n$$" }],
        },
      ],
    });

    // Paragraph text starts at document position 1.
    const positionAfterOpeningFence = 3;
    const setSelectionTr = editor.state.tr.setSelection(
      TextSelection.create(editor.state.doc, positionAfterOpeningFence),
    );
    editor.view.dispatch(setSelectionTr);
    insertAt(editor, positionAfterOpeningFence, "\\");

    await new Promise((resolve) => setTimeout(resolve, 0));

    const menu = document.body.querySelector(".note-math-command-menu");
    expect(menu).toBeNull();
    editor.destroy();
  });

  test("shows preview and menu in display content line", async () => {
    const editor = createEditor({
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [{ type: "text", text: "$$\n\n$$" }],
        },
      ],
    });

    const positionAtContentLine = 4;
    const setSelectionTr = editor.state.tr.setSelection(
      TextSelection.create(editor.state.doc, positionAtContentLine),
    );
    editor.view.dispatch(setSelectionTr);
    insertAt(editor, positionAtContentLine, "\\");

    await new Promise((resolve) => setTimeout(resolve, 0));

    const menu = document.body.querySelector(".note-math-command-menu");
    const preview = document.body.querySelector(".Tiptap-math-hover-preview");
    expect(menu).not.toBeNull();
    expect(preview).not.toBeNull();
    editor.destroy();
  });

  test("keeps preview after Enter-normalized structure", async () => {
    const editor = createEditor({
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [{ type: "text", text: "$$\n\n$$" }],
        },
      ],
    });

    const enterSelection = editor.state.tr.setSelection(
      TextSelection.create(editor.state.doc, 3),
    );
    editor.view.dispatch(enterSelection);
    editor.commands.enter();

    const insertionPos = editor.state.selection.from;
    insertAt(editor, insertionPos, "\\");

    await new Promise((resolve) => setTimeout(resolve, 0));

    const menu = document.body.querySelector(".note-math-command-menu");
    const preview = document.body.querySelector(".Tiptap-math-hover-preview");
    expect(menu).not.toBeNull();
    expect(preview).not.toBeNull();
    editor.destroy();
  });

  test("shows paired $$ fences while editing inside display block", async () => {
    const editor = createEditor({
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [{ type: "text", text: "$$" }],
        },
        {
          type: "paragraph",
          content: [{ type: "text", text: "x^2+y^2=z^2" }],
        },
        {
          type: "paragraph",
          content: [{ type: "text", text: "$$" }],
        },
      ],
    });

    const setSelectionTr = editor.state.tr.setSelection(
      TextSelection.create(editor.state.doc, 8),
    );
    editor.view.dispatch(setSelectionTr);

    await new Promise((resolve) => setTimeout(resolve, 0));

    const fenceEditors = Array.from(
      document.body.querySelectorAll<HTMLElement>(
        '[data-math-display-fence="true"]',
      ),
    );
    expect(fenceEditors).toHaveLength(2);
    for (const fence of fenceEditors) {
      expect(fence.getAttribute("style") ?? "").not.toContain("opacity: 0");
    }
    editor.destroy();
  });

  test("hides paired $$ fences when cursor leaves display block", async () => {
    const editor = createEditor({
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [{ type: "text", text: "$$" }],
        },
        {
          type: "paragraph",
          content: [{ type: "text", text: "x^2+y^2=z^2" }],
        },
        {
          type: "paragraph",
          content: [{ type: "text", text: "$$" }],
        },
        {
          type: "paragraph",
          content: [{ type: "text", text: "tail" }],
        },
      ],
    });

    let tailCursor = 1;
    editor.state.doc.descendants((node, pos) => {
      if (node.type.name === "paragraph" && node.textContent === "tail") {
        tailCursor = pos + 2;
        return false;
      }
      return true;
    });
    const setSelectionTr = editor.state.tr.setSelection(
      TextSelection.create(editor.state.doc, tailCursor),
    );
    editor.view.dispatch(setSelectionTr);

    await new Promise((resolve) => setTimeout(resolve, 0));

    const fenceEditors = Array.from(
      document.body.querySelectorAll<HTMLElement>(
        '[data-math-display-fence="true"]',
      ),
    );
    expect(fenceEditors).toHaveLength(2);
    for (const fence of fenceEditors) {
      expect(fence.getAttribute("style")).toContain("opacity: 0");
    }
    editor.destroy();
  });

  test("moves cursor into formula end when selection lands on closing fence", async () => {
    const editor = createEditor({
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [{ type: "text", text: "$$" }],
        },
        {
          type: "paragraph",
          content: [{ type: "text", text: "x^2+y^2=z^2" }],
        },
        {
          type: "paragraph",
          content: [{ type: "text", text: "$$" }],
        },
        {
          type: "paragraph",
          content: [{ type: "text", text: "tail" }],
        },
      ],
    });

    const tailCursor = findParagraphCursorByText(editor, "tail");
    editor.view.dispatch(
      editor.state.tr.setSelection(
        TextSelection.create(editor.state.doc, tailCursor),
      ),
    );

    const closingFenceCursor = findParagraphCursorByText(editor, "$$", 1);
    editor.view.dispatch(
      editor.state.tr.setSelection(
        TextSelection.create(editor.state.doc, closingFenceCursor),
      ),
    );
    await new Promise((resolve) => setTimeout(resolve, 0));

    const expectedCursor = findParagraphCursorByText(
      editor,
      "x^2+y^2=z^2",
      0,
      true,
    );
    expect(editor.state.selection.from).toBe(expectedCursor);

    const fenceEditors = Array.from(
      document.body.querySelectorAll<HTMLElement>(
        '[data-math-display-fence="true"]',
      ),
    );
    expect(fenceEditors).toHaveLength(2);
    for (const fence of fenceEditors) {
      expect(fence.getAttribute("style") ?? "").not.toContain("opacity: 0");
    }
    editor.destroy();
  });

  test("moves cursor into formula end when selection lands on opening fence", async () => {
    const editor = createEditor({
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [{ type: "text", text: "head" }],
        },
        {
          type: "paragraph",
          content: [{ type: "text", text: "$$" }],
        },
        {
          type: "paragraph",
          content: [{ type: "text", text: "x^2+y^2=z^2" }],
        },
        {
          type: "paragraph",
          content: [{ type: "text", text: "$$" }],
        },
      ],
    });

    const headCursor = findParagraphCursorByText(editor, "head", 0, true);
    editor.view.dispatch(
      editor.state.tr.setSelection(
        TextSelection.create(editor.state.doc, headCursor),
      ),
    );

    const openingFenceCursor = findParagraphCursorByText(editor, "$$", 0);
    editor.view.dispatch(
      editor.state.tr.setSelection(
        TextSelection.create(editor.state.doc, openingFenceCursor),
      ),
    );
    await new Promise((resolve) => setTimeout(resolve, 0));

    const expectedCursor = findParagraphCursorByText(
      editor,
      "x^2+y^2=z^2",
      0,
      true,
    );
    expect(editor.state.selection.from).toBe(expectedCursor);

    const fenceEditors = Array.from(
      document.body.querySelectorAll<HTMLElement>(
        '[data-math-display-fence="true"]',
      ),
    );
    expect(fenceEditors).toHaveLength(2);
    for (const fence of fenceEditors) {
      expect(fence.getAttribute("style") ?? "").not.toContain("opacity: 0");
    }
    editor.destroy();
  });

  test("allows leaving formula block when cursor came from inside", async () => {
    const editor = createEditor({
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [{ type: "text", text: "$$" }],
        },
        {
          type: "paragraph",
          content: [{ type: "text", text: "x^2+y^2=z^2" }],
        },
        {
          type: "paragraph",
          content: [{ type: "text", text: "$$" }],
        },
        {
          type: "paragraph",
          content: [{ type: "text", text: "tail" }],
        },
      ],
    });

    const contentEnd = findParagraphCursorByText(
      editor,
      "x^2+y^2=z^2",
      0,
      true,
    );
    editor.view.dispatch(
      editor.state.tr.setSelection(
        TextSelection.create(editor.state.doc, contentEnd),
      ),
    );

    const closingFenceCursor = findParagraphCursorByText(editor, "$$", 1);
    editor.view.dispatch(
      editor.state.tr.setSelection(
        TextSelection.create(editor.state.doc, closingFenceCursor),
      ),
    );
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(editor.state.selection.from).toBe(closingFenceCursor);
    editor.destroy();
  });
});
