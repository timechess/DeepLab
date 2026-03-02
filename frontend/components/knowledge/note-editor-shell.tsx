'use client';

import dynamic from 'next/dynamic';
import Link from 'next/link';

import type { KnowledgeNoteDetail } from '@/lib/api/schemas';

const NoteEditor = dynamic(
  () => import('@/components/knowledge/note-editor').then((mod) => mod.NoteEditor),
  {
    ssr: false,
    loading: () => (
      <section className="note-editor-page">
        <div className="note-editor-panel">
          <p className="page-subtitle">正在加载编辑器…</p>
        </div>
      </section>
    ),
  },
);

export function NoteEditorShell({
  mode,
  initialNote,
}: {
  mode: 'new' | 'edit';
  initialNote?: KnowledgeNoteDetail;
}) {
  return (
    <section className="note-editor-page">
      <header className="note-editor-topbar">
        <div className="note-editor-topbar-text">
          <p className="note-editor-eyebrow">Knowledge Note Studio</p>
          <h1 className="note-editor-title">双链笔记编辑器</h1>
        </div>
        <div className="note-editor-topbar-actions">
          <Link className="button button-secondary" href="/">
            返回首页
          </Link>
          <Link className="button button-secondary" href="/knowledge?view=notes">
            返回知识库
          </Link>
        </div>
      </header>

      <div className="note-editor-panel">
        <NoteEditor initialNote={initialNote} mode={mode} />
      </div>
    </section>
  );
}
