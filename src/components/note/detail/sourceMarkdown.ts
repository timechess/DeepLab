import type { EditorRange } from "./types";

export type SourceCommandInsertion = {
  text: string;
  cursorOffset?: number;
};

const SOURCE_COMMAND_INSERTIONS: Record<string, SourceCommandInsertion> = {
  h2: {
    text: "## ",
  },
  bullet: {
    text: "- ",
  },
  ordered: {
    text: "1. ",
  },
  quote: {
    text: "> ",
  },
  code: {
    text: "```text\n\n```",
    cursorOffset: "```text\n".length,
  },
  "inline-math": {
    text: "$x^2 + y^2 = z^2$ ",
  },
  "block-math": {
    text: "$$\nE = mc^2\n$$\n",
    cursorOffset: "$$\n".length,
  },
};

export function findSourceSlashTrigger(
  source: string,
  cursor: number,
): { query: string; range: EditorRange } | null {
  const safeCursor = Math.max(0, Math.min(cursor, source.length));
  const lineStart = source.lastIndexOf("\n", safeCursor - 1) + 1;
  const textBeforeCursor = source.slice(lineStart, safeCursor);
  const matched = textBeforeCursor.match(/\/([^\s/]*)$/);
  if (!matched) {
    return null;
  }
  const query = matched[1] ?? "";
  return {
    query,
    range: {
      from: safeCursor - (query.length + 1),
      to: safeCursor,
    },
  };
}

export function getSourceCommandInsertion(
  commandId: string,
): SourceCommandInsertion | null {
  return SOURCE_COMMAND_INSERTIONS[commandId] ?? null;
}

export function replaceSourceTextRange(
  source: string,
  range: EditorRange,
  replacement: string,
  cursorOffset = replacement.length,
): { value: string; selection: number } {
  const rawFrom = Math.max(0, Math.min(range.from, source.length));
  const rawTo = Math.max(0, Math.min(range.to, source.length));
  const from = Math.min(rawFrom, rawTo);
  const to = Math.max(rawFrom, rawTo);
  const value = `${source.slice(0, from)}${replacement}${source.slice(to)}`;
  const selection =
    from + Math.max(0, Math.min(cursorOffset, replacement.length));
  return { value, selection };
}
