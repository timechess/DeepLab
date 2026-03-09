"use client";

import { open, save } from "@tauri-apps/plugin-dialog";
import { readTextFile, writeTextFile } from "@tauri-apps/plugin-fs";
import type { Editor, JSONContent } from "@tiptap/core";
import { Extension } from "@tiptap/core";
import Placeholder from "@tiptap/extension-placeholder";
import { Markdown } from "@tiptap/markdown";
import { EditorContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  fallbackMarkdownFromJson,
  hasNoteReferenceNode,
  normalizeMarkdownDisplayMathBlocks,
} from "@/components/note/note-utils";
import { NoteReference } from "@/components/note/referenceExtensions";
import {
  getNoteDetail,
  getNoteHistory,
  getNoteLinkedContext,
  getNoteRevisionDetail,
  getNoteRevisions,
  type NoteLinkedContext,
  type NoteRefType,
  type NoteRevisionListItem,
  restoreNoteRevision,
  searchNotePapers,
  searchNoteWorkReports,
  updateNoteContent,
} from "@/lib/note";
import {
  getPaperReportDetail,
  type PaperReportDetail,
} from "@/lib/paperReport";
import { getTaskHistory } from "@/lib/tasks";
import { createSlashCommands } from "./commands";
import { DetailModal } from "./DetailModal";
import { InlineDisplayMathematics } from "./inlineDisplayMathematics";
import { LinkedSidebar } from "./LinkedSidebar";
import { MathInputAssist } from "./mathInputAssist";
import { RevisionHistoryPanel } from "./RevisionHistoryPanel";
import { SlashMenu } from "./SlashMenu";
import { TargetPicker } from "./TargetPicker";
import type {
  ModalState,
  PickerOption,
  SaveState,
  SlashCommandItem,
  SlashMenuState,
  TargetPickerState,
} from "./types";
import {
  emptySlashMenuState,
  emptyTargetPickerState,
  localPositionFromEditor,
  normalizeLegacyMathNodes,
  safeJsonParse,
  statusLabel,
} from "./utils";

const DEBOUNCE_MS = 60000;
const PICKER_DEBOUNCE_MS = 240;

const ListBehaviorShortcuts = Extension.create({
  name: "listBehaviorShortcuts",
  addKeyboardShortcuts() {
    return {
      Enter: () => {
        if (!this.editor.isActive("listItem")) {
          return false;
        }
        const commands = this.editor.commands as {
          splitListItem?: (typeOrName: string) => boolean;
        };
        return commands.splitListItem?.("listItem") ?? false;
      },
      Tab: () => {
        if (!this.editor.isActive("listItem")) {
          return false;
        }
        const commands = this.editor.commands as {
          sinkListItem?: (typeOrName: string) => boolean;
        };
        return commands.sinkListItem?.("listItem") ?? false;
      },
      "Shift-Tab": () => {
        if (!this.editor.isActive("listItem")) {
          return false;
        }
        const commands = this.editor.commands as {
          liftListItem?: (typeOrName: string) => boolean;
        };
        return commands.liftListItem?.("listItem") ?? false;
      },
    };
  },
});

interface NoteDetailEditorProps {
  noteId: number;
}

function computeSnapshotHash(title: string, content: string): string {
  let hash = BigInt("0xcbf29ce484222325");
  const prime = BigInt("0x100000001b3");
  const input = `${title}\n${content}`;
  const encoded = new TextEncoder().encode(input);
  for (const byte of encoded) {
    hash ^= BigInt(byte);
    hash = (hash * prime) & BigInt("0xffffffffffffffff");
  }
  return hash.toString(16).padStart(16, "0");
}

const NOTE_REFERENCE_TOKEN =
  /\[\[\s*(paper|task|note|work_report)\s*:\s*([^\]|]+?)\s*(?:\|\s*([^\]]*?)\s*)?\]\]/giu;

function emptyDoc(): JSONContent {
  return { type: "doc", content: [{ type: "paragraph" }] };
}

function isValidImportedRefId(refType: NoteRefType, refId: string): boolean {
  if (refType === "paper") {
    return refId.trim().length > 0;
  }
  if (refType === "task" || refType === "note") {
    return /^\d+$/.test(refId);
  }
  return /^\d{4}-\d{2}-\d{2}$/.test(refId);
}

function textNodeWithMarks(
  text: string,
  marks: unknown[] | undefined,
): JSONContent | null {
  if (!text) {
    return null;
  }
  const node: JSONContent = { type: "text", text };
  if (Array.isArray(marks) && marks.length > 0) {
    (node as { marks?: unknown[] }).marks = marks;
  }
  return node;
}

function splitTextNodeByReferenceToken(
  node: JSONContent,
  inLiteral: boolean,
): JSONContent[] {
  if (inLiteral || node.type !== "text") {
    return [node];
  }
  const sourceText = node.text ?? "";
  if (!sourceText.includes("[[")) {
    return [node];
  }
  const marks = (node as { marks?: unknown[] }).marks;
  const result: JSONContent[] = [];
  let cursor = 0;
  NOTE_REFERENCE_TOKEN.lastIndex = 0;
  for (const match of sourceText.matchAll(NOTE_REFERENCE_TOKEN)) {
    const start = match.index ?? 0;
    const end = start + match[0].length;
    const prefix = textNodeWithMarks(sourceText.slice(cursor, start), marks);
    if (prefix) {
      result.push(prefix);
    }

    const rawType = (match[1] ?? "").toLowerCase();
    const refType = rawType as NoteRefType;
    const refId = (match[2] ?? "").trim();
    const label = (match[3] ?? refId).trim() || refId;
    if (
      (refType === "paper" ||
        refType === "task" ||
        refType === "note" ||
        refType === "work_report") &&
      isValidImportedRefId(refType, refId)
    ) {
      result.push({
        type: "noteReference",
        attrs: {
          refType,
          refId,
          label,
        },
      });
    } else {
      const fallback = textNodeWithMarks(match[0], marks);
      if (fallback) {
        result.push(fallback);
      }
    }
    cursor = end;
  }
  const suffix = textNodeWithMarks(sourceText.slice(cursor), marks);
  if (suffix) {
    result.push(suffix);
  }
  return result.length === 0 ? [node] : result;
}

function transformMarkdownReferenceTokens(
  node: JSONContent | null | undefined,
  inLiteral = false,
): JSONContent[] {
  if (!node) {
    return [];
  }
  if (node.type === "text") {
    return splitTextNodeByReferenceToken(node, inLiteral);
  }

  const nextLiteral =
    inLiteral ||
    node.type === "codeBlock" ||
    node.type === "mathematics" ||
    node.type === "mathDisplay" ||
    node.type === "displayMath" ||
    node.type === "mathInline" ||
    node.type === "inlineMath";

  if (!Array.isArray(node.content)) {
    return [node];
  }
  const nextChildren: JSONContent[] = [];
  for (const child of node.content) {
    nextChildren.push(
      ...transformMarkdownReferenceTokens(child as JSONContent, nextLiteral),
    );
  }
  return [{ ...node, content: nextChildren }];
}

function ensureDocRoot(node: JSONContent): JSONContent {
  if (node.type === "doc") {
    return node;
  }
  return {
    type: "doc",
    content: [node],
  };
}

function parseMarkdownToEditorDoc(
  editor: Editor,
  markdown: string,
): JSONContent {
  const toFallbackDoc = (source: string): JSONContent => {
    const lines = source.replace(/\r\n?/g, "\n").split("\n");
    const nodes: JSONContent[] = [];
    let index = 0;

    const pushParagraph = (textLines: string[]) => {
      const text = textLines.join("\n").trim();
      if (!text) {
        return;
      }
      nodes.push({
        type: "paragraph",
        content: [{ type: "text", text }],
      });
    };

    while (index < lines.length) {
      const line = lines[index] ?? "";
      if (!line.trim()) {
        index += 1;
        continue;
      }

      const heading = line.match(/^(#{1,6})\s+(.+)$/);
      if (heading) {
        nodes.push({
          type: "heading",
          attrs: { level: heading[1].length },
          content: [{ type: "text", text: heading[2] ?? "" }],
        });
        index += 1;
        continue;
      }

      const bulletItems: string[] = [];
      while (index < lines.length) {
        const current = lines[index] ?? "";
        const matched = current.match(/^\s*[-*]\s+(.+)$/);
        if (!matched) {
          break;
        }
        bulletItems.push(matched[1] ?? "");
        index += 1;
      }
      if (bulletItems.length > 0) {
        nodes.push({
          type: "bulletList",
          content: bulletItems.map((item) => ({
            type: "listItem",
            content: [
              { type: "paragraph", content: [{ type: "text", text: item }] },
            ],
          })),
        });
        continue;
      }

      const orderedItems: string[] = [];
      while (index < lines.length) {
        const current = lines[index] ?? "";
        const matched = current.match(/^\s*\d+\.\s+(.+)$/);
        if (!matched) {
          break;
        }
        orderedItems.push(matched[1] ?? "");
        index += 1;
      }
      if (orderedItems.length > 0) {
        nodes.push({
          type: "orderedList",
          attrs: { start: 1 },
          content: orderedItems.map((item) => ({
            type: "listItem",
            content: [
              { type: "paragraph", content: [{ type: "text", text: item }] },
            ],
          })),
        });
        continue;
      }

      const paragraphLines: string[] = [];
      while (index < lines.length) {
        const current = lines[index] ?? "";
        if (!current.trim()) {
          break;
        }
        if (
          /^(#{1,6})\s+/.test(current) ||
          /^\s*[-*]\s+/.test(current) ||
          /^\s*\d+\.\s+/.test(current)
        ) {
          if (paragraphLines.length > 0) {
            break;
          }
        }
        paragraphLines.push(current);
        index += 1;
      }
      pushParagraph(paragraphLines);
    }

    return nodes.length > 0 ? { type: "doc", content: nodes } : emptyDoc();
  };

  const content = markdown.trim();
  if (!content) {
    return emptyDoc();
  }
  const parsed = editor.markdown?.parse(content);
  if (!parsed || typeof parsed !== "object") {
    const fallback = transformMarkdownReferenceTokens(
      toFallbackDoc(content),
    )[0];
    if (!fallback) {
      return emptyDoc();
    }
    const normalized = normalizeLegacyMathNodes(ensureDocRoot(fallback))[0];
    return normalized ?? emptyDoc();
  }
  const transformed = transformMarkdownReferenceTokens(
    parsed as JSONContent,
  )[0];
  if (!transformed) {
    return emptyDoc();
  }
  const normalized = normalizeLegacyMathNodes(ensureDocRoot(transformed))[0];
  return normalized ?? emptyDoc();
}

function deriveTitleFromPath(path: string): string | null {
  const normalized = path.replace(/\\/g, "/");
  const filename = normalized.split("/").pop() ?? "";
  const stem = filename.replace(/\.[^./\\]+$/, "").trim();
  return stem || null;
}

function noteContentJsonToMarkdown(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) {
    return "";
  }
  let parsed: unknown = trimmed;
  for (let depth = 0; depth < 3; depth += 1) {
    if (typeof parsed !== "string") {
      break;
    }
    const candidate = parsed.trim();
    if (!candidate) {
      return "";
    }
    try {
      parsed = JSON.parse(candidate);
    } catch {
      parsed = candidate;
      break;
    }
  }
  if (typeof parsed === "string") {
    return normalizeMarkdownDisplayMathBlocks(parsed);
  }
  if (parsed && typeof parsed === "object") {
    const asNode = parsed as {
      type?: unknown;
      content?: unknown;
      markdown?: unknown;
      text?: unknown;
    };
    if (typeof asNode.type !== "string" || asNode.type.trim().length === 0) {
      const fallbackText =
        typeof asNode.content === "string"
          ? asNode.content
          : typeof asNode.markdown === "string"
            ? asNode.markdown
            : typeof asNode.text === "string"
              ? asNode.text
              : JSON.stringify(parsed);
      return normalizeMarkdownDisplayMathBlocks(fallbackText || trimmed);
    }
    const markdown = fallbackMarkdownFromJson(parsed as JSONContent).trim();
    return normalizeMarkdownDisplayMathBlocks(markdown || trimmed);
  }
  return normalizeMarkdownDisplayMathBlocks(trimmed);
}

const INVISIBLE_TEXT_PATTERN = /\s|\u200B|\u200C|\u200D|\u2060|\uFEFF/g;

function hasMeaningfulText(value: string | null | undefined): boolean {
  if (typeof value !== "string") {
    return false;
  }
  return value.replace(INVISIBLE_TEXT_PATTERN, "").length > 0;
}

function docHasMeaningfulContent(value: unknown): boolean {
  if (!value || typeof value !== "object") {
    return false;
  }
  const node = value as {
    type?: string;
    text?: string;
    attrs?: Record<string, unknown>;
    content?: unknown[];
  };
  if (node.type === "text") {
    return hasMeaningfulText(node.text);
  }
  if (node.type === "noteReference") {
    return true;
  }
  if (node.type === "image") {
    const src = node.attrs?.src;
    return hasMeaningfulText(typeof src === "string" ? src : "");
  }
  if (node.attrs && typeof node.attrs === "object") {
    const attrs = node.attrs;
    for (const key of ["latex", "value", "text"]) {
      const raw = attrs[key];
      if (hasMeaningfulText(typeof raw === "string" ? raw : "")) {
        return true;
      }
    }
  }
  if (!Array.isArray(node.content)) {
    return false;
  }
  return node.content.some((child) => docHasMeaningfulContent(child));
}

function isEffectivelyEmptyDoc(content: string): boolean {
  try {
    const parsed = JSON.parse(content) as { type?: string };
    if (!parsed || parsed.type !== "doc") {
      return false;
    }
    return !docHasMeaningfulContent(parsed);
  } catch {
    return false;
  }
}

function jsonDeepEqual(left: unknown, right: unknown): boolean {
  if (left === right) {
    return true;
  }
  if (typeof left !== typeof right) {
    return false;
  }
  if (left === null || right === null) {
    return left === right;
  }
  if (Array.isArray(left)) {
    if (!Array.isArray(right) || left.length !== right.length) {
      return false;
    }
    for (let i = 0; i < left.length; i += 1) {
      if (!jsonDeepEqual(left[i], right[i])) {
        return false;
      }
    }
    return true;
  }
  if (typeof left !== "object") {
    return false;
  }
  const leftRecord = left as Record<string, unknown>;
  const rightRecord = right as Record<string, unknown>;
  const leftKeys = Object.keys(leftRecord);
  const rightKeys = Object.keys(rightRecord);
  if (leftKeys.length !== rightKeys.length) {
    return false;
  }
  for (const key of leftKeys) {
    if (!(key in rightRecord)) {
      return false;
    }
    if (!jsonDeepEqual(leftRecord[key], rightRecord[key])) {
      return false;
    }
  }
  return true;
}

function noteContentsSemanticallyEqual(left: string, right: string): boolean {
  if (left === right) {
    return true;
  }
  try {
    const parsedLeft = JSON.parse(left) as unknown;
    const parsedRight = JSON.parse(right) as unknown;
    return jsonDeepEqual(parsedLeft, parsedRight);
  } catch {
    return false;
  }
}

export function NoteDetailEditor({ noteId }: NoteDetailEditorProps) {
  const [title, setTitle] = useState("");
  const [saveState, setSaveState] = useState<SaveState>("saved");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [storedUpdatedAt, setStoredUpdatedAt] = useState<string | null>(null);
  const [showConflictDiff, setShowConflictDiff] = useState(false);
  const [conflictStoredVersion, setConflictStoredVersion] = useState<{
    title: string;
    content: string;
  } | null>(null);
  const [historyVisible, setHistoryVisible] = useState(false);

  const [context, setContext] = useState<NoteLinkedContext>({
    papers: [],
    tasks: [],
    notes: [],
    workReports: [],
  });
  const [revisions, setRevisions] = useState<NoteRevisionListItem[]>([]);
  const [revisionsLoading, setRevisionsLoading] = useState(false);
  const [revisionError, setRevisionError] = useState<string | null>(null);
  const [previewingRevisionId, setPreviewingRevisionId] = useState<
    number | null
  >(null);
  const [restoringRevisionId, setRestoringRevisionId] = useState<number | null>(
    null,
  );

  const [modal, setModal] = useState<ModalState>(null);
  const [paperDetail, setPaperDetail] = useState<PaperReportDetail | null>(
    null,
  );
  const [paperTab, setPaperTab] = useState<"rendered" | "source">("rendered");
  const [focusMode, setFocusMode] = useState(false);

  const [slashMenu, setSlashMenu] =
    useState<SlashMenuState>(emptySlashMenuState);
  const [targetPicker, setTargetPicker] = useState<TargetPickerState>(
    emptyTargetPickerState,
  );
  const [targetLoading, setTargetLoading] = useState(false);
  const [targetOptions, setTargetOptions] = useState<PickerOption[]>([]);

  const targetQueryInputRef = useRef<HTMLInputElement | null>(null);
  const editorSurfaceRef = useRef<HTMLDivElement | null>(null);
  const loadingSeqRef = useRef(0);
  const hydratingContentRef = useRef(false);
  const saveStateRef = useRef<SaveState>("saved");
  const titleRef = useRef("");
  const storedUpdatedAtRef = useRef<string | null>(null);
  const latestSnapshotHashRef = useRef<string>("");
  const savedSnapshotHashRef = useRef<string>("");
  const queuedSourceRef = useRef<
    "autosave" | "shortcut" | "visibility" | "restore" | "manual" | null
  >(null);
  const conflictLockRef = useRef(false);
  const saveSeqRef = useRef(0);
  const activeSaveSeqRef = useRef<number | null>(null);
  const focusModeRef = useRef(false);
  const centerLineRafRef = useRef<number | null>(null);

  const centerCurrentLine = useCallback((activeEditor: Editor) => {
    if (typeof window === "undefined") {
      return;
    }
    const from = activeEditor.state.selection.from;
    const coords = activeEditor.view.coordsAtPos(from);
    const absoluteLineTop = window.scrollY + coords.top;
    const targetScrollTop = Math.max(
      0,
      absoluteLineTop - window.innerHeight / 2 + 20,
    );
    if (Math.abs(window.scrollY - targetScrollTop) < 20) {
      return;
    }
    window.scrollTo({
      top: targetScrollTop,
      behavior: "auto",
    });
  }, []);

  const refreshContext = useCallback(async () => {
    if (!noteId) {
      return;
    }
    try {
      const linked = await getNoteLinkedContext(noteId);
      setContext(linked);
    } catch {
      // no-op: context panel should not block editing
    }
  }, [noteId]);

  const refreshRevisions = useCallback(
    async (force = false) => {
      if (!noteId || (!historyVisible && !force)) {
        return;
      }
      setRevisionsLoading(true);
      setRevisionError(null);
      try {
        const response = await getNoteRevisions(noteId, 1, 30);
        setRevisions(response.items);
      } catch (loadError) {
        setRevisionError(
          loadError instanceof Error ? loadError.message : String(loadError),
        );
      } finally {
        setRevisionsLoading(false);
      }
    },
    [historyVisible, noteId],
  );

  const toggleHistoryVisible = useCallback(() => {
    setHistoryVisible((current) => {
      const nextVisible = !current;
      if (nextVisible) {
        void refreshRevisions(true);
      }
      return nextVisible;
    });
  }, [refreshRevisions]);

  const closeHistoryPanel = useCallback(() => {
    setHistoryVisible(false);
  }, []);

  const slashCommands = useMemo(() => createSlashCommands(), []);

  const closeSlashMenu = useCallback(() => {
    setSlashMenu(emptySlashMenuState());
  }, []);

  const closeTargetPicker = useCallback(() => {
    setTargetPicker(emptyTargetPickerState());
    setTargetOptions([]);
    setTargetLoading(false);
  }, []);

  const openTargetPicker = useCallback(
    (
      targetType: TargetPickerState["targetType"],
      range: { from: number; to: number },
      position: { top: number; left: number },
    ) => {
      setTargetPicker({
        open: true,
        targetType,
        query: "",
        position,
        range,
        activeIndex: 0,
      });
      closeSlashMenu();
    },
    [closeSlashMenu],
  );

  const syncSlashTrigger = useCallback(
    (activeEditor: Editor) => {
      if (targetPicker.open) {
        return;
      }
      const { from } = activeEditor.state.selection;
      const $from = activeEditor.state.selection.$from;
      const blockStart = from - $from.parentOffset;
      const textBefore = activeEditor.state.doc.textBetween(
        blockStart,
        from,
        "\n",
        "\0",
      );
      const match = textBefore.match(/\/([^\s/]*)$/);
      if (!match) {
        setSlashMenu((prev) => (prev.open ? emptySlashMenuState() : prev));
        return;
      }

      const query = match[1] || "";
      const range = {
        from: from - (query.length + 1),
        to: from,
      };
      const position = localPositionFromEditor(
        activeEditor,
        from,
        editorSurfaceRef.current,
      );
      setSlashMenu({
        open: true,
        query,
        range,
        position,
        activeIndex: 0,
      });
    },
    [targetPicker.open],
  );

  const editor = useEditor({
    extensions: [
      StarterKit,
      Markdown,
      Placeholder.configure({
        placeholder:
          "输入 / 打开命令；使用链接命令插入结构化引用，按 Ctrl+S 保存。",
      }),
      InlineDisplayMathematics.configure({
        katexOptions: {
          throwOnError: false,
        },
      }),
      MathInputAssist,
      ListBehaviorShortcuts,
      NoteReference,
    ],
    editorProps: {
      attributes: {
        class:
          "note-editor min-h-[72vh] rounded-2xl border border-[#22314b] bg-[linear-gradient(160deg,#0f1724,#0c1525_45%,#0a1322)] p-5 text-[#dbe6ff] shadow-[0_20px_46px_rgba(0,0,0,0.35)] outline-none",
      },
    },
    onUpdate: ({ editor: activeEditor }) => {
      if (hydratingContentRef.current) {
        hydratingContentRef.current = false;
        return;
      }

      if (!loaded) {
        return;
      }

      const content = JSON.stringify(activeEditor.getJSON());
      const nextHash = computeSnapshotHash(
        titleRef.current.trim() || "未命名笔记",
        content,
      );
      latestSnapshotHashRef.current = nextHash;
      if (activeSaveSeqRef.current !== null) {
        queuedSourceRef.current = "autosave";
      } else {
        setSaveState("dirty");
      }
      syncSlashTrigger(activeEditor);
      if (focusModeRef.current) {
        if (centerLineRafRef.current != null) {
          window.cancelAnimationFrame(centerLineRafRef.current);
        }
        centerLineRafRef.current = window.requestAnimationFrame(() => {
          centerCurrentLine(activeEditor);
          centerLineRafRef.current = null;
        });
      }
    },
    onSelectionUpdate: ({ editor: activeEditor }) => {
      syncSlashTrigger(activeEditor);
      if (focusModeRef.current) {
        if (centerLineRafRef.current != null) {
          window.cancelAnimationFrame(centerLineRafRef.current);
        }
        centerLineRafRef.current = window.requestAnimationFrame(() => {
          centerCurrentLine(activeEditor);
          centerLineRafRef.current = null;
        });
      }
    },
    immediatelyRender: false,
  });

  const filteredSlashCommands = useMemo(() => {
    const keyword = slashMenu.query.trim().toLowerCase();
    if (!keyword) {
      return slashCommands;
    }
    return slashCommands.filter((command) => {
      if (command.label.toLowerCase().includes(keyword)) {
        return true;
      }
      return command.keywords.some((tag) =>
        tag.toLowerCase().includes(keyword),
      );
    });
  }, [slashCommands, slashMenu.query]);

  useEffect(() => {
    if (!slashMenu.open || filteredSlashCommands.length === 0) {
      return;
    }
    setSlashMenu((prev) =>
      prev.activeIndex < filteredSlashCommands.length
        ? prev
        : { ...prev, activeIndex: 0 },
    );
  }, [filteredSlashCommands.length, slashMenu.open]);

  const buildMarkdownFromEditor = useCallback(
    (activeEditor: Editor): string => {
      const json = activeEditor.getJSON();
      const shouldPreferFallback = hasNoteReferenceNode(json);
      const generated = shouldPreferFallback
        ? ""
        : (activeEditor.getMarkdown?.() ?? "");
      return normalizeMarkdownDisplayMathBlocks(
        generated.trim() ? generated : fallbackMarkdownFromJson(json),
      );
    },
    [],
  );

  const commitTargetOption = useCallback(
    (option: PickerOption) => {
      if (!targetPicker.range) {
        return;
      }
      if (!editor) {
        return;
      }
      editor
        .chain()
        .focus()
        .deleteRange(targetPicker.range)
        .insertContent({
          type: "noteReference",
          attrs: {
            refType: option.refType,
            refId: option.refId,
            label: option.label,
          },
        })
        .insertContent(" ")
        .run();
      setSaveState((current) => (current === "saving" ? current : "dirty"));
      closeTargetPicker();
    },
    [closeTargetPicker, editor, targetPicker.range],
  );

  const executeSlashCommand = useCallback(
    (command: SlashCommandItem) => {
      if (!slashMenu.range) {
        return;
      }
      if (command.targetType) {
        openTargetPicker(
          command.targetType,
          slashMenu.range,
          slashMenu.position,
        );
        return;
      }
      if (!editor) {
        return;
      }

      editor.chain().focus().deleteRange(slashMenu.range).run();
      command.run?.(editor);
      setSaveState((current) => (current === "saving" ? current : "dirty"));
      closeSlashMenu();
    },
    [
      closeSlashMenu,
      editor,
      openTargetPicker,
      slashMenu.position,
      slashMenu.range,
    ],
  );

  const buildCurrentSnapshot = useCallback(() => {
    if (!editor) {
      return null;
    }
    const json = editor.getJSON();
    const normalizedTitle = titleRef.current.trim() || "未命名笔记";
    const content = JSON.stringify(json);
    const snapshotHash = computeSnapshotHash(normalizedTitle, content);
    latestSnapshotHashRef.current = snapshotHash;
    return {
      json,
      title: normalizedTitle,
      content,
      snapshotHash,
    };
  }, [editor]);

  const applySnapshotToEditor = useCallback(
    (rawContent: string) => {
      if (!editor) {
        return {
          canonicalContent: rawContent,
          fallbackUsed: false,
          hydrateFailed: false,
        };
      }

      const parsed = safeJsonParse(rawContent) as JSONContent;
      const normalized = normalizeLegacyMathNodes(parsed)[0] ?? parsed;
      hydratingContentRef.current = true;
      editor.commands.setContent(normalized);

      let canonicalContent = JSON.stringify(editor.getJSON());
      let fallbackUsed = false;
      if (
        !isEffectivelyEmptyDoc(rawContent) &&
        isEffectivelyEmptyDoc(canonicalContent)
      ) {
        const fallbackMarkdown = noteContentJsonToMarkdown(rawContent).trim();
        if (fallbackMarkdown) {
          const fallbackDoc = parseMarkdownToEditorDoc(
            editor,
            fallbackMarkdown,
          );
          const fallbackContent = JSON.stringify(fallbackDoc);
          if (!isEffectivelyEmptyDoc(fallbackContent)) {
            hydratingContentRef.current = true;
            editor.commands.setContent(fallbackDoc);
            canonicalContent = JSON.stringify(editor.getJSON());
            fallbackUsed = true;
          }
        }
      }
      const hydrateFailed =
        !isEffectivelyEmptyDoc(rawContent) &&
        isEffectivelyEmptyDoc(canonicalContent);

      return {
        canonicalContent,
        fallbackUsed,
        hydrateFailed,
      };
    },
    [editor],
  );

  const saveNow = useCallback(
    async (
      source:
        | "autosave"
        | "shortcut"
        | "visibility"
        | "restore"
        | "manual" = "manual",
    ) => {
      if (!noteId || !loaded) {
        return;
      }
      if (conflictLockRef.current) {
        if (source === "manual" || source === "shortcut") {
          setNotice("检测到保存冲突，请先刷新页面或恢复历史版本后再保存。");
        }
        return;
      }
      const snapshot = buildCurrentSnapshot();
      if (!snapshot) {
        return;
      }
      if (
        savedSnapshotHashRef.current !== "" &&
        snapshot.snapshotHash === savedSnapshotHashRef.current
      ) {
        queuedSourceRef.current = null;
        setError(null);
        setSaveState("saved");
        if (source === "manual" || source === "shortcut") {
          setNotice("内容无变化，已跳过保存。");
        }
        return;
      }

      if (activeSaveSeqRef.current !== null) {
        queuedSourceRef.current = source;
        return;
      }

      const seq = saveSeqRef.current + 1;
      saveSeqRef.current = seq;
      activeSaveSeqRef.current = seq;
      setSaveState("saving");
      setError(null);
      setNotice(null);

      try {
        const response = await updateNoteContent(noteId, {
          title: snapshot.title,
          content: snapshot.content,
          expectedUpdatedAt: storedUpdatedAtRef.current,
          saveSource: source,
        });
        if (activeSaveSeqRef.current !== seq) {
          return;
        }

        setTitle(response.detail.title);
        titleRef.current = response.detail.title;
        setStoredUpdatedAt(response.detail.updatedAt);
        storedUpdatedAtRef.current = response.detail.updatedAt;
        savedSnapshotHashRef.current = response.savedHash;
        setConflictStoredVersion(null);
        setShowConflictDiff(false);
        conflictLockRef.current = false;

        const isLatestSnapshot =
          latestSnapshotHashRef.current === response.savedHash &&
          queuedSourceRef.current === null;
        if (isLatestSnapshot) {
          setSaveState("saved");
        } else {
          setSaveState("dirty");
        }
        if (response.skippedLinks.length > 0) {
          setNotice(
            `已保存，忽略 ${response.skippedLinks.length} 个失效引用（目标不存在）。`,
          );
        }

        void refreshContext();
        void refreshRevisions();
      } catch (saveError) {
        if (activeSaveSeqRef.current !== seq) {
          return;
        }
        const message =
          saveError instanceof Error ? saveError.message : String(saveError);
        if (message.includes("modified by another save")) {
          setSaveState("failed");
          setError("检测到保存冲突，请刷新页面或恢复历史版本后再保存。");
          setNotice("已暂停自动保存并锁定保存操作，等待你先处理冲突。");
          conflictLockRef.current = true;
          queuedSourceRef.current = null;
          void (async () => {
            try {
              const storedNote = await getNoteDetail(noteId);
              setStoredUpdatedAt(storedNote.updatedAt);
              storedUpdatedAtRef.current = storedNote.updatedAt;
              setConflictStoredVersion({
                title: storedNote.title,
                content: storedNote.content,
              });
            } catch {
              setConflictStoredVersion(null);
            }
          })();
        } else {
          setSaveState("failed");
          setError(message);
        }
      } finally {
        if (activeSaveSeqRef.current === seq) {
          activeSaveSeqRef.current = null;
          const queued = queuedSourceRef.current;
          if (queued !== null) {
            queuedSourceRef.current = null;
            void saveNow(queued);
          }
        }
      }
    },
    [buildCurrentSnapshot, loaded, noteId, refreshContext, refreshRevisions],
  );

  useEffect(() => {
    saveStateRef.current = saveState;
  }, [saveState]);

  useEffect(() => {
    titleRef.current = title;
  }, [title]);

  useEffect(() => {
    storedUpdatedAtRef.current = storedUpdatedAt;
  }, [storedUpdatedAt]);

  useEffect(() => {
    focusModeRef.current = focusMode;
  }, [focusMode]);

  useEffect(() => {
    return () => {
      if (centerLineRafRef.current != null) {
        window.cancelAnimationFrame(centerLineRafRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (!editor || !focusMode) {
      return;
    }
    centerCurrentLine(editor);
  }, [centerCurrentLine, editor, focusMode]);

  useEffect(() => {
    if (!editor || !noteId) {
      return;
    }
    const currentLoadSeq = loadingSeqRef.current + 1;
    loadingSeqRef.current = currentLoadSeq;
    setLoaded(false);
    setSaveState("saved");
    setError(null);
    setNotice(null);
    setStoredUpdatedAt(null);
    setTitle("");
    setConflictStoredVersion(null);
    setShowConflictDiff(false);
    setRevisions([]);
    setRevisionError(null);
    setPreviewingRevisionId(null);
    setSlashMenu(emptySlashMenuState());
    setTargetPicker(emptyTargetPickerState());
    setTargetOptions([]);
    setTargetLoading(false);
    activeSaveSeqRef.current = null;
    queuedSourceRef.current = null;
    conflictLockRef.current = false;
    latestSnapshotHashRef.current = "";
    savedSnapshotHashRef.current = "";
    void (async () => {
      try {
        const detail = await getNoteDetail(noteId);
        if (loadingSeqRef.current !== currentLoadSeq) {
          return;
        }
        const targetTitle = detail.title;
        const targetContent = detail.content;
        setTitle(targetTitle);
        titleRef.current = targetTitle;
        setStoredUpdatedAt(detail.updatedAt);
        storedUpdatedAtRef.current = detail.updatedAt;
        savedSnapshotHashRef.current = computeSnapshotHash(
          detail.title.trim() || "未命名笔记",
          detail.content,
        );
        const { canonicalContent, fallbackUsed, hydrateFailed } =
          applySnapshotToEditor(targetContent);
        const requiresCanonicalSave =
          fallbackUsed ||
          !noteContentsSemanticallyEqual(targetContent, canonicalContent);
        latestSnapshotHashRef.current = computeSnapshotHash(
          targetTitle.trim() || "未命名笔记",
          canonicalContent,
        );
        if (loadingSeqRef.current !== currentLoadSeq) {
          return;
        }
        setLoaded(true);
        if (hydrateFailed) {
          conflictLockRef.current = true;
          setSaveState("failed");
          setError("该快照结构无法在当前编辑器中恢复，请尝试其他历史版本。");
          setNotice(null);
        } else {
          setSaveState(requiresCanonicalSave ? "dirty" : "saved");
          setError(null);
          setNotice(
            requiresCanonicalSave
              ? "检测到旧版快照结构，已转换为当前可编辑格式，等待保存。"
              : null,
          );
        }
      } catch (loadError) {
        if (loadingSeqRef.current !== currentLoadSeq) {
          return;
        }
        setError(
          loadError instanceof Error ? loadError.message : String(loadError),
        );
      }
      if (loadingSeqRef.current === currentLoadSeq) {
        await refreshContext();
        await refreshRevisions();
      }
    })();
  }, [applySnapshotToEditor, editor, noteId, refreshContext, refreshRevisions]);

  useEffect(() => {
    const onVisibilityChange = () => {
      if (
        document.visibilityState === "hidden" &&
        saveStateRef.current === "dirty"
      ) {
        void saveNow("visibility");
      }
    };
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () =>
      document.removeEventListener("visibilitychange", onVisibilityChange);
  }, [saveNow]);

  useEffect(() => {
    const onPageHide = () => {
      if (saveStateRef.current === "saved") {
        return;
      }
      void saveNow("visibility");
    };
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      if (saveStateRef.current === "saved") {
        return;
      }
      void saveNow("visibility");
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("pagehide", onPageHide);
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => {
      window.removeEventListener("pagehide", onPageHide);
      window.removeEventListener("beforeunload", onBeforeUnload);
    };
  }, [saveNow]);

  useEffect(() => {
    if (saveState !== "dirty" || conflictLockRef.current) {
      return;
    }
    const timer = window.setTimeout(() => {
      void saveNow("autosave");
    }, DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [saveNow, saveState]);

  useEffect(() => {
    if (!targetPicker.open) {
      return;
    }
    const timer = window.setTimeout(() => {
      void (async () => {
        setTargetLoading(true);
        try {
          if (targetPicker.targetType === "paper") {
            const papers = await searchNotePapers(targetPicker.query);
            setTargetOptions(
              papers.map((paper) => ({
                refType: "paper",
                refId: paper.paperId,
                label: paper.title,
                description: paper.paperId,
                meta: paper.hasReport ? "有精读" : "仅论文",
              })),
            );
            return;
          }

          if (targetPicker.targetType === "task") {
            const tasks = await getTaskHistory(1);
            const keyword = targetPicker.query.trim().toLowerCase();
            const options = tasks.items
              .filter((task) => {
                if (!keyword) {
                  return true;
                }
                return (
                  task.title.toLowerCase().includes(keyword) ||
                  String(task.id).includes(keyword)
                );
              })
              .slice(0, 30)
              .map((task) => ({
                refType: "task" as NoteRefType,
                refId: String(task.id),
                label: task.title,
                description: `ID ${task.id}`,
                meta: task.completedDate ? "已完成" : "进行中",
              }));
            setTargetOptions(options);
            return;
          }

          if (targetPicker.targetType === "note") {
            const notes = await getNoteHistory(1, targetPicker.query);
            setTargetOptions(
              notes.items
                .filter((note) => note.id !== noteId)
                .map((note) => ({
                  refType: "note",
                  refId: String(note.id),
                  label: note.title,
                  description: `ID ${note.id}`,
                  meta: note.updatedAt,
                })),
            );
            return;
          }

          const reports = await searchNoteWorkReports(targetPicker.query);
          setTargetOptions(
            reports.map((report) => ({
              refType: "work_report",
              refId: report.reportDate,
              label: `工作日报 ${report.reportDate}`,
              description: `ID ${report.reportId}`,
              meta: `${report.startDate} -> ${report.reportDate}`,
            })),
          );
        } catch {
          setTargetOptions([]);
        } finally {
          setTargetLoading(false);
          setTargetPicker((prev) => ({ ...prev, activeIndex: 0 }));
        }
      })();
    }, PICKER_DEBOUNCE_MS);

    return () => window.clearTimeout(timer);
  }, [noteId, targetPicker.open, targetPicker.query, targetPicker.targetType]);

  useEffect(() => {
    if (!targetPicker.open) {
      return;
    }
    const timer = window.setTimeout(() => {
      targetQueryInputRef.current?.focus();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [targetPicker.open]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") {
        event.preventDefault();
        if (saveStateRef.current !== "saved") {
          void saveNow("shortcut");
        }
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [saveNow]);

  useEffect(() => {
    if (!editor) {
      return;
    }
    const dom = editor.view.dom;
    const onKeyDown = (event: KeyboardEvent) => {
      if (targetPicker.open) {
        if (event.key === "Escape") {
          event.preventDefault();
          closeTargetPicker();
        }
        return;
      }
      if (!slashMenu.open || filteredSlashCommands.length === 0) {
        if (
          slashMenu.open &&
          filteredSlashCommands.length === 0 &&
          event.key === "Escape"
        ) {
          event.preventDefault();
          closeSlashMenu();
        }
        return;
      }

      if (event.key === "ArrowDown") {
        event.preventDefault();
        setSlashMenu((prev) => ({
          ...prev,
          activeIndex: (prev.activeIndex + 1) % filteredSlashCommands.length,
        }));
        return;
      }

      if (event.key === "ArrowUp") {
        event.preventDefault();
        setSlashMenu((prev) => ({
          ...prev,
          activeIndex:
            (prev.activeIndex - 1 + filteredSlashCommands.length) %
            filteredSlashCommands.length,
        }));
        return;
      }

      if (event.key === "Enter") {
        event.preventDefault();
        const picked = filteredSlashCommands[slashMenu.activeIndex];
        if (picked) {
          executeSlashCommand(picked);
        }
        return;
      }

      if (event.key === "Escape") {
        event.preventDefault();
        closeSlashMenu();
      }
    };

    dom.addEventListener("keydown", onKeyDown, true);
    return () => dom.removeEventListener("keydown", onKeyDown, true);
  }, [
    closeSlashMenu,
    closeTargetPicker,
    editor,
    executeSlashCommand,
    filteredSlashCommands,
    slashMenu.activeIndex,
    slashMenu.open,
    targetPicker.open,
  ]);

  useEffect(() => {
    if (!modal || modal.type !== "paper") {
      setPaperDetail(null);
      return;
    }
    void (async () => {
      try {
        const detail = await getPaperReportDetail(modal.paperId);
        setPaperDetail(detail);
      } catch {
        setPaperDetail(null);
      }
    })();
  }, [modal]);

  const importMarkdown = useCallback(() => {
    void (async () => {
      setError(null);
      setNotice(null);
      if (!editor) {
        setError("编辑器尚未就绪，暂时无法导入。");
        return;
      }
      const selectedPath = await open({
        title: "导入 Markdown",
        multiple: false,
        filters: [{ name: "Markdown", extensions: ["md"] }],
      });
      const targetPath = Array.isArray(selectedPath)
        ? selectedPath[0]
        : selectedPath;
      if (!targetPath || typeof targetPath !== "string") {
        return;
      }
      try {
        const markdown = await readTextFile(targetPath);
        const normalizedMarkdown = normalizeMarkdownDisplayMathBlocks(markdown);
        const importedDoc = parseMarkdownToEditorDoc(
          editor,
          normalizedMarkdown,
        );
        const currentTitle = titleRef.current.trim();
        const suggestedTitle = deriveTitleFromPath(targetPath);
        const shouldReplaceTitle =
          !currentTitle || /^未命名笔记(?: \d+)?$/.test(currentTitle);
        const nextTitle = shouldReplaceTitle
          ? (suggestedTitle ?? titleRef.current)
          : titleRef.current;
        if (nextTitle !== titleRef.current) {
          setTitle(nextTitle);
          titleRef.current = nextTitle;
        }

        hydratingContentRef.current = true;
        editor.commands.setContent(importedDoc);
        const serialized = JSON.stringify(importedDoc);
        latestSnapshotHashRef.current = computeSnapshotHash(
          nextTitle.trim() || "未命名笔记",
          serialized,
        );
        if (activeSaveSeqRef.current !== null) {
          queuedSourceRef.current = "manual";
        }
        if (conflictLockRef.current) {
          setNotice("Markdown 已导入，但当前处于冲突锁定状态，请先处理冲突。");
          return;
        }
        setSaveState("dirty");
        setNotice("Markdown 已导入，等待保存。");
      } catch (importError) {
        setError(
          importError instanceof Error
            ? importError.message
            : String(importError),
        );
      }
    })();
  }, [editor]);

  const previewRevision = useCallback(
    async (revisionId: number) => {
      if (!noteId) {
        return;
      }
      setPreviewingRevisionId(revisionId);
      setError(null);
      setNotice(null);
      try {
        const detail = await getNoteRevisionDetail(noteId, revisionId);
        setModal({
          type: "revision",
          revisionId: detail.revisionId,
          source: detail.source,
          createdAt: detail.createdAt,
          markdown: noteContentJsonToMarkdown(detail.content),
        });
      } catch (previewError) {
        setError(
          previewError instanceof Error
            ? previewError.message
            : String(previewError),
        );
      } finally {
        setPreviewingRevisionId(null);
      }
    },
    [noteId],
  );

  const downloadMarkdown = useCallback(() => {
    void (async () => {
      setError(null);
      setNotice(null);
      if (!editor) {
        setError("编辑器尚未就绪，暂时无法导出。");
        return;
      }
      const defaultPath = `${title.trim() || "note"}.md`;
      const targetPath = await save({
        title: "导出 Markdown",
        defaultPath,
        filters: [{ name: "Markdown", extensions: ["md"] }],
      });
      if (!targetPath) {
        return;
      }
      try {
        const markdown = buildMarkdownFromEditor(editor);
        await writeTextFile(targetPath, markdown);
        setNotice(`已导出到：${targetPath}`);
      } catch (saveError) {
        setError(
          saveError instanceof Error ? saveError.message : String(saveError),
        );
      }
    })();
  }, [buildMarkdownFromEditor, editor, title]);

  const restoreRevision = useCallback(
    async (revisionId: number) => {
      if (!noteId || !editor) {
        return;
      }
      setRestoringRevisionId(revisionId);
      setError(null);
      setNotice(null);
      try {
        const response = await restoreNoteRevision(
          noteId,
          revisionId,
          storedUpdatedAtRef.current,
        );
        setTitle(response.detail.title);
        titleRef.current = response.detail.title;
        setStoredUpdatedAt(response.detail.updatedAt);
        storedUpdatedAtRef.current = response.detail.updatedAt;
        const { canonicalContent, fallbackUsed, hydrateFailed } =
          applySnapshotToEditor(response.detail.content);
        const requiresCanonicalSave =
          fallbackUsed ||
          !noteContentsSemanticallyEqual(
            response.detail.content,
            canonicalContent,
          );
        latestSnapshotHashRef.current = computeSnapshotHash(
          response.detail.title.trim() || "未命名笔记",
          canonicalContent,
        );
        savedSnapshotHashRef.current = response.savedHash;
        queuedSourceRef.current = null;
        activeSaveSeqRef.current = null;
        conflictLockRef.current = false;
        if (hydrateFailed) {
          conflictLockRef.current = true;
          setSaveState("failed");
          setError("该历史快照结构无法在当前编辑器中恢复，请尝试其他版本。");
          setNotice(null);
          return;
        }
        setSaveState(requiresCanonicalSave ? "dirty" : "saved");
        setConflictStoredVersion(null);
        setShowConflictDiff(false);
        if (response.skippedLinks.length > 0 && requiresCanonicalSave) {
          setNotice(
            `已恢复历史版本，忽略 ${response.skippedLinks.length} 个失效引用，并检测到旧快照结构，等待保存修复。`,
          );
        } else if (response.skippedLinks.length > 0) {
          setNotice(
            `已从历史版本恢复并保存，忽略 ${response.skippedLinks.length} 个失效引用。`,
          );
        } else if (requiresCanonicalSave) {
          setNotice("已恢复历史版本，检测到旧快照结构，等待保存修复。");
        } else {
          setNotice("已从历史版本恢复并保存。");
        }
        await refreshContext();
        await refreshRevisions();
      } catch (restoreError) {
        const message =
          restoreError instanceof Error
            ? restoreError.message
            : String(restoreError);
        setError(message);
      } finally {
        setRestoringRevisionId(null);
      }
    },
    [applySnapshotToEditor, editor, noteId, refreshContext, refreshRevisions],
  );

  const localDraftPreview = useMemo(() => {
    if (!editor) {
      return "";
    }
    try {
      return JSON.stringify(editor.getJSON(), null, 2);
    } catch {
      return "";
    }
  }, [editor]);

  if (!noteId || Number.isNaN(noteId)) {
    return (
      <main className="mx-auto min-h-screen w-full max-w-6xl px-6 py-10">
        <p className="text-sm text-[#ff9fba]">缺少有效 noteId。</p>
      </main>
    );
  }

  return (
    <>
      <div className="fixed inset-x-0 top-0 z-40 px-6 pt-4">
        <header className="mx-auto w-full max-w-[1360px] rounded-3xl border border-[#243651] bg-[linear-gradient(145deg,rgba(15,23,36,0.95),rgba(15,39,72,0.68))] px-5 py-4 shadow-[0_20px_46px_rgba(0,0,0,0.35)] backdrop-blur">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <Link
                href="/"
                className="cursor-pointer rounded-full border border-[#2d3a52] px-3 py-2 text-xs font-semibold text-[#c7d5ef] transition-colors duration-200 hover:border-[#4f7dff] hover:bg-[#142033]"
              >
                返回首页
              </Link>
              <Link
                href="/note"
                className="cursor-pointer rounded-full border border-[#2d3a52] px-3 py-2 text-xs font-semibold text-[#c7d5ef] transition-colors duration-200 hover:border-[#4f7dff] hover:bg-[#142033]"
              >
                返回笔记列表
              </Link>
              <p className="text-xs font-semibold tracking-wide text-[#8ba2c7]">
                保存状态：{statusLabel(saveState)}
              </p>
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={importMarkdown}
                className="cursor-pointer rounded-full border border-[#3a4f77] bg-[#142033] px-4 py-2 text-xs font-semibold text-[#dbe6ff] transition-colors duration-200 hover:border-[#4f7dff] hover:bg-[#1a2b47]"
              >
                导入 Markdown
              </button>
              <button
                type="button"
                onClick={downloadMarkdown}
                className="cursor-pointer rounded-full border border-[#3a4f77] bg-[#142033] px-4 py-2 text-xs font-semibold text-[#dbe6ff] transition-colors duration-200 hover:border-[#4f7dff] hover:bg-[#1a2b47]"
              >
                导出 Markdown
              </button>
              <button
                type="button"
                onClick={() => setFocusMode((value) => !value)}
                className={`rounded-full border px-4 py-2 text-xs font-semibold transition-colors duration-200 ${
                  focusMode
                    ? "border-[#4f7dff] bg-[#1a2b47] text-[#e5ecff]"
                    : "cursor-pointer border-[#3a4f77] bg-[#142033] text-[#dbe6ff] hover:border-[#4f7dff] hover:bg-[#1a2b47]"
                }`}
              >
                {focusMode ? "退出专注模式" : "专注模式"}
              </button>
              <button
                type="button"
                onClick={toggleHistoryVisible}
                className={`cursor-pointer rounded-full border px-4 py-2 text-xs font-semibold transition-colors duration-200 ${
                  historyVisible
                    ? "border-[#4f7dff] bg-[#1a2b47] text-[#e5ecff]"
                    : "border-[#3a4f77] bg-[#142033] text-[#dbe6ff] hover:border-[#4f7dff] hover:bg-[#1a2b47]"
                }`}
              >
                {historyVisible ? "收起历史版本" : "查看历史版本"}
              </button>
            </div>
          </div>
        </header>
      </div>

      <main className="mx-auto min-h-screen w-full max-w-[1360px] px-6 pb-6 pt-[122px]">
        <div className="mb-4 flex flex-wrap gap-2 text-xs text-[#8ba2c7]">
          <span className="rounded-full border border-[#2d3a52] bg-[#101a2c] px-3 py-1">
            输入 <strong>/paper</strong> 关联文献
          </span>
          <span className="rounded-full border border-[#2d3a52] bg-[#101a2c] px-3 py-1">
            输入 <strong>/task</strong> 关联任务
          </span>
          <span className="rounded-full border border-[#2d3a52] bg-[#101a2c] px-3 py-1">
            输入 <strong>/note</strong> 关联笔记
          </span>
          <span className="rounded-full border border-[#2d3a52] bg-[#101a2c] px-3 py-1">
            输入 <strong>/work_report</strong> 关联工作日报
          </span>
        </div>

        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_360px]">
          <section className="space-y-3">
            <input
              value={title}
              onChange={(event) => {
                const nextTitle = event.target.value;
                setTitle(nextTitle);
                titleRef.current = nextTitle;
                if (loaded) {
                  if (editor) {
                    const json = editor.getJSON();
                    const content = JSON.stringify(json);
                    latestSnapshotHashRef.current = computeSnapshotHash(
                      nextTitle.trim() || "未命名笔记",
                      content,
                    );
                  }
                  if (activeSaveSeqRef.current !== null) {
                    queuedSourceRef.current = "autosave";
                  } else {
                    setSaveState("dirty");
                  }
                }
              }}
              placeholder="笔记标题"
              className="w-full rounded-2xl border border-[#243651] bg-[#0f1724] px-4 py-3 text-xl font-semibold text-[#e5ecff] shadow-[0_10px_26px_rgba(0,0,0,0.25)] outline-none transition-colors focus:border-[#4f7dff]"
            />
            <div className="relative" ref={editorSurfaceRef}>
              <EditorContent editor={editor} />
              <SlashMenu
                state={slashMenu}
                items={filteredSlashCommands}
                onPick={executeSlashCommand}
              />
              <TargetPicker
                state={targetPicker}
                loading={targetLoading}
                options={targetOptions}
                inputRef={targetQueryInputRef}
                onQueryChange={(value) =>
                  setTargetPicker((prev) => ({ ...prev, query: value }))
                }
                onClose={closeTargetPicker}
                onChoose={commitTargetOption}
                onMoveNext={() =>
                  setTargetPicker((prev) => ({
                    ...prev,
                    activeIndex:
                      targetOptions.length === 0
                        ? 0
                        : (prev.activeIndex + 1) % targetOptions.length,
                  }))
                }
                onMovePrev={() =>
                  setTargetPicker((prev) => ({
                    ...prev,
                    activeIndex:
                      targetOptions.length === 0
                        ? 0
                        : (prev.activeIndex - 1 + targetOptions.length) %
                          targetOptions.length,
                  }))
                }
              />
            </div>
            {notice ? <p className="text-sm text-[#8ef3cf]">{notice}</p> : null}
            {error ? <p className="text-sm text-[#ff9fba]">{error}</p> : null}
            {conflictStoredVersion ? (
              <div className="rounded-2xl border border-[#5a2f3f] bg-[#23131a] p-3 text-xs text-[#ffd7e3]">
                <div className="flex items-center justify-between gap-3">
                  <p>
                    检测到保存冲突，可查看差异后选择刷新页面或恢复历史版本。
                  </p>
                  <button
                    type="button"
                    onClick={() => setShowConflictDiff((current) => !current)}
                    className="rounded-full border border-[#704153] px-3 py-1 font-semibold text-[#ffd7e3] hover:border-[#ff8fb0]"
                  >
                    {showConflictDiff ? "收起差异" : "查看差异"}
                  </button>
                </div>
                {showConflictDiff ? (
                  <div className="mt-3 grid gap-3 lg:grid-cols-2">
                    <div>
                      <p className="mb-1 text-[11px] text-[#ffb4c9]">
                        当前编辑内容
                      </p>
                      <pre className="max-h-56 overflow-auto rounded-xl border border-[#4a2d37] bg-[#160d12] p-2 text-[11px]">
                        {localDraftPreview}
                      </pre>
                    </div>
                    <div>
                      <p className="mb-1 text-[11px] text-[#ffb4c9]">
                        数据库版本
                      </p>
                      <pre className="max-h-56 overflow-auto rounded-xl border border-[#4a2d37] bg-[#160d12] p-2 text-[11px]">
                        {conflictStoredVersion.content}
                      </pre>
                    </div>
                  </div>
                ) : null}
              </div>
            ) : null}
          </section>

          <aside className="space-y-4">
            <RevisionHistoryPanel
              visible={historyVisible}
              loading={revisionsLoading}
              error={revisionError}
              revisions={revisions}
              previewingRevisionId={previewingRevisionId}
              restoringRevisionId={restoringRevisionId}
              onRefresh={() => void refreshRevisions(true)}
              onClose={closeHistoryPanel}
              onPreviewRevision={(revisionId) =>
                void previewRevision(revisionId)
              }
              onRestoreRevision={(revisionId) =>
                void restoreRevision(revisionId)
              }
            />

            <LinkedSidebar
              context={context}
              onOpenPaper={(paperId) => setModal({ type: "paper", paperId })}
              onOpenTask={(taskId) => {
                const task = context.tasks.find(
                  (item) => item.taskId === taskId,
                );
                if (task) {
                  setModal({ type: "task", task });
                }
              }}
            />
          </aside>
        </div>

        <DetailModal
          modal={modal}
          paperTab={paperTab}
          paperDetail={paperDetail}
          onClose={() => setModal(null)}
          onChangePaperTab={setPaperTab}
        />
      </main>
    </>
  );
}
