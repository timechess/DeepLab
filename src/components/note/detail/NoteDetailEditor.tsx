"use client";

import { save } from "@tauri-apps/plugin-dialog";
import { writeTextFile } from "@tauri-apps/plugin-fs";
import type { Editor, JSONContent } from "@tiptap/core";
import Placeholder from "@tiptap/extension-placeholder";
import { Markdown } from "@tiptap/markdown";
import { EditorContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  extractNoteLinks,
  fallbackMarkdownFromJson,
} from "@/components/note/note-utils";
import { NoteReference } from "@/components/note/referenceExtensions";
import {
  getNoteDetail,
  getNoteHistory,
  getNoteLinkedContext,
  type NoteLinkedContext,
  type NoteRefType,
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
  normalizeDisplayMathParagraphs,
  normalizeLegacyMathNodes,
  safeJsonParse,
  statusLabel,
} from "./utils";

const DEBOUNCE_MS = 1200;
const PICKER_DEBOUNCE_MS = 240;

interface NoteDetailEditorProps {
  noteId: number;
}

export function NoteDetailEditor({ noteId }: NoteDetailEditorProps) {
  const [title, setTitle] = useState("");
  const [saveState, setSaveState] = useState<SaveState>("saved");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);

  const [context, setContext] = useState<NoteLinkedContext>({
    papers: [],
    tasks: [],
    notes: [],
    workReports: [],
  });

  const [modal, setModal] = useState<ModalState>(null);
  const [paperDetail, setPaperDetail] = useState<PaperReportDetail | null>(
    null,
  );
  const [paperTab, setPaperTab] = useState<"rendered" | "source">("rendered");

  const [slashMenu, setSlashMenu] =
    useState<SlashMenuState>(emptySlashMenuState);
  const [targetPicker, setTargetPicker] = useState<TargetPickerState>(
    emptyTargetPickerState,
  );
  const [targetLoading, setTargetLoading] = useState(false);
  const [targetOptions, setTargetOptions] = useState<PickerOption[]>([]);

  const targetQueryInputRef = useRef<HTMLInputElement | null>(null);
  const editorSurfaceRef = useRef<HTMLDivElement | null>(null);
  const normalizingMathRef = useRef(false);

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
      NoteReference,
    ],
    editorProps: {
      attributes: {
        class:
          "note-editor min-h-[72vh] rounded-2xl border border-[#22314b] bg-[linear-gradient(160deg,#0f1724,#0c1525_45%,#0a1322)] p-5 text-[#dbe6ff] shadow-[0_20px_46px_rgba(0,0,0,0.35)] outline-none",
      },
    },
    onUpdate: ({ editor: activeEditor }) => {
      if (!normalizingMathRef.current) {
        const normalized = normalizeDisplayMathParagraphs(activeEditor);
        if (normalized) {
          normalizingMathRef.current = true;
          return;
        }
      } else {
        normalizingMathRef.current = false;
      }

      if (!loaded) {
        return;
      }

      setSaveState((current) => (current === "saving" ? current : "dirty"));
      syncSlashTrigger(activeEditor);
    },
    onSelectionUpdate: ({ editor: activeEditor }) => {
      syncSlashTrigger(activeEditor);
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

  const commitTargetOption = useCallback(
    (option: PickerOption) => {
      if (!editor || !targetPicker.range) {
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
      setSaveState("dirty");
      closeTargetPicker();
    },
    [closeTargetPicker, editor, targetPicker.range],
  );

  const executeSlashCommand = useCallback(
    (command: SlashCommandItem) => {
      if (!editor || !slashMenu.range) {
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

  const saveNow = useCallback(async () => {
    if (!editor || !noteId || !loaded) {
      return;
    }
    setSaveState("saving");
    setError(null);
    setNotice(null);
    const json = editor.getJSON();
    try {
      const response = await updateNoteContent(noteId, {
        title: title.trim() || "未命名笔记",
        content: JSON.stringify(json),
        links: extractNoteLinks(json),
      });
      setTitle(response.title);
      setSaveState("saved");
      await refreshContext();
    } catch (saveError) {
      setSaveState("failed");
      setError(
        saveError instanceof Error ? saveError.message : String(saveError),
      );
    }
  }, [editor, loaded, noteId, refreshContext, title]);

  useEffect(() => {
    if (!editor || !noteId) {
      return;
    }
    void (async () => {
      try {
        const detail = await getNoteDetail(noteId);
        setTitle(detail.title);
        const parsed = safeJsonParse(detail.content) as JSONContent;
        const normalized = normalizeLegacyMathNodes(parsed)[0] ?? parsed;
        editor.commands.setContent(normalized);
        setLoaded(true);
        setSaveState("saved");
        setError(null);
      } catch (loadError) {
        setError(
          loadError instanceof Error ? loadError.message : String(loadError),
        );
      }
      await refreshContext();
    })();
  }, [editor, noteId, refreshContext]);

  useEffect(() => {
    if (saveState !== "dirty") {
      return;
    }
    const timer = window.setTimeout(() => {
      void saveNow();
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
        void saveNow();
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

  const markdown = useMemo(() => {
    if (!editor) {
      return "";
    }
    const generated = editor.getMarkdown?.() ?? "";
    if (generated.trim()) {
      return generated;
    }
    return fallbackMarkdownFromJson(editor.getJSON());
  }, [editor]);

  const downloadMarkdown = useCallback(() => {
    void (async () => {
      setError(null);
      setNotice(null);
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
        await writeTextFile(targetPath, markdown);
        setNotice(`已导出到：${targetPath}`);
      } catch (saveError) {
        setError(
          saveError instanceof Error ? saveError.message : String(saveError),
        );
      }
    })();
  }, [markdown, title]);

  if (!noteId || Number.isNaN(noteId)) {
    return (
      <main className="mx-auto min-h-screen w-full max-w-6xl px-6 py-10">
        <p className="text-sm text-[#ff9fba]">缺少有效 noteId。</p>
      </main>
    );
  }

  return (
    <main className="mx-auto min-h-screen w-full max-w-[1360px] px-6 py-6">
      <header className="mb-4 rounded-3xl border border-[#243651] bg-[linear-gradient(145deg,rgba(15,23,36,0.95),rgba(15,39,72,0.68))] px-5 py-4 shadow-[0_20px_46px_rgba(0,0,0,0.35)]">
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

          <button
            type="button"
            onClick={downloadMarkdown}
            className="cursor-pointer rounded-full border border-[#3a4f77] bg-[#142033] px-4 py-2 text-xs font-semibold text-[#dbe6ff] transition-colors duration-200 hover:border-[#4f7dff] hover:bg-[#1a2b47]"
          >
            导出 Markdown
          </button>
        </div>
      </header>

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
              setTitle(event.target.value);
              setSaveState("dirty");
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
        </section>

        <LinkedSidebar
          context={context}
          onOpenPaper={(paperId) => setModal({ type: "paper", paperId })}
          onOpenTask={(taskId) => {
            const task = context.tasks.find((item) => item.taskId === taskId);
            if (task) {
              setModal({ type: "task", task });
            }
          }}
        />
      </div>

      <DetailModal
        modal={modal}
        paperTab={paperTab}
        paperDetail={paperDetail}
        onClose={() => setModal(null)}
        onChangePaperTab={setPaperTab}
      />
    </main>
  );
}
