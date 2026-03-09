import type { Editor, JSONContent } from "@tiptap/core";
import type {
  EditorPosition,
  PickerType,
  SaveState,
  SlashMenuState,
  TargetPickerState,
} from "./types";

export function safeJsonParse(input: string): Record<string, unknown> {
  const emptyDoc = { type: "doc", content: [{ type: "paragraph" }] };
  const toTextDoc = (value: string) => ({
    type: "doc",
    content: [
      {
        type: "paragraph",
        content: [{ type: "text", text: value }],
      },
    ],
  });
  const safeStringify = (value: unknown): string => {
    try {
      const serialized = JSON.stringify(value);
      return serialized ?? "";
    } catch {
      return String(value ?? "");
    }
  };
  const trimmed = input.trim();
  if (!trimmed) {
    return emptyDoc;
  }

  let parsed: unknown = trimmed;
  for (let depth = 0; depth < 3; depth += 1) {
    if (typeof parsed !== "string") {
      break;
    }
    const candidate = parsed.trim();
    if (!candidate) {
      return emptyDoc;
    }
    try {
      parsed = JSON.parse(candidate);
    } catch {
      parsed = candidate;
      break;
    }
  }

  if (Array.isArray(parsed)) {
    const nodeLike = parsed.every((item) => {
      if (!item || typeof item !== "object") {
        return false;
      }
      const nodeType = (item as { type?: unknown }).type;
      return typeof nodeType === "string" && nodeType.trim().length > 0;
    });
    if (nodeLike) {
      return { type: "doc", content: parsed as unknown[] };
    }
    const serialized = safeStringify(parsed);
    return serialized.trim() ? toTextDoc(serialized) : emptyDoc;
  }
  if (typeof parsed === "object" && parsed !== null) {
    const node = parsed as Record<string, unknown>;
    const nodeType = node.type;
    if (nodeType === "doc") {
      return node;
    }
    if (typeof nodeType === "string" && nodeType.trim().length > 0) {
      return { type: "doc", content: [node] };
    }
    const contentText =
      typeof node.content === "string"
        ? node.content
        : typeof node.markdown === "string"
          ? node.markdown
          : typeof node.text === "string"
            ? node.text
            : safeStringify(node);
    const normalizedText = contentText.trim();
    return normalizedText ? toTextDoc(normalizedText) : emptyDoc;
  }
  if (typeof parsed === "string" && parsed.trim()) {
    return toTextDoc(parsed);
  }
  return emptyDoc;
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

export function localPositionFromTextareaCaret(
  textarea: HTMLTextAreaElement,
  cursor: number,
  container: HTMLDivElement | null,
): EditorPosition {
  const safeCursor = Math.max(0, Math.min(cursor, textarea.value.length));
  const style = window.getComputedStyle(textarea);
  const fontSize = Number.parseFloat(style.fontSize) || 16;
  const lineHeight = Number.parseFloat(style.lineHeight);
  const resolvedLineHeight = Number.isFinite(lineHeight)
    ? lineHeight
    : fontSize * 1.5;
  const textBeforeCursor = textarea.value.slice(0, safeCursor);
  const lines = textBeforeCursor.split("\n");
  const row = Math.max(0, lines.length - 1);
  const column = [...(lines.at(-1) ?? "")].length;
  const estimatedCharWidth = fontSize * 0.58;
  const relativeTop =
    textarea.offsetTop +
    12 +
    (row + 1) * resolvedLineHeight -
    textarea.scrollTop;
  const relativeLeft =
    textarea.offsetLeft +
    14 +
    column * estimatedCharWidth -
    textarea.scrollLeft;
  const clampedTop = Math.max(relativeTop, textarea.offsetTop + 12);
  const clampedLeft = Math.max(relativeLeft, textarea.offsetLeft + 12);
  if (!container) {
    return { top: clampedTop, left: clampedLeft };
  }
  return {
    top: clampedTop + container.scrollTop,
    left: clampedLeft + container.scrollLeft,
  };
}
