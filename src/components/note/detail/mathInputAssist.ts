import type { Editor } from "@tiptap/core";
import { Extension } from "@tiptap/core";
import {
  type EditorState,
  Plugin,
  PluginKey,
  TextSelection,
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

const INPUT_ASSIST_PLUGIN_KEY = new PluginKey("mathInputAssist");
const MATH_COMMAND_PLUGIN_KEY = new PluginKey("mathCommandSuggestion");

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

function findDisplayFenceBlockMatch(
  state: EditorState,
): DisplayFenceBlockMatch | null {
  if (!isSelectionOnDisplayFenceParagraph(state)) {
    return null;
  }

  const paragraphs: Array<{ pos: number; text: string; nodeSize: number }> = [];
  state.doc.descendants((node, pos) => {
    if (node.type.name !== "paragraph") {
      return;
    }
    paragraphs.push({
      pos,
      text: node.textContent.trim(),
      nodeSize: node.nodeSize,
    });
  });

  const fencePos = state.selection.$from.before();
  for (let index = 0; index < paragraphs.length; index += 1) {
    const opening = paragraphs[index];
    if (!opening || opening.text !== "$$") {
      continue;
    }

    let closingIndex = -1;
    for (let probe = index + 1; probe < paragraphs.length; probe += 1) {
      const candidate = paragraphs[probe];
      if (candidate?.text === "$$") {
        closingIndex = probe;
        break;
      }
    }
    if (closingIndex === -1) {
      continue;
    }

    const closing = paragraphs[closingIndex];
    if (!closing) {
      index = closingIndex;
      continue;
    }
    if (opening.pos !== fencePos && closing.pos !== fencePos) {
      index = closingIndex;
      continue;
    }

    for (
      let contentIndex = closingIndex - 1;
      contentIndex > index;
      contentIndex -= 1
    ) {
      const content = paragraphs[contentIndex];
      if (!content || content.text === "$$") {
        continue;
      }
      return {
        blockFrom: opening.pos,
        blockTo: closing.pos + closing.nodeSize,
        contentCursor: content.pos + content.nodeSize - 1,
      };
    }
    return {
      blockFrom: opening.pos,
      blockTo: closing.pos + closing.nodeSize,
      contentCursor: null,
    };
  }

  return null;
}

function findNearestDisplayContentCursor(state: EditorState): number | null {
  const paragraphs: Array<{ pos: number; text: string; nodeSize: number }> = [];
  state.doc.descendants((node, pos) => {
    if (node.type.name !== "paragraph") {
      return;
    }
    paragraphs.push({
      pos,
      text: node.textContent.trim(),
      nodeSize: node.nodeSize,
    });
  });

  const selectionFrom = state.selection.from;
  let bestMatch: { cursor: number; distance: number } | null = null;
  for (let index = 0; index <= paragraphs.length - 3; index += 1) {
    const opening = paragraphs[index];
    const middle = paragraphs[index + 1];
    const closing = paragraphs[index + 2];
    if (!opening || !middle || !closing) {
      continue;
    }
    if (
      opening.text !== "$$" ||
      closing.text !== "$$" ||
      middle.text === "$$"
    ) {
      continue;
    }

    const cursor = middle.pos + 1;
    const blockStart = opening.pos;
    const blockEnd = closing.pos + closing.nodeSize;
    const distance =
      selectionFrom < blockStart
        ? blockStart - selectionFrom
        : selectionFrom > blockEnd
          ? selectionFrom - blockEnd
          : 0;
    if (!bestMatch || distance < bestMatch.distance) {
      bestMatch = { cursor, distance };
    }
  }
  return bestMatch?.cursor ?? null;
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
) {
  const tr = editor.state.tr.insertText(text, from, to);
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
                });
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

            applyTextAndCursor(this.editor, from, from, "$$", 1);
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
        const hasDocChange = transactions.some((tr) => tr.docChanged);
        const hasDocChangeOrSelectionSet = transactions.some(
          (tr) => tr.docChanged || tr.selectionSet,
        );
        if (
          !hasDocChangeOrSelectionSet ||
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

        const cursor = findNearestDisplayContentCursor(newState);
        if (cursor == null || newState.selection.from === cursor) {
          return null;
        }

        return newState.tr.setSelection(
          TextSelection.create(newState.doc, cursor),
        );
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
          const tr = editor.state.tr.insertText(
            insertText,
            range.from,
            range.to,
          );
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
          ) => {
            if (!popup) {
              return;
            }
            const rect = clientRect?.();
            if (!rect) {
              return;
            }
            popup.style.left = `${rect.left}px`;
            popup.style.top = `${rect.bottom + 8}px`;
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
              popup = document.createElement("div");
              popup.className = "note-math-command-menu";
              popup.addEventListener("mousedown", onMouseDown);
              document.body.appendChild(popup);
              updatePosition(props.clientRect);
              renderList();
            },
            onUpdate: (props) => {
              items = props.items;
              command = props.command;
              if (selectedIndex >= items.length) {
                selectedIndex = Math.max(0, items.length - 1);
              }
              updatePosition(props.clientRect);
              renderList();
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
              if (popup) {
                popup.removeEventListener("mousedown", onMouseDown);
                popup.remove();
              }
              popup = null;
              items = [];
              command = null;
            },
          };
        },
      },
    );

    return [inputAssistPlugin, suggestionPlugin];
  },
});
