import type { Editor } from "@tiptap/core";
import { Extension } from "@tiptap/core";
import {
  type EditorState,
  Plugin,
  PluginKey,
  TextSelection,
  type Transaction,
} from "@tiptap/pm/state";
import Suggestion, {
  exitSuggestion,
  type SuggestionKeyDownProps,
  type SuggestionMatch,
  type Trigger,
} from "@tiptap/suggestion";

type BracketPair = {
  open: string;
  close: string;
};

type MathCompletionItem = {
  command: string;
  hint: string;
  insertText: string;
  cursorOffset?: number;
};

type MathMenuPlacementInput = {
  anchorRect: Pick<DOMRect, "left" | "top" | "bottom">;
  menuSize: {
    width: number;
    height: number;
  };
  viewportSize: {
    width: number;
    height: number;
  };
  gap?: number;
  margin?: number;
  minHeight?: number;
};

type MathMenuPlacement = {
  side: "bottom";
  left: number;
  top: number;
  maxHeight: number;
};

const INPUT_ASSIST_PLUGIN_KEY = new PluginKey("mathInputAssist");
const MATH_COMMAND_PLUGIN_KEY = new PluginKey("mathCommandSuggestion");
const MATH_MENU_GAP = 8;
const MATH_MENU_MARGIN = 8;
const MATH_MENU_MIN_HEIGHT = 96;
const MATH_MENU_MIN_WIDTH = 260;
const MATH_MENU_ESTIMATED_HEIGHT = 220;

function clampValue(value: number, min: number, max: number): number {
  if (value < min) {
    return min;
  }
  if (value > max) {
    return max;
  }
  return value;
}

function caretRectFromEditor(
  editor: Editor | null | undefined,
): Pick<DOMRect, "left" | "top" | "bottom"> | null {
  if (!editor) {
    return null;
  }
  try {
    const cursorPos = editor.state.selection.from;
    const coords = editor.view.coordsAtPos(cursorPos);
    return {
      left: coords.left,
      top: coords.top,
      bottom: coords.bottom,
    };
  } catch {
    return null;
  }
}

function caretRectFromDomSelection(
  editor: Editor | null | undefined,
): Pick<DOMRect, "left" | "top" | "bottom"> | null {
  if (!editor) {
    return null;
  }

  const dom = editor.view.dom;
  const domSelection = dom.ownerDocument.getSelection();
  if (!domSelection || domSelection.rangeCount === 0) {
    return null;
  }

  const { anchorNode } = domSelection;
  if (!anchorNode || !dom.contains(anchorNode)) {
    return null;
  }

  try {
    const range = domSelection.getRangeAt(0).cloneRange();
    range.collapse(true);
    const rect = range.getBoundingClientRect();
    if (!Number.isFinite(rect.top) || !Number.isFinite(rect.bottom)) {
      return null;
    }
    if (rect.width === 0 && rect.height === 0 && rect.top === 0) {
      return null;
    }
    return {
      left: rect.left,
      top: rect.top,
      bottom: rect.bottom,
    };
  } catch {
    return null;
  }
}

function scrollContainersFromEditor(
  editor: Editor | null | undefined,
): HTMLElement[] {
  if (!editor || typeof window === "undefined") {
    return [];
  }

  const containers: HTMLElement[] = [];
  const seen = new Set<HTMLElement>();
  let node = editor.view.dom.parentElement;

  while (node) {
    const style = window.getComputedStyle(node);
    const canScrollY =
      /(auto|scroll|overlay)/.test(style.overflowY) &&
      node.scrollHeight > node.clientHeight;
    const canScrollX =
      /(auto|scroll|overlay)/.test(style.overflowX) &&
      node.scrollWidth > node.clientWidth;
    if ((canScrollY || canScrollX) && !seen.has(node)) {
      seen.add(node);
      containers.push(node);
    }
    node = node.parentElement;
  }

  return containers;
}

export function calculateMathMenuPlacement({
  anchorRect,
  menuSize,
  viewportSize,
  gap = MATH_MENU_GAP,
  margin = MATH_MENU_MARGIN,
  minHeight = MATH_MENU_MIN_HEIGHT,
}: MathMenuPlacementInput): MathMenuPlacement {
  const safeViewportWidth = Math.max(viewportSize.width, margin * 2 + 1);
  const safeViewportHeight = Math.max(viewportSize.height, margin * 2 + 1);
  const safeMenuWidth = Math.max(menuSize.width, MATH_MENU_MIN_WIDTH);

  const availableBelow = Math.max(
    0,
    safeViewportHeight - anchorRect.bottom - gap - margin,
  );
  const maxHeight = Math.max(minHeight, Math.floor(availableBelow));

  const leftMin = margin;
  const leftMax = Math.max(leftMin, safeViewportWidth - safeMenuWidth - margin);
  const left = clampValue(anchorRect.left, leftMin, leftMax);

  return {
    side: "bottom",
    left,
    top: anchorRect.bottom + gap,
    maxHeight,
  };
}

const BRACKET_PAIRS: BracketPair[] = [
  { open: "(", close: ")" },
  { open: "[", close: "]" },
  { open: "{", close: "}" },
  { open: "（", close: "）" },
  { open: "【", close: "】" },
  { open: "「", close: "」" },
  { open: "《", close: "》" },
];

const OPEN_TO_CLOSE = new Map(
  BRACKET_PAIRS.map((pair) => [pair.open, pair.close]),
);
const CLOSE_SET = new Set(BRACKET_PAIRS.map((pair) => pair.close));

const KATEX_COMMAND_COMPLETIONS: MathCompletionItem[] = [
  { command: "\\alpha", hint: "希腊字母", insertText: "\\alpha" },
  { command: "\\beta", hint: "希腊字母", insertText: "\\beta" },
  { command: "\\gamma", hint: "希腊字母", insertText: "\\gamma" },
  { command: "\\delta", hint: "希腊字母", insertText: "\\delta" },
  { command: "\\epsilon", hint: "希腊字母", insertText: "\\epsilon" },
  { command: "\\theta", hint: "希腊字母", insertText: "\\theta" },
  { command: "\\lambda", hint: "希腊字母", insertText: "\\lambda" },
  { command: "\\mu", hint: "希腊字母", insertText: "\\mu" },
  { command: "\\pi", hint: "希腊字母", insertText: "\\pi" },
  { command: "\\sigma", hint: "希腊字母", insertText: "\\sigma" },
  { command: "\\phi", hint: "希腊字母", insertText: "\\phi" },
  { command: "\\omega", hint: "希腊字母", insertText: "\\omega" },
  { command: "\\Gamma", hint: "大写希腊字母", insertText: "\\Gamma" },
  { command: "\\Delta", hint: "大写希腊字母", insertText: "\\Delta" },
  { command: "\\Theta", hint: "大写希腊字母", insertText: "\\Theta" },
  { command: "\\Lambda", hint: "大写希腊字母", insertText: "\\Lambda" },
  { command: "\\Pi", hint: "大写希腊字母", insertText: "\\Pi" },
  { command: "\\Sigma", hint: "大写希腊字母", insertText: "\\Sigma" },
  { command: "\\Phi", hint: "大写希腊字母", insertText: "\\Phi" },
  { command: "\\Omega", hint: "大写希腊字母", insertText: "\\Omega" },
  {
    command: "\\frac",
    hint: "分式模板",
    insertText: "\\frac{}{}",
    cursorOffset: "\\frac{".length,
  },
  {
    command: "\\sqrt",
    hint: "根式模板",
    insertText: "\\sqrt{}",
    cursorOffset: "\\sqrt{".length,
  },
  {
    command: "\\sqrt[n]",
    hint: "带次数根式",
    insertText: "\\sqrt[]{}",
    cursorOffset: "\\sqrt[".length,
  },
  {
    command: "\\sum",
    hint: "求和模板",
    insertText: "\\sum_{}^{}",
    cursorOffset: "\\sum_{".length,
  },
  {
    command: "\\prod",
    hint: "连乘模板",
    insertText: "\\prod_{}^{}",
    cursorOffset: "\\prod_{".length,
  },
  {
    command: "\\int",
    hint: "积分模板",
    insertText: "\\int_{}^{}",
    cursorOffset: "\\int_{".length,
  },
  {
    command: "\\lim",
    hint: "极限模板",
    insertText: "\\lim_{x \\to }",
    cursorOffset: 13,
  },
  { command: "\\to", hint: "趋向箭头", insertText: "\\to" },
  { command: "\\infty", hint: "无穷大", insertText: "\\infty" },
  { command: "\\partial", hint: "偏导符号", insertText: "\\partial" },
  { command: "\\nabla", hint: "梯度算子", insertText: "\\nabla" },
  { command: "\\forall", hint: "全称量词", insertText: "\\forall" },
  { command: "\\exists", hint: "存在量词", insertText: "\\exists" },
  { command: "\\neg", hint: "逻辑非", insertText: "\\neg" },
  { command: "\\land", hint: "逻辑与", insertText: "\\land" },
  { command: "\\lor", hint: "逻辑或", insertText: "\\lor" },
  { command: "\\Rightarrow", hint: "蕴含", insertText: "\\Rightarrow" },
  {
    command: "\\Leftrightarrow",
    hint: "等价",
    insertText: "\\Leftrightarrow",
  },
  { command: "\\cdot", hint: "乘点", insertText: "\\cdot" },
  { command: "\\times", hint: "叉乘", insertText: "\\times" },
  { command: "\\div", hint: "除号", insertText: "\\div" },
  { command: "\\pm", hint: "正负号", insertText: "\\pm" },
  { command: "\\mp", hint: "负正号", insertText: "\\mp" },
  { command: "\\le", hint: "小于等于", insertText: "\\le" },
  { command: "\\ge", hint: "大于等于", insertText: "\\ge" },
  { command: "\\neq", hint: "不等于", insertText: "\\neq" },
  { command: "\\approx", hint: "约等于", insertText: "\\approx" },
  { command: "\\equiv", hint: "恒等于", insertText: "\\equiv" },
  { command: "\\propto", hint: "正比于", insertText: "\\propto" },
  { command: "\\in", hint: "属于", insertText: "\\in" },
  { command: "\\notin", hint: "不属于", insertText: "\\notin" },
  { command: "\\subset", hint: "真子集", insertText: "\\subset" },
  { command: "\\subseteq", hint: "子集", insertText: "\\subseteq" },
  { command: "\\supset", hint: "真超集", insertText: "\\supset" },
  { command: "\\supseteq", hint: "超集", insertText: "\\supseteq" },
  { command: "\\cup", hint: "并集", insertText: "\\cup" },
  { command: "\\cap", hint: "交集", insertText: "\\cap" },
  { command: "\\setminus", hint: "差集", insertText: "\\setminus" },
  { command: "\\varnothing", hint: "空集", insertText: "\\varnothing" },
  {
    command: "\\mathbb",
    hint: "黑板体模板",
    insertText: "\\mathbb{}",
    cursorOffset: 8,
  },
  {
    command: "\\mathbf",
    hint: "粗体模板",
    insertText: "\\mathbf{}",
    cursorOffset: 8,
  },
  {
    command: "\\mathrm",
    hint: "正体模板",
    insertText: "\\mathrm{}",
    cursorOffset: 8,
  },
  {
    command: "\\mathcal",
    hint: "花体模板",
    insertText: "\\mathcal{}",
    cursorOffset: 9,
  },
  {
    command: "\\overline",
    hint: "上划线模板",
    insertText: "\\overline{}",
    cursorOffset: 10,
  },
  {
    command: "\\underline",
    hint: "下划线模板",
    insertText: "\\underline{}",
    cursorOffset: 11,
  },
  {
    command: "\\hat",
    hint: "帽子符号模板",
    insertText: "\\hat{}",
    cursorOffset: 5,
  },
  {
    command: "\\bar",
    hint: "横杠符号模板",
    insertText: "\\bar{}",
    cursorOffset: 5,
  },
  {
    command: "\\vec",
    hint: "向量箭头模板",
    insertText: "\\vec{}",
    cursorOffset: 5,
  },
  {
    command: "\\dot",
    hint: "一点导数模板",
    insertText: "\\dot{}",
    cursorOffset: 5,
  },
  {
    command: "\\ddot",
    hint: "二点导数模板",
    insertText: "\\ddot{}",
    cursorOffset: 6,
  },
  {
    command: "\\left(\\right)",
    hint: "自适应圆括号",
    insertText: "\\left(\\right)",
    cursorOffset: 6,
  },
  {
    command: "\\left[\\right]",
    hint: "自适应方括号",
    insertText: "\\left[\\right]",
    cursorOffset: 6,
  },
  {
    command: "\\left\\{\\right\\}",
    hint: "自适应花括号",
    insertText: "\\left\\{\\right\\}",
    cursorOffset: 8,
  },
  { command: "\\sin", hint: "三角函数", insertText: "\\sin" },
  { command: "\\cos", hint: "三角函数", insertText: "\\cos" },
  { command: "\\tan", hint: "三角函数", insertText: "\\tan" },
  { command: "\\arcsin", hint: "反三角函数", insertText: "\\arcsin" },
  { command: "\\arccos", hint: "反三角函数", insertText: "\\arccos" },
  { command: "\\arctan", hint: "反三角函数", insertText: "\\arctan" },
  { command: "\\log", hint: "对数函数", insertText: "\\log" },
  { command: "\\ln", hint: "自然对数", insertText: "\\ln" },
  { command: "\\exp", hint: "指数函数", insertText: "\\exp" },
  { command: "\\max", hint: "最值算子", insertText: "\\max" },
  { command: "\\min", hint: "最值算子", insertText: "\\min" },
  {
    command: "\\argmax",
    hint: "最优点模板",
    insertText: "\\argmax_{}",
    cursorOffset: 9,
  },
  {
    command: "\\argmin",
    hint: "最优点模板",
    insertText: "\\argmin_{}",
    cursorOffset: 9,
  },
  {
    command: "\\operatorname",
    hint: "自定义算子",
    insertText: "\\operatorname{}",
    cursorOffset: 14,
  },
  {
    command: "\\begin{align}",
    hint: "多行对齐模板",
    insertText: "\\begin{align}\n\n\\end{align}",
    cursorOffset: 14,
  },
  {
    command: "\\begin{cases}",
    hint: "分段函数模板",
    insertText: "\\begin{cases}\n\n\\end{cases}",
    cursorOffset: 14,
  },
  {
    command: "\\begin{matrix}",
    hint: "矩阵模板",
    insertText: "\\begin{matrix}\n\n\\end{matrix}",
    cursorOffset: 14,
  },
  {
    command: "\\begin{pmatrix}",
    hint: "圆括号矩阵模板",
    insertText: "\\begin{pmatrix}\n\n\\end{pmatrix}",
    cursorOffset: 15,
  },
  {
    command: "\\begin{bmatrix}",
    hint: "方括号矩阵模板",
    insertText: "\\begin{bmatrix}\n\n\\end{bmatrix}",
    cursorOffset: 15,
  },
  {
    command: "\\text",
    hint: "公式内文本",
    insertText: "\\text{}",
    cursorOffset: 6,
  },
  { command: "\\qquad", hint: "大空白", insertText: "\\qquad" },
  { command: "\\quad", hint: "中空白", insertText: "\\quad" },
  { command: "\\cdots", hint: "居中省略号", insertText: "\\cdots" },
  { command: "\\ldots", hint: "基线省略号", insertText: "\\ldots" },
];

function isEscapedDollar(text: string, index: number): boolean {
  let slashCount = 0;
  let cursor = index - 1;
  while (cursor >= 0 && text[cursor] === "\\") {
    slashCount += 1;
    cursor -= 1;
  }
  return slashCount % 2 === 1;
}

function isDisplayMathFenceText(text: string): boolean {
  return text.trim() === "$$";
}

type DisplayBlockParagraph = {
  lines: string[];
};

type DisplayFenceBlockMatch = {
  blockFrom: number;
  blockTo: number;
  contentCursor: number | null;
};

type CompletionSuppressionRange = {
  from: number;
  to: number;
};

type InputAssistPluginMeta = {
  normalizedDisplayEnter?: boolean;
  completionInsertedRange?: CompletionSuppressionRange;
  suppressFenceRedirect?: boolean;
};

type MathModeBeforeCursor = {
  mode: "none" | "inline" | "display";
  openingIndex: number | null;
};

function parseDisplayBlockParagraph(
  text: string,
): DisplayBlockParagraph | null {
  const matched = text.match(/^\$\$([\s\S]*?)\$\$$/);
  if (!matched) {
    return null;
  }

  const inner = matched[1] ?? "";
  if (!inner.includes("\n")) {
    return null;
  }

  const normalized = inner.replace(/^\n/, "").replace(/\n$/, "");
  if (!normalized) {
    return { lines: [""] };
  }
  return { lines: normalized.split("\n") };
}

type SiblingNodeInfo = {
  index: number;
  pos: number;
  node: {
    type: { name: string };
    textContent: string;
    nodeSize: number;
  };
};

function findSiblingFenceIndex(
  siblings: SiblingNodeInfo[],
  fromIndex: number,
  step: -1 | 1,
): number | null {
  for (
    let index = fromIndex + step;
    index >= 0 && index < siblings.length;
    index += step
  ) {
    const sibling = siblings[index];
    if (!sibling || sibling.node.type.name !== "paragraph") {
      return null;
    }
    if (isDisplayMathFenceText(sibling.node.textContent)) {
      return index;
    }
  }
  return null;
}

function findDisplayFenceBlockMatch(
  state: EditorState,
): DisplayFenceBlockMatch | null {
  if (!isSelectionOnDisplayFenceParagraph(state)) {
    return null;
  }

  const { $from } = state.selection;
  if ($from.depth < 1) {
    return null;
  }

  const parentDepth = $from.depth - 1;
  const parent = $from.node(parentDepth);
  const currentIndex = $from.index(parentDepth);
  const parentStart = $from.start(parentDepth);
  const siblings: SiblingNodeInfo[] = [];

  let positionCursor = parentStart;
  for (let index = 0; index < parent.childCount; index += 1) {
    const child = parent.child(index);
    siblings.push({
      index,
      pos: positionCursor,
      node: child as unknown as {
        type: { name: string };
        textContent: string;
        nodeSize: number;
      },
    });
    positionCursor += child.nodeSize;
  }

  const current = siblings[currentIndex];
  if (
    !current ||
    current.node.type.name !== "paragraph" ||
    !isDisplayMathFenceText(current.node.textContent)
  ) {
    return null;
  }

  let openingIndex = currentIndex;
  let closingIndex = findSiblingFenceIndex(siblings, currentIndex, 1);
  if (closingIndex == null) {
    const previousOpening = findSiblingFenceIndex(siblings, currentIndex, -1);
    if (previousOpening == null) {
      return null;
    }
    openingIndex = previousOpening;
    closingIndex = currentIndex;
  }

  const opening = siblings[openingIndex];
  const closing = siblings[closingIndex];
  if (!opening || !closing) {
    return null;
  }

  for (
    let contentIndex = closingIndex - 1;
    contentIndex > openingIndex;
    contentIndex -= 1
  ) {
    const content = siblings[contentIndex];
    if (
      !content ||
      content.node.type.name !== "paragraph" ||
      isDisplayMathFenceText(content.node.textContent)
    ) {
      continue;
    }
    return {
      blockFrom: opening.pos,
      blockTo: closing.pos + closing.node.nodeSize,
      contentCursor: content.pos + content.node.nodeSize - 1,
    };
  }

  return {
    blockFrom: opening.pos,
    blockTo: closing.pos + closing.node.nodeSize,
    contentCursor: null,
  };
}

function normalizeCompletionSuppressionRange(
  range: CompletionSuppressionRange | null | undefined,
  maxDocPosition: number,
): CompletionSuppressionRange | null {
  if (!range) {
    return null;
  }
  const safeMax = Math.max(1, maxDocPosition);
  const from = Math.round(clampValue(range.from, 1, safeMax));
  const to = Math.round(clampValue(range.to, from, safeMax));
  if (from > to) {
    return null;
  }
  return { from, to };
}

function isSelectionInsideCompletionSuppressionRange(
  state: EditorState,
  range: CompletionSuppressionRange | null,
): boolean {
  if (!range || !state.selection.empty) {
    return false;
  }
  const cursor = state.selection.from;
  return cursor >= range.from && cursor <= range.to;
}

function inputAssistMetaFromTransaction(
  transaction: Transaction,
): InputAssistPluginMeta | undefined {
  return transaction.getMeta(INPUT_ASSIST_PLUGIN_KEY) as
    | InputAssistPluginMeta
    | undefined;
}

function updateCompletionSuppressionRangeFromTransaction(
  transaction: Transaction,
  currentRange: CompletionSuppressionRange | null,
  maxDocPosition: number,
): CompletionSuppressionRange | null {
  const meta = inputAssistMetaFromTransaction(transaction);
  const completionInsertedRange = normalizeCompletionSuppressionRange(
    meta?.completionInsertedRange,
    maxDocPosition,
  );
  if (completionInsertedRange) {
    return completionInsertedRange;
  }
  if (transaction.docChanged) {
    return null;
  }
  if (!currentRange) {
    return null;
  }

  return normalizeCompletionSuppressionRange(
    {
      from: transaction.mapping.map(currentRange.from, -1),
      to: transaction.mapping.map(currentRange.to, 1),
    },
    maxDocPosition,
  );
}

function hasCompletionInsertedRangeMeta(transaction: Transaction): boolean {
  const meta = inputAssistMetaFromTransaction(transaction);
  return meta?.completionInsertedRange != null;
}

function hasSuppressFenceRedirectMeta(transaction: Transaction): boolean {
  const meta = inputAssistMetaFromTransaction(transaction);
  return meta?.suppressFenceRedirect === true;
}

function shouldSuppressMathSuggestion(
  state: EditorState,
  transaction: Transaction,
  range: CompletionSuppressionRange | null,
): boolean {
  if (transaction.docChanged || hasCompletionInsertedRangeMeta(transaction)) {
    return false;
  }
  return isSelectionInsideCompletionSuppressionRange(state, range);
}

function isSelectionOnDisplayFenceParagraph(state: EditorState): boolean {
  const { selection } = state;
  if (!selection.empty) {
    return false;
  }
  const parent = selection.$from.parent;
  return parent.type.name === "paragraph" && parent.textContent.trim() === "$$";
}

function resolveMathModeBeforeCursor(
  text: string,
  offset: number,
): MathModeBeforeCursor {
  let mode: "none" | "inline" | "display" = "none";
  let openingIndex: number | null = null;
  let index = 0;

  while (index < offset) {
    if (text[index] !== "$" || isEscapedDollar(text, index)) {
      index += 1;
      continue;
    }

    // Treat `$$` as display delimiter only when both `$` are before cursor.
    const isDouble = text[index + 1] === "$" && index + 1 < offset;
    if (isDouble) {
      if (mode === "none") {
        mode = "display";
        openingIndex = index;
      } else if (mode === "display") {
        mode = "none";
        openingIndex = null;
      }
      index += 2;
      continue;
    }

    if (mode === "none") {
      mode = "inline";
      openingIndex = index;
    } else if (mode === "inline") {
      mode = "none";
      openingIndex = null;
    }
    index += 1;
  }

  return { mode, openingIndex };
}

function findClosingInlineDelimiter(
  text: string,
  offset: number,
): number | null {
  let index = offset;
  while (index < text.length) {
    if (text[index] !== "$" || isEscapedDollar(text, index)) {
      index += 1;
      continue;
    }
    if (text[index + 1] === "$") {
      index += 2;
      continue;
    }
    return index;
  }
  return null;
}

function findClosingDisplayDelimiter(
  text: string,
  offset: number,
): number | null {
  for (let index = offset; index < text.length - 1; index += 1) {
    if (
      text[index] === "$" &&
      text[index + 1] === "$" &&
      !isEscapedDollar(text, index)
    ) {
      return index;
    }
  }
  return null;
}

function lineNumberAtOffset(text: string, offset: number): number {
  const clampedOffset = Math.max(0, Math.min(offset, text.length));
  let line = 0;
  for (let index = 0; index < clampedOffset; index += 1) {
    if (text[index] === "\n") {
      line += 1;
    }
  }
  return line;
}

function isInMathContext(state: EditorState): boolean {
  const { selection } = state;
  if (!selection.empty) {
    return false;
  }

  const { $from } = selection;
  if (!$from.parent.isTextblock || $from.parent.type.name === "codeBlock") {
    return false;
  }

  const text = $from.parent.textContent;
  const offset = $from.parentOffset;
  if (!text || offset < 0 || offset > text.length) {
    return isInsideDisplayMathSkeleton(state);
  }

  const modeContext = resolveMathModeBeforeCursor(text, offset);
  const openingIndex = modeContext.openingIndex;
  if (modeContext.mode === "inline") {
    const closingIndex = findClosingInlineDelimiter(text, offset);
    if (closingIndex == null || openingIndex == null) {
      return false;
    }
    return offset > openingIndex + 1 && offset <= closingIndex;
  }
  if (modeContext.mode === "display") {
    const closingIndex = findClosingDisplayDelimiter(text, offset);
    if (closingIndex == null || openingIndex == null) {
      return false;
    }
    if (offset <= openingIndex + 2 || offset > closingIndex) {
      return false;
    }

    // For multiline display blocks, keep command completion inside content lines
    // and never trigger on opening/closing fence lines.
    const openingLine = lineNumberAtOffset(text, openingIndex);
    const closingLine = lineNumberAtOffset(text, closingIndex);
    if (closingLine > openingLine) {
      const cursorLine = lineNumberAtOffset(text, offset);
      if (cursorLine <= openingLine || cursorLine >= closingLine) {
        return false;
      }
    }
    return true;
  }

  return isInsideDisplayMathSkeleton(state);
}

function isInsideDisplayMathSkeleton(state: EditorState): boolean {
  const { selection } = state;
  if (!selection.empty) {
    return false;
  }

  const { $from } = selection;
  if ($from.parent.type.name === "codeBlock") {
    return false;
  }

  for (let depth = $from.depth - 1; depth >= 0; depth -= 1) {
    const container = $from.node(depth);
    const currentIndex = $from.index(depth);
    const currentNode = container.maybeChild(currentIndex);
    if (!currentNode?.isTextblock) {
      continue;
    }
    if (isDisplayMathFenceText(currentNode.textContent)) {
      continue;
    }

    let fenceCountBefore = 0;
    for (let left = 0; left < currentIndex; left += 1) {
      const candidate = container.maybeChild(left);
      if (
        candidate?.isTextblock &&
        isDisplayMathFenceText(candidate.textContent)
      ) {
        fenceCountBefore += 1;
      }
    }

    if (fenceCountBefore % 2 !== 1) {
      continue;
    }

    for (
      let right = currentIndex + 1;
      right < container.childCount;
      right += 1
    ) {
      const candidate = container.maybeChild(right);
      if (!candidate || !candidate.isTextblock) {
        continue;
      }
      if (isDisplayMathFenceText(candidate.textContent)) {
        return true;
      }
    }

    // Still inside an unfinished block-math fence (opening `$$` already exists).
    if (fenceCountBefore > 0) {
      return true;
    }
  }

  return false;
}

function findMathCommandMatch(config: Trigger): SuggestionMatch {
  const { $position } = config;
  const parentText = $position.parent.textContent;
  const textBefore = parentText.slice(0, $position.parentOffset);
  const match = textBefore.match(/\\([A-Za-z]*)$/);
  if (!match) {
    return null;
  }

  const fullText = match[0] ?? "";
  const query = match[1] ?? "";
  const from = $position.pos - fullText.length;
  const to = $position.pos;

  return {
    range: { from, to },
    query,
    text: fullText,
  };
}

function charBefore(state: EditorState): string {
  const { from } = state.selection;
  if (from <= 1) {
    return "";
  }
  return state.doc.textBetween(from - 1, from, "\n", "\0");
}

function charAfter(state: EditorState): string {
  const { from } = state.selection;
  if (from >= state.doc.nodeSize - 2) {
    return "";
  }
  return state.doc.textBetween(from, from + 1, "\n", "\0");
}

function applyTextAndCursor(
  editor: Editor,
  from: number,
  to: number,
  text: string,
  cursorOffset: number,
  meta?: InputAssistPluginMeta,
) {
  const tr = editor.state.tr.insertText(text, from, to);
  if (meta) {
    tr.setMeta(INPUT_ASSIST_PLUGIN_KEY, meta);
  }
  const cursorPos = from + cursorOffset;
  tr.setSelection(TextSelection.create(tr.doc, cursorPos));
  editor.view.dispatch(tr);
}

function createParagraphNode(
  state: EditorState,
  value: string,
): ReturnType<
  NonNullable<EditorState["schema"]["nodes"]["paragraph"]>["create"]
> | null {
  const paragraphType = state.schema.nodes.paragraph;
  if (!paragraphType) {
    return null;
  }
  if (!value) {
    return paragraphType.create();
  }
  return paragraphType.create(undefined, state.schema.text(value));
}

export const MathInputAssist = Extension.create({
  name: "mathInputAssist",
  priority: 1000,

  addProseMirrorPlugins() {
    let completionSuppressionRange: CompletionSuppressionRange | null = null;

    const inputAssistPlugin = new Plugin({
      key: INPUT_ASSIST_PLUGIN_KEY,
      props: {
        handleKeyDown: (view, event) => {
          if (!this.editor.isEditable || event.defaultPrevented) {
            return false;
          }
          if (event.metaKey || event.ctrlKey || event.altKey) {
            return false;
          }

          const state = this.editor.state;
          if (!state.selection.empty) {
            return false;
          }

          const { $from } = state.selection;
          if ($from.parent.type.name === "codeBlock") {
            return false;
          }

          if (event.key === "Enter") {
            const text = $from.parent.textContent;
            const offset = $from.parentOffset;
            const parsedDisplay = parseDisplayBlockParagraph(text);
            const modeContext = resolveMathModeBeforeCursor(text, offset);
            const closingIndex = findClosingDisplayDelimiter(text, offset);
            if (
              parsedDisplay &&
              modeContext.mode === "display" &&
              modeContext.openingIndex != null &&
              closingIndex != null
            ) {
              const cursorLine = lineNumberAtOffset(text, offset);
              const openingLine = lineNumberAtOffset(
                text,
                modeContext.openingIndex,
              );
              if (cursorLine === openingLine) {
                const paragraphType = state.schema.nodes.paragraph;
                if (!paragraphType) {
                  return false;
                }
                event.preventDefault();
                event.stopPropagation();
                if ("stopImmediatePropagation" in event) {
                  event.stopImmediatePropagation();
                }
                const createParagraph = (value: string) => {
                  if (!value) {
                    return paragraphType.create();
                  }
                  return paragraphType.create(
                    undefined,
                    state.schema.text(value),
                  );
                };

                const openingNode = createParagraph("$$");
                const contentNodes = parsedDisplay.lines.map((line) =>
                  createParagraph(line),
                );
                const closingNode = createParagraph("$$");
                const replacement = [openingNode, ...contentNodes, closingNode];

                const from = $from.before();
                const to = $from.after();
                const tr = state.tr.replaceWith(from, to, replacement);
                const cursorPos = Math.min(
                  from + openingNode.nodeSize + 1,
                  tr.doc.nodeSize - 2,
                );
                tr.setMeta(INPUT_ASSIST_PLUGIN_KEY, {
                  normalizedDisplayEnter: true,
                } satisfies InputAssistPluginMeta);
                tr.setSelection(
                  TextSelection.create(tr.doc, Math.max(cursorPos, 1)),
                );
                view.dispatch(tr);
                return true;
              }
            }
          }

          if (event.key === "$") {
            const from = state.selection.from;
            const before = charBefore(state);
            const after = charAfter(state);

            if (before === "\\") {
              return false;
            }

            event.preventDefault();

            if (before === "$" && after === "$") {
              const currentParagraphText = $from.parent.textContent.trim();
              if (currentParagraphText === "$$") {
                const openingNode = createParagraphNode(state, "$$");
                const middleNode = createParagraphNode(state, "");
                const closingNode = createParagraphNode(state, "$$");
                if (openingNode && middleNode && closingNode) {
                  const tr = state.tr.replaceWith(
                    $from.before(),
                    $from.after(),
                    [openingNode, middleNode, closingNode],
                  );
                  const cursorPos = Math.min(
                    $from.before() + openingNode.nodeSize + 1,
                    tr.doc.nodeSize - 2,
                  );
                  tr.setSelection(
                    TextSelection.create(tr.doc, Math.max(cursorPos, 1)),
                  );
                  tr.setMeta(INPUT_ASSIST_PLUGIN_KEY, {
                    suppressFenceRedirect: true,
                  } satisfies InputAssistPluginMeta);
                  view.dispatch(tr);
                  return true;
                }
              }

              applyTextAndCursor(
                this.editor,
                from - 1,
                from + 1,
                "$$\n\n$$",
                3,
                { suppressFenceRedirect: true },
              );
              return true;
            }

            if (after === "$") {
              const tr = state.tr.setSelection(
                TextSelection.create(state.tr.doc, from + 1),
              );
              view.dispatch(tr);
              return true;
            }

            applyTextAndCursor(this.editor, from, from, "$$", 1, {
              suppressFenceRedirect: true,
            });
            return true;
          }

          const closing = OPEN_TO_CLOSE.get(event.key);
          if (closing) {
            event.preventDefault();
            const from = state.selection.from;
            applyTextAndCursor(
              this.editor,
              from,
              from,
              `${event.key}${closing}`,
              1,
            );
            return true;
          }

          if (CLOSE_SET.has(event.key)) {
            const after = charAfter(state);
            if (after === event.key) {
              event.preventDefault();
              const tr = state.tr.setSelection(
                TextSelection.create(state.tr.doc, state.selection.from + 1),
              );
              view.dispatch(tr);
              return true;
            }
          }

          return false;
        },
      },
      appendTransaction: (transactions, _oldState, newState) => {
        const maxDocPosition = Math.max(1, newState.doc.nodeSize - 2);
        for (const transaction of transactions) {
          completionSuppressionRange =
            updateCompletionSuppressionRangeFromTransaction(
              transaction,
              completionSuppressionRange,
              maxDocPosition,
            );
        }
        if (
          completionSuppressionRange &&
          !isSelectionInsideCompletionSuppressionRange(
            newState,
            completionSuppressionRange,
          )
        ) {
          completionSuppressionRange = null;
        }

        const hasDocChange = transactions.some((tr) => tr.docChanged);
        const hasDocChangeOrSelectionSet = transactions.some(
          (tr) => tr.docChanged || tr.selectionSet,
        );
        const hasSuppressFenceRedirect = transactions.some((tr) =>
          hasSuppressFenceRedirectMeta(tr),
        );
        if (
          !hasDocChangeOrSelectionSet ||
          hasSuppressFenceRedirect ||
          !isSelectionOnDisplayFenceParagraph(newState)
        ) {
          return null;
        }

        const fenceMatch = findDisplayFenceBlockMatch(newState);
        if (fenceMatch) {
          if (!hasDocChange) {
            const previousCursor = _oldState.selection.from;
            const previousInsideSameBlock =
              previousCursor >= fenceMatch.blockFrom &&
              previousCursor <= fenceMatch.blockTo;
            if (previousInsideSameBlock) {
              return null;
            }
          }
          if (
            fenceMatch.contentCursor != null &&
            newState.selection.from !== fenceMatch.contentCursor
          ) {
            return newState.tr.setSelection(
              TextSelection.create(newState.doc, fenceMatch.contentCursor),
            );
          }
          return null;
        }
        return null;
      },
    });

    const suggestionPlugin = Suggestion<MathCompletionItem, MathCompletionItem>(
      {
        editor: this.editor,
        pluginKey: MATH_COMMAND_PLUGIN_KEY,
        char: "\\",
        allowSpaces: false,
        allowedPrefixes: null,
        findSuggestionMatch: findMathCommandMatch,
        allow: ({ state }) => isInMathContext(state),
        shouldShow: ({ editor, transaction }) => {
          const maxDocPosition = Math.max(1, editor.state.doc.nodeSize - 2);
          completionSuppressionRange =
            updateCompletionSuppressionRangeFromTransaction(
              transaction,
              completionSuppressionRange,
              maxDocPosition,
            );
          return !shouldSuppressMathSuggestion(
            editor.state,
            transaction,
            completionSuppressionRange,
          );
        },
        items: ({ query }) => {
          const normalized = query.trim().toLowerCase();
          if (!normalized) {
            return KATEX_COMMAND_COMPLETIONS.slice(0, 10);
          }
          return KATEX_COMMAND_COMPLETIONS.filter((item) =>
            item.command.toLowerCase().includes(`\\${normalized}`),
          ).slice(0, 12);
        },
        command: ({ editor, range, props }) => {
          const insertText = props.insertText;
          const cursorOffset = props.cursorOffset ?? insertText.length;
          const completionInsertedRange: CompletionSuppressionRange = {
            from: range.from,
            to: range.from + insertText.length,
          };
          const tr = editor.state.tr.insertText(
            insertText,
            range.from,
            range.to,
          );
          tr.setMeta(INPUT_ASSIST_PLUGIN_KEY, {
            completionInsertedRange,
          } satisfies InputAssistPluginMeta);
          tr.setSelection(
            TextSelection.create(tr.doc, range.from + cursorOffset),
          );
          editor.view.dispatch(tr);
          exitSuggestion(editor.view, MATH_COMMAND_PLUGIN_KEY);
        },
        render: () => {
          let selectedIndex = 0;
          let popup: HTMLDivElement | null = null;
          let items: MathCompletionItem[] = [];
          let command: ((item: MathCompletionItem) => void) | null = null;
          let latestClientRect: (() => DOMRect | null) | null | undefined =
            null;
          let latestEditor: Editor | null | undefined = null;
          let positionRafId: number | null = null;
          let removePositionListeners: (() => void) | null = null;
          const scrollListenerOptions: AddEventListenerOptions = {
            capture: true,
            passive: true,
          };

          const clearScheduledPositionSync = () => {
            if (positionRafId == null) {
              return;
            }
            window.cancelAnimationFrame(positionRafId);
            positionRafId = null;
          };

          const renderList = () => {
            if (!popup) {
              return;
            }

            popup.innerHTML = items
              .map((item, index) => {
                const isActive = index === selectedIndex;
                const escapedCommand = item.command
                  .replace(/</g, "&lt;")
                  .replace(/>/g, "&gt;");
                const escapedHint = item.hint
                  .replace(/</g, "&lt;")
                  .replace(/>/g, "&gt;");
                return `<button type="button" data-index="${index}" class="${isActive ? "active" : ""}"><span>${escapedCommand}</span><em>${escapedHint}</em></button>`;
              })
              .join("");
          };

          const updatePosition = (
            clientRect: (() => DOMRect | null) | null | undefined,
            editor: Editor | null | undefined,
          ) => {
            if (!popup) {
              return;
            }
            const fallbackRect = clientRect?.();
            const caretRect =
              caretRectFromEditor(editor) ?? caretRectFromDomSelection(editor);
            const rect = caretRect ?? fallbackRect;
            if (!rect) {
              return;
            }
            const viewportWidth =
              window.innerWidth || document.documentElement.clientWidth || 0;
            const viewportHeight =
              window.innerHeight || document.documentElement.clientHeight || 0;
            const measuredRect = popup.getBoundingClientRect();
            const placement = calculateMathMenuPlacement({
              anchorRect: {
                left: rect.left,
                top: rect.top,
                bottom: rect.bottom,
              },
              menuSize: {
                width:
                  measuredRect.width ||
                  popup.offsetWidth ||
                  MATH_MENU_MIN_WIDTH,
                height:
                  measuredRect.height ||
                  popup.offsetHeight ||
                  MATH_MENU_ESTIMATED_HEIGHT,
              },
              viewportSize: {
                width: viewportWidth,
                height: viewportHeight,
              },
            });

            popup.style.left = `${placement.left}px`;
            popup.style.maxHeight = `${placement.maxHeight}px`;
            popup.style.bottom = "";
            popup.style.top = `${placement.top}px`;
          };

          const syncPosition = () => {
            updatePosition(latestClientRect, latestEditor);
          };

          const schedulePositionSync = () => {
            if (positionRafId != null) {
              return;
            }
            positionRafId = window.requestAnimationFrame(() => {
              positionRafId = null;
              syncPosition();
            });
          };

          const ensureWindowListeners = () => {
            if (removePositionListeners) {
              return;
            }
            const ownerDocument =
              latestEditor?.view.dom.ownerDocument ?? document;
            const ownerWindow = ownerDocument.defaultView ?? window;
            const scrollTargets: EventTarget[] = [
              ownerWindow,
              ownerDocument,
              ownerDocument.documentElement,
            ];
            if (ownerDocument.body) {
              scrollTargets.push(ownerDocument.body);
            }
            for (const container of scrollContainersFromEditor(latestEditor)) {
              scrollTargets.push(container);
            }
            const uniqueScrollTargets = Array.from(new Set(scrollTargets));
            for (const target of uniqueScrollTargets) {
              target.addEventListener(
                "scroll",
                schedulePositionSync,
                scrollListenerOptions,
              );
            }
            ownerWindow.addEventListener("resize", schedulePositionSync);
            ownerWindow.visualViewport?.addEventListener(
              "scroll",
              schedulePositionSync,
            );
            ownerWindow.visualViewport?.addEventListener(
              "resize",
              schedulePositionSync,
            );

            removePositionListeners = () => {
              for (const target of uniqueScrollTargets) {
                target.removeEventListener(
                  "scroll",
                  schedulePositionSync,
                  scrollListenerOptions,
                );
              }
              ownerWindow.removeEventListener("resize", schedulePositionSync);
              ownerWindow.visualViewport?.removeEventListener(
                "scroll",
                schedulePositionSync,
              );
              ownerWindow.visualViewport?.removeEventListener(
                "resize",
                schedulePositionSync,
              );
            };
          };

          const teardownWindowListeners = () => {
            removePositionListeners?.();
            removePositionListeners = null;
            clearScheduledPositionSync();
          };

          const onMouseDown = (event: MouseEvent) => {
            event.preventDefault();
            const target = event.target as HTMLElement | null;
            const button = target?.closest(
              "button[data-index]",
            ) as HTMLButtonElement | null;
            if (!button || !command) {
              return;
            }
            const index = Number(button.dataset.index ?? "-1");
            const item = items[index];
            if (!item) {
              return;
            }
            command(item);
          };

          return {
            onStart: (props) => {
              selectedIndex = 0;
              items = props.items;
              command = props.command;
              latestClientRect = props.clientRect;
              latestEditor = props.editor;
              popup = document.createElement("div");
              popup.className = "note-math-command-menu";
              popup.addEventListener("mousedown", onMouseDown);
              document.body.appendChild(popup);
              renderList();
              ensureWindowListeners();
              syncPosition();
            },
            onUpdate: (props) => {
              items = props.items;
              command = props.command;
              latestClientRect = props.clientRect;
              latestEditor = props.editor;
              if (selectedIndex >= items.length) {
                selectedIndex = Math.max(0, items.length - 1);
              }
              renderList();
              syncPosition();
            },
            onKeyDown: (props: SuggestionKeyDownProps) => {
              if (props.event.key === "Escape") {
                exitSuggestion(props.view, MATH_COMMAND_PLUGIN_KEY);
                return true;
              }
              if (items.length === 0) {
                return false;
              }
              if (props.event.key === "ArrowUp") {
                selectedIndex =
                  (selectedIndex + items.length - 1) % items.length;
                renderList();
                return true;
              }
              if (props.event.key === "ArrowDown") {
                selectedIndex = (selectedIndex + 1) % items.length;
                renderList();
                return true;
              }
              if (props.event.key === "Enter" || props.event.key === "Tab") {
                const item = items[selectedIndex];
                if (!item || !command) {
                  return false;
                }
                command(item);
                return true;
              }
              return false;
            },
            onExit: () => {
              teardownWindowListeners();
              if (popup) {
                popup.removeEventListener("mousedown", onMouseDown);
                popup.remove();
              }
              popup = null;
              items = [];
              command = null;
              latestClientRect = null;
              latestEditor = null;
            },
          };
        },
      },
    );

    return [inputAssistPlugin, suggestionPlugin];
  },
});
