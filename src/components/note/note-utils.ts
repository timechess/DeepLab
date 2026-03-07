import type { JSONContent } from "@tiptap/core";
import type { NoteLinkRefInput } from "@/lib/note";

interface RefToken {
  refType: "paper" | "task" | "note" | "work_report";
  refId: string;
  label: string;
}

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
  if (node.type === "noteReference") {
    const attrs = node.attrs as
      | { refType?: string; refId?: string; label?: string }
      | undefined;
    const label = attrs?.label ?? attrs?.refId ?? "ref";
    const refType = attrs?.refType ?? "ref";
    const refId = attrs?.refId ?? "";
    return `[[${refType}:${refId} | ${label}]]`;
  }
  const children = node.content ?? [];
  return children.map((child) => inlineText(child)).join("");
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
    out.push(inlineText(node));
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
    out.push(`$$\n${inlineText(node)}\n$$`);
    return;
  }
  const text = inlineText(node);
  if (text.trim()) {
    out.push(text);
  }
}

export function fallbackMarkdownFromJson(doc: JSONContent): string {
  const out: string[] = [];
  lines(doc, out);
  return out.join("\n\n").trim();
}
