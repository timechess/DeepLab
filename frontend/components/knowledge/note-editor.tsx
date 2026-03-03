'use client';

import CodeBlockLowlight from '@tiptap/extension-code-block-lowlight';
import Link from '@tiptap/extension-link';
import Mathematics from '@tiptap/extension-mathematics';
import Mention from '@tiptap/extension-mention';
import Placeholder from '@tiptap/extension-placeholder';
import StarterKit from '@tiptap/starter-kit';
import { type Editor, EditorContent, useEditor } from '@tiptap/react';
import { common, createLowlight } from 'lowlight';
import NextLink from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import type {
  KnowledgeLinkTarget,
  KnowledgeNoteDetail,
  KnowledgeNoteLink,
  KnowledgeNoteSummary,
} from '@/lib/api/schemas';
import { formatDateTime } from '@/lib/time';

type SaveState = 'idle' | 'saving' | 'saved' | 'error';
type LinkTargetType = 'paper' | 'question' | 'note';

type EditorPosition = {
  top: number;
  left: number;
};

type EditorRange = {
  from: number;
  to: number;
};

type SlashMenuState = {
  open: boolean;
  query: string;
  position: EditorPosition;
  range: EditorRange | null;
  activeIndex: number;
};

type TargetPickerState = {
  open: boolean;
  targetType: LinkTargetType;
  query: string;
  position: EditorPosition;
  range: EditorRange | null;
  activeIndex: number;
};

type SlashCommand = {
  id: string;
  label: string;
  hint: string;
  keywords: string[];
  targetType?: LinkTargetType;
  run?: (editor: Editor) => void;
};

type NoteTextStats = {
  characters: number;
};

const SAVE_DEBOUNCE_MS = 2300;
const UNTITLED_NOTE_BASE = '未命名笔记';
const KnowledgeMention = Mention.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      targetType: {
        default: null,
      },
      targetId: {
        default: null,
      },
      targetLabel: {
        default: null,
      },
    };
  },
});

function defaultDoc(): Record<string, unknown> {
  return {
    type: 'doc',
    content: [{ type: 'paragraph' }],
  };
}

function toSafeDoc(input: unknown): Record<string, unknown> {
  if (input && typeof input === 'object' && !Array.isArray(input)) {
    return input as Record<string, unknown>;
  }
  return defaultDoc();
}

function toArxivUrl(paperId: string): string {
  return `https://arxiv.org/abs/${paperId}`;
}

function targetHref(targetType: string, targetId: string): string {
  if (targetType === 'paper') {
    return toArxivUrl(targetId);
  }
  if (targetType === 'question') {
    return `/knowledge/${targetId}`;
  }
  return `/knowledge/notes/${targetId}/edit`;
}

function saveBadgeText(state: SaveState, updatedAt?: string): string {
  if (state === 'saving') {
    return '保存中…';
  }
  if (state === 'saved') {
    return updatedAt ? `已保存 · ${formatDateTime(updatedAt)}` : '已保存';
  }
  if (state === 'error') {
    return '保存失败';
  }
  return '未保存';
}

async function apiBackendFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`/api/backend/${path}`, {
    ...init,
    headers: {
      ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
      ...(init?.headers || {}),
    },
    cache: 'no-store',
  });

  const isJson = response.headers.get('content-type')?.includes('application/json') ?? false;
  const payload = isJson ? await response.json().catch(() => null) : null;
  if (!response.ok) {
    const detail =
      payload && typeof payload === 'object' && typeof (payload as { detail?: unknown }).detail === 'string'
        ? (payload as { detail: string }).detail
        : `${response.status} ${response.statusText}`;
    throw new Error(detail);
  }
  return payload as T;
}

function emptySlashMenuState(): SlashMenuState {
  return {
    open: false,
    query: '',
    position: { top: 0, left: 0 },
    range: null,
    activeIndex: 0,
  };
}

function emptyTargetPickerState(): TargetPickerState {
  return {
    open: false,
    targetType: 'paper',
    query: '',
    position: { top: 0, left: 0 },
    range: null,
    activeIndex: 0,
  };
}

function normalizeLinkLabel(link: KnowledgeNoteLink): string {
  return (link.targetLabel || '').trim() || link.targetId;
}

function localPositionFromEditor(
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

function sectionTitle(targetType: LinkTargetType): string {
  if (targetType === 'paper') {
    return '文献链接';
  }
  if (targetType === 'question') {
    return '问题链接';
  }
  return '笔记链接';
}

function textStatsFromContent(rawText: string): NoteTextStats {
  const trimmed = rawText.trim();
  if (!trimmed) {
    return { characters: 0 };
  }
  const characters = trimmed.replace(/\s+/g, '').length;
  return { characters };
}

function editorTextStats(editor: Editor): NoteTextStats {
  const text = editor.state.doc.textBetween(0, editor.state.doc.content.size, '\n', '\0');
  return textStatsFromContent(text);
}

function buildUntitledPattern(): RegExp {
  return /^未命名笔记(?:\s+(\d+))?$/;
}

function resolveUntitledTitle(titles: string[]): string {
  const used = new Set<number>();
  const pattern = buildUntitledPattern();
  for (const rawTitle of titles) {
    const title = rawTitle.trim();
    const matched = title.match(pattern);
    if (!matched) {
      continue;
    }
    const number = matched[1] ? Number.parseInt(matched[1], 10) : 1;
    if (!Number.isNaN(number) && number >= 1) {
      used.add(number);
    }
  }

  let current = 1;
  while (used.has(current)) {
    current += 1;
  }
  return current === 1 ? UNTITLED_NOTE_BASE : `${UNTITLED_NOTE_BASE} ${current}`;
}

function isUntitledTitle(value: string): boolean {
  return buildUntitledPattern().test(value.trim());
}

export function NoteEditor({
  mode,
  initialNote,
}: {
  mode: 'new' | 'edit';
  initialNote?: KnowledgeNoteDetail;
}) {
  const router = useRouter();
  const lowlight = useMemo(() => createLowlight(common), []);
  const editorSurfaceRef = useRef<HTMLDivElement | null>(null);
  const targetQueryInputRef = useRef<HTMLInputElement | null>(null);
  const initialDoc = useMemo(() => toSafeDoc(initialNote?.contentJson), [initialNote?.contentJson]);

  const [noteId, setNoteId] = useState<string | null>(initialNote?.id ?? null);
  const [noteTitle, setNoteTitle] = useState<string>(initialNote?.title ?? UNTITLED_NOTE_BASE);
  const [defaultUntitledTitle, setDefaultUntitledTitle] = useState(UNTITLED_NOTE_BASE);
  const [noteDetail, setNoteDetail] = useState<KnowledgeNoteDetail | null>(initialNote ?? null);
  const [saveState, setSaveState] = useState<SaveState>('idle');
  const [saveError, setSaveError] = useState<string | null>(null);
  const [focusMode, setFocusMode] = useState(false);
  const [textStats, setTextStats] = useState<NoteTextStats>(() =>
    textStatsFromContent(initialNote?.plainText || ''),
  );

  const [slashMenu, setSlashMenu] = useState<SlashMenuState>(emptySlashMenuState);
  const [targetPicker, setTargetPicker] = useState<TargetPickerState>(emptyTargetPickerState);
  const [targetResults, setTargetResults] = useState<KnowledgeLinkTarget[]>([]);
  const [targetLoading, setTargetLoading] = useState(false);
  const [targetError, setTargetError] = useState<string | null>(null);

  const autosaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inFlightRef = useRef(false);
  const queuedRef = useRef(false);
  const dirtyRef = useRef(false);
  const noteTitleRef = useRef(noteTitle);
  const defaultUntitledTitleRef = useRef(defaultUntitledTitle);
  const latestDocRef = useRef<Record<string, unknown>>(initialDoc);
  const snapshotRef = useRef(
    JSON.stringify({
      title: (initialNote?.title || UNTITLED_NOTE_BASE).trim(),
      contentJson: initialDoc,
    }),
  );

  useEffect(() => {
    noteTitleRef.current = noteTitle;
  }, [noteTitle]);

  useEffect(() => {
    defaultUntitledTitleRef.current = defaultUntitledTitle;
  }, [defaultUntitledTitle]);

  const slashCommands = useMemo<SlashCommand[]>(
    () => [
      {
        id: 'h2',
        label: '二级标题',
        hint: '切换为 H2',
        keywords: ['heading', 'h2', 'title'],
        run: (editor) => editor.chain().focus().toggleHeading({ level: 2 }).run(),
      },
      {
        id: 'bullet',
        label: '无序列表',
        hint: '切换为项目符号列表',
        keywords: ['list', 'bullet', 'ul'],
        run: (editor) => editor.chain().focus().toggleBulletList().run(),
      },
      {
        id: 'ordered',
        label: '有序列表',
        hint: '切换为编号列表',
        keywords: ['list', 'ordered', 'ol'],
        run: (editor) => editor.chain().focus().toggleOrderedList().run(),
      },
      {
        id: 'quote',
        label: '引用块',
        hint: '切换为 blockquote',
        keywords: ['quote', 'blockquote'],
        run: (editor) => editor.chain().focus().toggleBlockquote().run(),
      },
      {
        id: 'code-block',
        label: '代码块',
        hint: '插入/切换代码块',
        keywords: ['code', 'snippet'],
        run: (editor) => editor.chain().focus().toggleCodeBlock().run(),
      },
      {
        id: 'inline-math',
        label: '行内公式',
        hint: '插入 $...$',
        keywords: ['math', 'latex', 'inline'],
        run: (editor) => editor.chain().focus().insertContent('$x^2 + y^2$').run(),
      },
      {
        id: 'block-math',
        label: '块公式',
        hint: '插入 $$...$$',
        keywords: ['math', 'latex', 'block'],
        run: (editor) => editor.chain().focus().insertContent('\n$$\nE = mc^2\n$$\n').run(),
      },
      {
        id: 'link-paper',
        label: '链接文献',
        hint: '搜索并插入文献链接',
        keywords: ['paper', 'arxiv', 'citation', '文献'],
        targetType: 'paper',
      },
      {
        id: 'link-question',
        label: '链接问题',
        hint: '搜索并插入问题链接',
        keywords: ['question', '知识问题'],
        targetType: 'question',
      },
      {
        id: 'link-note',
        label: '链接笔记',
        hint: '搜索并插入笔记链接',
        keywords: ['note', '笔记'],
        targetType: 'note',
      },
    ],
    [],
  );

  const closeSlashMenu = useCallback(() => {
    setSlashMenu(emptySlashMenuState());
  }, []);

  const closeTargetPicker = useCallback(() => {
    setTargetPicker(emptyTargetPickerState());
    setTargetResults([]);
    setTargetError(null);
    setTargetLoading(false);
  }, []);

  const openTargetPicker = useCallback(
    (targetType: LinkTargetType, range: EditorRange, position: EditorPosition) => {
      setTargetPicker({
        open: true,
        targetType,
        query: '',
        position,
        range,
        activeIndex: 0,
      });
      closeSlashMenu();
    },
    [closeSlashMenu],
  );

  const flushSave = useCallback(
    async (force = false) => {
      const resolvedTitle = noteTitleRef.current.trim() || defaultUntitledTitleRef.current;
      const nextPayload = {
        title: resolvedTitle,
        contentJson: latestDocRef.current,
      };
      const nextSnapshot = JSON.stringify(nextPayload);
      if (!force && (!dirtyRef.current || nextSnapshot === snapshotRef.current)) {
        return;
      }

      if (inFlightRef.current) {
        queuedRef.current = true;
        return;
      }

      inFlightRef.current = true;
      setSaveState('saving');
      setSaveError(null);
      try {
        let saved: KnowledgeNoteDetail;
        if (!noteId) {
          saved = await apiBackendFetch<KnowledgeNoteDetail>('knowledge/notes', {
            method: 'POST',
            body: JSON.stringify({
              title: nextPayload.title,
              contentJson: nextPayload.contentJson,
              createdBy: 'user',
            }),
          });
          setNoteId(saved.id);
          router.replace(`/knowledge/notes/${saved.id}/edit`);
        } else {
          saved = await apiBackendFetch<KnowledgeNoteDetail>(`knowledge/notes/${noteId}`, {
            method: 'PATCH',
            body: JSON.stringify({
              title: nextPayload.title,
              contentJson: nextPayload.contentJson,
            }),
          });
        }
        setNoteDetail(saved);
        setNoteTitle(saved.title);
        noteTitleRef.current = saved.title;
        snapshotRef.current = JSON.stringify({
          title: saved.title.trim(),
          contentJson: toSafeDoc(saved.contentJson),
        });
        dirtyRef.current = false;
        setSaveState('saved');
      } catch (error) {
        setSaveState('error');
        setSaveError(error instanceof Error ? error.message : '保存失败');
      } finally {
        inFlightRef.current = false;
        if (queuedRef.current) {
          queuedRef.current = false;
          void flushSave(force);
        }
      }
    },
    [noteId, router],
  );

  const queueAutosave = useCallback(() => {
    dirtyRef.current = true;
    setSaveState((current) => (current === 'error' ? current : 'idle'));
    if (autosaveTimerRef.current) {
      clearTimeout(autosaveTimerRef.current);
    }
    autosaveTimerRef.current = setTimeout(() => {
      void flushSave();
    }, SAVE_DEBOUNCE_MS);
  }, [flushSave]);

  useEffect(() => {
    if (mode !== 'new' || initialNote || noteId) {
      return;
    }
    let cancelled = false;
    const prepareUntitledTitle = async () => {
      try {
        const query = new URLSearchParams({
          search: UNTITLED_NOTE_BASE,
          limit: '200',
        });
        const notes = await apiBackendFetch<KnowledgeNoteSummary[]>(
          `knowledge/notes?${query.toString()}`,
        );
        if (cancelled) {
          return;
        }
        const nextTitle = resolveUntitledTitle(notes.map((item) => item.title));
        setDefaultUntitledTitle(nextTitle);
        defaultUntitledTitleRef.current = nextTitle;
        setNoteTitle((current) => {
          if (!current.trim() || isUntitledTitle(current)) {
            noteTitleRef.current = nextTitle;
            return nextTitle;
          }
          return current;
        });
      } catch {
        if (!cancelled) {
          setDefaultUntitledTitle(UNTITLED_NOTE_BASE);
          defaultUntitledTitleRef.current = UNTITLED_NOTE_BASE;
        }
      }
    };
    void prepareUntitledTitle();
    return () => {
      cancelled = true;
    };
  }, [initialNote, mode, noteId]);

  const syncSlashTrigger = useCallback(
    (currentEditor: Editor) => {
      if (targetPicker.open) {
        return;
      }
      const { from } = currentEditor.state.selection;
      const $from = currentEditor.state.selection.$from;
      const blockStart = from - $from.parentOffset;
      const textBefore = currentEditor.state.doc.textBetween(blockStart, from, '\n', '\0');
      const match = textBefore.match(/\/([^\s/]*)$/);
      if (!match) {
        setSlashMenu((prev) => (prev.open ? emptySlashMenuState() : prev));
        return;
      }

      const query = match[1] || '';
      const range: EditorRange = {
        from: from - (query.length + 1),
        to: from,
      };
      const position = localPositionFromEditor(
        currentEditor,
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
    content: initialDoc,
    extensions: [
      StarterKit.configure({ codeBlock: false }),
      CodeBlockLowlight.configure({ lowlight }),
      Link.configure({
        openOnClick: false,
        autolink: true,
        linkOnPaste: true,
      }),
      KnowledgeMention.configure({
        HTMLAttributes: {
          class: 'note-mention-node',
        },
        renderText({ node }) {
          const label = String(node.attrs.targetLabel || node.attrs.label || node.attrs.targetId || '').trim();
          return `[[${label || node.attrs.targetId || ''}]]`;
        },
        renderHTML({ node, options }) {
          const label = String(node.attrs.targetLabel || node.attrs.label || node.attrs.targetId || '').trim();
          return [
            'span',
            {
              ...options.HTMLAttributes,
              'data-target-type': node.attrs.targetType || '',
              'data-target-id': node.attrs.targetId || '',
            },
            `[[${label || node.attrs.targetId || ''}]]`,
          ];
        },
      }),
      Placeholder.configure({
        placeholder: '输入内容，/ 打开命令',
      }),
      Mathematics.configure({
        katexOptions: {
          throwOnError: false,
        },
      }),
    ],
    editorProps: {
      attributes: {
        class: 'note-editor-content',
      },
    },
    onUpdate: ({ editor: currentEditor }) => {
      latestDocRef.current = currentEditor.getJSON() as Record<string, unknown>;
      setTextStats(editorTextStats(currentEditor));
      queueAutosave();
      syncSlashTrigger(currentEditor);
    },
    onSelectionUpdate: ({ editor: currentEditor }) => {
      syncSlashTrigger(currentEditor);
    },
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
      return command.keywords.some((tag) => tag.toLowerCase().includes(keyword));
    });
  }, [slashCommands, slashMenu.query]);

  const executeSlashCommand = useCallback(
    (command: SlashCommand) => {
      if (!editor || !slashMenu.range) {
        return;
      }
      if (command.targetType) {
        openTargetPicker(command.targetType, slashMenu.range, slashMenu.position);
        return;
      }

      editor.chain().focus().deleteRange(slashMenu.range).run();
      command.run?.(editor);
      closeSlashMenu();
    },
    [closeSlashMenu, editor, openTargetPicker, slashMenu.position, slashMenu.range],
  );

  const insertTargetMention = useCallback(
    (target: KnowledgeLinkTarget) => {
      if (!editor || !targetPicker.range) {
        return;
      }
      editor
        .chain()
        .focus()
        .deleteRange(targetPicker.range)
        .insertContent([
          {
            type: 'mention',
            attrs: {
              id: `${target.type}:${target.id}`,
              label: target.label,
              targetType: target.type,
              targetId: target.id,
              targetLabel: target.label,
            },
          },
          { type: 'text', text: ' ' },
        ])
        .run();
      closeTargetPicker();
    },
    [closeTargetPicker, editor, targetPicker.range],
  );

  useEffect(() => {
    return () => {
      if (autosaveTimerRef.current) {
        clearTimeout(autosaveTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    const onKeydown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's') {
        event.preventDefault();
        void flushSave(true);
      }
    };
    window.addEventListener('keydown', onKeydown);
    return () => window.removeEventListener('keydown', onKeydown);
  }, [flushSave]);

  useEffect(() => {
    const onKeydown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.shiftKey && event.key.toLowerCase() === 'f') {
        event.preventDefault();
        setFocusMode((current) => !current);
      }
    };
    window.addEventListener('keydown', onKeydown);
    return () => window.removeEventListener('keydown', onKeydown);
  }, []);

  useEffect(() => {
    if (!editor) {
      return;
    }
    setTextStats(editorTextStats(editor));
  }, [editor]);

  useEffect(() => {
    if (!editor) {
      return;
    }
    const dom = editor.view.dom;
    const onKeydown = (event: KeyboardEvent) => {
      if (targetPicker.open) {
        if (event.key === 'Escape') {
          event.preventDefault();
          closeTargetPicker();
        }
        return;
      }
      if (!slashMenu.open || filteredSlashCommands.length === 0) {
        if (slashMenu.open && filteredSlashCommands.length === 0 && event.key === 'Escape') {
          event.preventDefault();
          closeSlashMenu();
        }
        return;
      }

      if (event.key === 'ArrowDown') {
        event.preventDefault();
        setSlashMenu((prev) => ({
          ...prev,
          activeIndex: (prev.activeIndex + 1) % filteredSlashCommands.length,
        }));
        return;
      }
      if (event.key === 'ArrowUp') {
        event.preventDefault();
        setSlashMenu((prev) => ({
          ...prev,
          activeIndex:
            (prev.activeIndex - 1 + filteredSlashCommands.length) % filteredSlashCommands.length,
        }));
        return;
      }
      if (event.key === 'Enter') {
        event.preventDefault();
        const picked = filteredSlashCommands[slashMenu.activeIndex];
        if (picked) {
          executeSlashCommand(picked);
        }
        return;
      }
      if (event.key === 'Escape') {
        event.preventDefault();
        closeSlashMenu();
      }
    };

    dom.addEventListener('keydown', onKeydown, true);
    return () => dom.removeEventListener('keydown', onKeydown, true);
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
    if (!targetPicker.open) {
      return;
    }
    targetQueryInputRef.current?.focus();
  }, [targetPicker.open]);

  useEffect(() => {
    if (!targetPicker.open) {
      return;
    }
    let cancelled = false;
    const handle = setTimeout(async () => {
      setTargetLoading(true);
      setTargetError(null);
      try {
        const query = new URLSearchParams({
          type: targetPicker.targetType,
          q: targetPicker.query.trim(),
          limit: '8',
        });
        if (noteId) {
          query.set('exclude_note_id', noteId);
        }
        const results = await apiBackendFetch<KnowledgeLinkTarget[]>(
          `knowledge/link-targets?${query.toString()}`,
        );
        if (!cancelled) {
          setTargetResults(results);
          setTargetPicker((prev) => ({
            ...prev,
            activeIndex: 0,
          }));
        }
      } catch (error) {
        if (!cancelled) {
          setTargetResults([]);
          setTargetError(error instanceof Error ? error.message : '查询失败');
        }
      } finally {
        if (!cancelled) {
          setTargetLoading(false);
        }
      }
    }, 240);

    return () => {
      cancelled = true;
      clearTimeout(handle);
    };
  }, [noteId, targetPicker.open, targetPicker.query, targetPicker.targetType]);

  const groupedLinks = useMemo(() => {
    const links = noteDetail?.outgoingLinks || [];
    return {
      paper: links.filter((item) => item.targetType === 'paper'),
      question: links.filter((item) => item.targetType === 'question'),
      note: links.filter((item) => item.targetType === 'note'),
    };
  }, [noteDetail?.outgoingLinks]);

  const incomingLinks = noteDetail?.incomingLinks || [];
  const outgoingCount = noteDetail?.outgoingLinks.length || 0;
  const incomingCount = incomingLinks.length;

  return (
    <div className={`note-editor-layout${focusMode ? ' note-editor-layout-focus' : ''}`}>
      <section className="note-editor-main">
        <div className="note-editor-meta">
          <div className="note-editor-status-group">
            <span className={`note-save-badge note-save-${saveState}`}>
              {saveBadgeText(saveState, noteDetail?.updatedAt)}
            </span>
            <span className="note-save-hint">{noteId || '未创建'}</span>
          </div>
          <div className="note-editor-action-group">
            <button
              className="button button-secondary note-save-btn"
              onClick={() => setFocusMode((current) => !current)}
              type="button"
            >
              {focusMode ? '退出专注' : '专注模式'}
            </button>
            <button
              className="button button-secondary note-save-btn"
              onClick={() => void flushSave(true)}
              type="button"
            >
              立即保存
            </button>
          </div>
        </div>

        {saveError ? <p className="notice notice-error">{saveError}</p> : null}

        <div className="note-editor-stats-row">
          <span className="note-stat-chip">字数 {textStats.characters}</span>
          <span className="note-stat-chip">出链 {outgoingCount}</span>
          <span className="note-stat-chip">入链 {incomingCount}</span>
        </div>

        <input
          className="note-title-input"
          onChange={(event) => {
            noteTitleRef.current = event.target.value;
            setNoteTitle(event.target.value);
            queueAutosave();
          }}
          placeholder="笔记标题"
          value={noteTitle}
        />

        <div className="note-editor-surface" ref={editorSurfaceRef}>
          <EditorContent editor={editor} />

          {slashMenu.open ? (
            <div
              className="note-slash-menu"
              style={{
                top: slashMenu.position.top,
                left: slashMenu.position.left,
              }}
            >
              {filteredSlashCommands.length > 0 ? (
                <ul className="note-slash-list">
                  {filteredSlashCommands.map((command, index) => (
                    <li key={command.id}>
                      <button
                        className={`note-slash-item${
                          index === slashMenu.activeIndex ? ' note-slash-item-active' : ''
                        }`}
                        onClick={() => executeSlashCommand(command)}
                        type="button"
                      >
                        <span className="note-slash-item-label">{command.label}</span>
                        <span className="note-slash-item-hint">{command.hint}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="note-slash-empty">无匹配命令</p>
              )}
            </div>
          ) : null}

          {targetPicker.open ? (
            <div
              className="note-target-picker"
              style={{
                top: targetPicker.position.top,
                left: targetPicker.position.left,
              }}
            >
              <p className="note-target-picker-title">插入{sectionTitle(targetPicker.targetType)}</p>
              <input
                className="note-target-picker-input"
                onChange={(event) =>
                  setTargetPicker((prev) => ({
                    ...prev,
                    query: event.target.value,
                  }))
                }
                onKeyDown={(event) => {
                  if (!targetResults.length) {
                    if (event.key === 'Escape') {
                      event.preventDefault();
                      closeTargetPicker();
                    }
                    return;
                  }
                  if (event.key === 'ArrowDown') {
                    event.preventDefault();
                    setTargetPicker((prev) => ({
                      ...prev,
                      activeIndex: (prev.activeIndex + 1) % targetResults.length,
                    }));
                    return;
                  }
                  if (event.key === 'ArrowUp') {
                    event.preventDefault();
                    setTargetPicker((prev) => ({
                      ...prev,
                      activeIndex:
                        (prev.activeIndex - 1 + targetResults.length) % targetResults.length,
                    }));
                    return;
                  }
                  if (event.key === 'Enter') {
                    event.preventDefault();
                    const picked = targetResults[targetPicker.activeIndex];
                    if (picked) {
                      insertTargetMention(picked);
                    }
                    return;
                  }
                  if (event.key === 'Escape') {
                    event.preventDefault();
                    closeTargetPicker();
                  }
                }}
                placeholder="输入关键词搜索"
                ref={targetQueryInputRef}
                value={targetPicker.query}
              />
              {targetLoading ? <p className="note-target-picker-loading">查询中…</p> : null}
              {targetError ? <p className="note-target-picker-error">{targetError}</p> : null}
              <ul className="note-target-picker-list">
                {targetResults.map((item, index) => (
                  <li key={`${item.type}:${item.id}`}>
                    <button
                      className={`note-target-picker-item${
                        index === targetPicker.activeIndex ? ' note-target-picker-item-active' : ''
                      }`}
                      onClick={() => insertTargetMention(item)}
                      type="button"
                    >
                      <span className="note-target-picker-label">{item.label}</span>
                      <span className="note-target-picker-subtitle">{item.subtitle || item.id}</span>
                    </button>
                  </li>
                ))}
                {!targetLoading && targetResults.length === 0 ? (
                  <li className="note-target-picker-empty">无可用结果</li>
                ) : null}
              </ul>
            </div>
          ) : null}
        </div>
      </section>

      {!focusMode ? (
        <aside className="note-editor-sidebar">
          {(['paper', 'question', 'note'] as LinkTargetType[]).map((targetType) => {
            const links = groupedLinks[targetType];
            return (
              <section className="note-sidebar-section" key={targetType}>
                <p className="note-sidebar-title">
                  {sectionTitle(targetType)}（{links.length}）
                </p>
                <ul className="note-link-list">
                  {links.map((link) => {
                    const href = targetHref(link.targetType, link.targetId);
                    const label = normalizeLinkLabel(link);
                    const isPaper = link.targetType === 'paper';
                    return (
                      <li className="note-link-item" key={link.id}>
                        <p className="note-link-meta">{formatDateTime(link.createdAt)}</p>
                        <p className="note-link-title">{label}</p>
                        {isPaper ? (
                          <div className="note-link-chip-row">
                            {link.readingReportId ? (
                              <NextLink className="note-link-chip" href={`/reports/${link.readingReportId}`}>
                                精读报告
                              </NextLink>
                            ) : null}
                            <a className="note-link-chip" href={href} rel="noreferrer" target="_blank">
                              arXiv
                            </a>
                          </div>
                        ) : (
                          <NextLink className="note-link-chip" href={href}>
                            打开链接
                          </NextLink>
                        )}
                      </li>
                    );
                  })}
                  {links.length === 0 ? <li className="note-link-empty">暂无链接</li> : null}
                </ul>
              </section>
            );
          })}

          <section className="note-sidebar-section">
            <p className="note-sidebar-title">反向链接（{incomingCount}）</p>
            <ul className="note-link-list">
              {incomingLinks.map((link) => (
                <li className="note-link-item" key={link.id}>
                  <p className="note-link-meta">创建于 {formatDateTime(link.createdAt)}</p>
                  <NextLink className="note-link-chip" href={`/knowledge/notes/${link.sourceNoteId}/edit`}>
                    {link.sourceNoteTitle?.trim() || link.sourceNoteId}
                  </NextLink>
                  {link.sourceNoteUpdatedAt ? (
                    <p className="note-link-meta">源笔记更新于 {formatDateTime(link.sourceNoteUpdatedAt)}</p>
                  ) : null}
                </li>
              ))}
              {incomingCount === 0 ? <li className="note-link-empty">暂无反向链接</li> : null}
            </ul>
          </section>
        </aside>
      ) : null}
    </div>
  );
}
