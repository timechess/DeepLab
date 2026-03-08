import type { JSONContent } from "@tiptap/core";
import type { NoteLinkRefInput } from "@/lib/note";

interface RefToken {
  refType: "paper" | "task" | "note" | "work_report";
  refId: string;
  label: string;
}

const SINGLE_LINE_DISPLAY_MATH_REGEX = /^\s*\$\$([\s\S]+?)\$\$\s*$/;
const INLINE_DISPLAY_MATH_REGEX = /(?<!\$)\$\$([\s\S]+?)\$\$(?!\$)/g;

function walkForNodeType(
  node: JSONContent | null | undefined,
  targetType: string,
): boolean {
  if (!node) {
    return false;
  }
  if (node.type === targetType) {
    return true;
  }
  if (!Array.isArray(node.content)) {
    return false;
  }
  for (const child of node.content) {
    if (walkForNodeType(child as JSONContent, targetType)) {
      return true;
    }
  }
  return false;
}

function walk(node: JSONContent | null | undefined, refs: RefToken[]): void {
  if (!node) {
    return;
  }
  if (node.type === "noteReference") {
    const attrs = node.attrs as
      | { refType?: string; refId?: string; label?: string }
      | undefined;
    if (
      attrs?.refType &&
      (attrs.refType === "paper" ||
        attrs.refType === "task" ||
        attrs.refType === "note" ||
        attrs.refType === "work_report") &&
      attrs.refId
    ) {
      refs.push({
        refType: attrs.refType,
        refId: String(attrs.refId),
        label: attrs.label ?? String(attrs.refId),
      });
    }
  }
  if (Array.isArray(node.content)) {
    for (const child of node.content) {
      walk(child as JSONContent, refs);
    }
  }
}

export function extractNoteLinks(doc: JSONContent): NoteLinkRefInput[] {
  const refs: RefToken[] = [];
  walk(doc, refs);
  const dedup = new Map<string, NoteLinkRefInput>();
  for (const ref of refs) {
    const key = `${ref.refType}:${ref.refId}`;
    if (!dedup.has(key)) {
      dedup.set(key, {
        refType: ref.refType,
        refId: ref.refId,
        label: ref.label,
      });
    }
  }
  return [...dedup.values()];
}

export function hasNoteReferenceNode(doc: JSONContent): boolean {
  return walkForNodeType(doc, "noteReference");
}

function inlineText(node: JSONContent | null | undefined): string {
  if (!node) {
    return "";
  }
  if (node.type === "text") {
    return node.text ?? "";
  }
  if (
    node.type === "mathInline" ||
    node.type === "inlineMath" ||
    node.type === "inlineMathematics" ||
    node.type === "inlineDisplayMathematics"
  ) {
    const attrs = node.attrs as
      | { latex?: string; text?: string; value?: string }
      | undefined;
    const latex = (
      attrs?.latex ??
      attrs?.value ??
      attrs?.text ??
      node.text ??
      ""
    ).trim();
    return latex ? `$${latex}$` : "";
  }
  if (
    node.type === "mathDisplay" ||
    node.type === "displayMath" ||
    node.type === "mathematics" ||
    node.type === "displayMathematics" ||
    node.type === "blockMath"
  ) {
    const attrs = node.attrs as
      | { latex?: string; text?: string; value?: string }
      | undefined;
    const latex = (
      attrs?.latex ??
      attrs?.value ??
      attrs?.text ??
      node.text ??
      ""
    ).trim();
    return latex ? `$$${latex}$$` : "";
  }
  if (node.type === "noteReference") {
    const attrs = node.attrs as
      | { refType?: string; refId?: string; label?: string }
      | undefined;
    const label = attrs?.label ?? attrs?.refId ?? "ref";
    const refType = attrs?.refType ?? "ref";
    const refId = attrs?.refId ?? "";
    return `[[${refType}:${refId}|${label}]]`;
  }
  const children = node.content ?? [];
  return children.map((child) => inlineText(child)).join("");
}

function formatDisplayMathBlock(latex: string): string {
  return `$$\n${latex.trim()}\n$$`;
}

function normalizeStandaloneDisplayMath(text: string): string {
  const matched = text.match(SINGLE_LINE_DISPLAY_MATH_REGEX);
  if (!matched) {
    return text;
  }
  const latex = (matched[1] ?? "").trim();
  if (!latex) {
    return text;
  }
  return formatDisplayMathBlock(latex);
}

function lines(node: JSONContent | null | undefined, out: string[]): void {
  if (!node) {
    return;
  }
  if (node.type === "doc") {
    for (const child of node.content ?? []) {
      lines(child as JSONContent, out);
    }
    return;
  }
  if (node.type === "paragraph") {
    out.push(normalizeStandaloneDisplayMath(inlineText(node)));
    return;
  }
  if (node.type === "heading") {
    const level = Number(
      (node.attrs as { level?: number } | undefined)?.level ?? 1,
    );
    out.push(
      `${"#".repeat(Math.max(1, Math.min(level, 6)))} ${inlineText(node)}`,
    );
    return;
  }
  if (node.type === "bulletList") {
    for (const item of node.content ?? []) {
      const first = item.content?.[0];
      out.push(`- ${inlineText(first)}`);
    }
    return;
  }
  if (node.type === "orderedList") {
    let i = 1;
    for (const item of node.content ?? []) {
      const first = item.content?.[0];
      out.push(`${i}. ${inlineText(first)}`);
      i += 1;
    }
    return;
  }
  if (node.type === "codeBlock") {
    out.push(`\`\`\`\n${inlineText(node)}\n\`\`\``);
    return;
  }
  if (node.type === "mathematics") {
    out.push(normalizeStandaloneDisplayMath(inlineText(node)));
    return;
  }
  if (
    node.type === "mathDisplay" ||
    node.type === "displayMath" ||
    node.type === "displayMathematics" ||
    node.type === "blockMath"
  ) {
    const text = inlineText(node);
    const latex = text.replace(/^\$\$([\s\S]+)\$\$$/, "$1").trim();
    if (latex) {
      out.push(formatDisplayMathBlock(latex));
    }
    return;
  }
  const text = inlineText(node);
  if (text.trim()) {
    out.push(text);
  }
}

export function normalizeMarkdownDisplayMathBlocks(markdown: string): string {
  if (!markdown) {
    return markdown;
  }
  const normalizeLineWithDisplayMath = (line: string): string[] => {
    const standalone = normalizeStandaloneDisplayMath(line);
    if (standalone !== line) {
      return standalone.split("\n");
    }

    if (!line.includes("$$")) {
      return [line];
    }

    const parts: Array<{ type: "text" | "math"; value: string }> = [];
    let cursor = 0;
    INLINE_DISPLAY_MATH_REGEX.lastIndex = 0;
    let matched = INLINE_DISPLAY_MATH_REGEX.exec(line);
    while (matched) {
      const start = matched.index;
      const end = start + matched[0].length;
      const prefix = line.slice(cursor, start);
      if (prefix.trim()) {
        parts.push({ type: "text", value: prefix.trim() });
      }
      const latex = (matched[1] ?? "").trim();
      if (latex) {
        parts.push({ type: "math", value: latex });
      }
      cursor = end;
      matched = INLINE_DISPLAY_MATH_REGEX.exec(line);
    }
    INLINE_DISPLAY_MATH_REGEX.lastIndex = 0;

    if (parts.length === 0) {
      return [line];
    }

    const suffix = line.slice(cursor);
    if (suffix.trim()) {
      parts.push({ type: "text", value: suffix.trim() });
    }

    const output: string[] = [];
    for (const part of parts) {
      if (part.type === "text") {
        if (output.length > 0 && output[output.length - 1] !== "") {
          output.push("");
        }
        output.push(part.value);
        continue;
      }
      if (output.length > 0 && output[output.length - 1] !== "") {
        output.push("");
      }
      output.push("$$");
      output.push(part.value);
      output.push("$$");
    }

    return output;
  };

  const lines = markdown.split("\n");
  const output: string[] = [];
  let activeFence: { marker: "`" | "~"; size: number } | null = null;

  for (const line of lines) {
    const fence = line.match(/^\s*(`{3,}|~{3,})/);
    if (fence) {
      const marker = fence[1][0] as "`" | "~";
      const size = fence[1].length;
      if (!activeFence) {
        activeFence = { marker, size };
      } else if (activeFence.marker === marker && size >= activeFence.size) {
        activeFence = null;
      }
      output.push(line);
      continue;
    }
    if (activeFence) {
      output.push(line);
      continue;
    }
    output.push(...normalizeLineWithDisplayMath(line));
  }

  return output.join("\n");
}

export function fallbackMarkdownFromJson(doc: JSONContent): string {
  const out: string[] = [];
  lines(doc, out);
  return normalizeMarkdownDisplayMathBlocks(out.join("\n\n").trim());
}
