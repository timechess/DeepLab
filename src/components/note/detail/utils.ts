import type { Editor, JSONContent } from "@tiptap/core";
import type {
  EditorPosition,
  PickerType,
  SaveState,
  SlashMenuState,
  TargetPickerState,
} from "./types";

export function safeJsonParse(input: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(input);
    if (typeof parsed === "object" && parsed !== null) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    // no-op
  }
  return { type: "doc", content: [{ type: "paragraph" }] };
}

function textFromNode(node: JSONContent | null | undefined): string {
  if (!node) {
    return "";
  }
  if (node.type === "text") {
    return node.text ?? "";
  }
  if (!Array.isArray(node.content) || node.content.length === 0) {
    return "";
  }
  return node.content
    .map((child) => textFromNode(child as JSONContent))
    .join("");
}

export function normalizeLegacyMathNodes(node: JSONContent): JSONContent[] {
  if (node.type === "inlineMath") {
    const latex = String(
      (node.attrs as { latex?: string } | undefined)?.latex ?? "",
    ).trim();
    if (!latex) {
      return [];
    }
    return [{ type: "text", text: `$${latex}$` }];
  }

  if (node.type === "blockMath") {
    const latex = String(
      (node.attrs as { latex?: string } | undefined)?.latex ?? "",
    ).trim();
    if (!latex) {
      return [];
    }
    return [
      { type: "paragraph", content: [{ type: "text", text: `$$${latex}$$` }] },
    ];
  }

  if (
    node.type === "mathematics" ||
    node.type === "displayMathematics" ||
    node.type === "inlineDisplayMathematics" ||
    node.type === "inlineMathematics"
  ) {
    const attrs = (node.attrs ?? {}) as {
      latex?: string;
      text?: string;
      value?: string;
      displayMode?: boolean;
    };
    const latex = (
      attrs.latex ??
      attrs.value ??
      attrs.text ??
      textFromNode(node)
    ).trim();
    if (!latex) {
      return [];
    }
    const shouldBlock =
      node.type === "mathematics" ||
      node.type === "displayMathematics" ||
      attrs.displayMode === true;
    if (shouldBlock) {
      return [
        {
          type: "paragraph",
          content: [{ type: "text", text: `$$${latex}$$` }],
        },
      ];
    }
    return [{ type: "text", text: `$${latex}$` }];
  }

  if (node.type === "text") {
    return [node];
  }

  const children = Array.isArray(node.content) ? node.content : [];
  const normalizedChildren: JSONContent[] = [];
  for (const child of children) {
    normalizedChildren.push(...normalizeLegacyMathNodes(child));
  }

  if (node.type === "paragraph" && normalizedChildren.length === 1) {
    const onlyChild = normalizedChildren[0];
    if (onlyChild?.type === "text") {
      const raw = (onlyChild.text ?? "").trim();
      const blockDollarMatch = raw.match(/^\$\$([\s\S]+)\$\$$/);
      const blockBracketMatch = raw.match(/^\\\[([\s\S]+)\\\]$/);
      const latex = (
        blockDollarMatch?.[1] ??
        blockBracketMatch?.[1] ??
        ""
      ).trim();
      if (latex) {
        return [{ type: "blockMath", attrs: { latex } }];
      }
    }
  }

  return [{ ...node, content: normalizedChildren }];
}

export function statusLabel(state: SaveState): string {
  if (state === "dirty") {
    return "未保存";
  }
  if (state === "saving") {
    return "保存中...";
  }
  if (state === "failed") {
    return "保存失败";
  }
  return "已保存";
}

export function pickerTitle(type: PickerType): string {
  if (type === "paper") {
    return "选择论文引用";
  }
  if (type === "task") {
    return "选择任务引用";
  }
  return "选择笔记引用";
}

export function emptySlashMenuState(): SlashMenuState {
  return {
    open: false,
    query: "",
    position: { top: 0, left: 0 },
    range: null,
    activeIndex: 0,
  };
}

export function emptyTargetPickerState(): TargetPickerState {
  return {
    open: false,
    targetType: "paper",
    query: "",
    position: { top: 0, left: 0 },
    range: null,
    activeIndex: 0,
  };
}

export function localPositionFromEditor(
  editor: Editor,
  pos: number,
  container: HTMLDivElement | null,
): EditorPosition {
  const coords = editor.view.coordsAtPos(pos);
  if (!container) {
    return { top: coords.bottom + 8, left: coords.left };
  }
  const rect = container.getBoundingClientRect();
  return {
    top: coords.bottom - rect.top + container.scrollTop + 8,
    left: coords.left - rect.left + container.scrollLeft,
  };
}

export function normalizeDisplayMathParagraphs(editor: Editor): boolean {
  const { state } = editor;
  const paragraphType = state.schema.nodes.paragraph;
  if (!paragraphType) {
    return false;
  }

  const topNodes: Array<{
    node: { type: unknown; textContent: string; nodeSize: number };
    pos: number;
  }> = [];
  state.doc.forEach((node, pos) => {
    topNodes.push({
      node: node as { type: unknown; textContent: string; nodeSize: number },
      pos,
    });
  });

  let tr = state.tr;
  let changed = false;
  for (let index = topNodes.length - 3; index >= 0; index -= 1) {
    const first = topNodes[index];
    const middle = topNodes[index + 1];
    const third = topNodes[index + 2];

    if (!first || !middle || !third) {
      continue;
    }

    if (
      first.node.type !== paragraphType ||
      middle.node.type !== paragraphType ||
      third.node.type !== paragraphType
    ) {
      continue;
    }

    const firstText = first.node.textContent.trim();
    const middleText = middle.node.textContent.trim();
    const thirdText = third.node.textContent.trim();
    if (firstText !== "$$" || thirdText !== "$$" || !middleText) {
      continue;
    }

    const replacement = paragraphType.create(
      null,
      state.schema.text(`$$${middleText}$$`),
    );
    const from = first.pos;
    const to = third.pos + third.node.nodeSize;
    tr = tr.replaceWith(from, to, replacement);
    changed = true;
    index -= 2;
  }

  if (!changed) {
    return false;
  }

  editor.view.dispatch(tr);
  return true;
}
