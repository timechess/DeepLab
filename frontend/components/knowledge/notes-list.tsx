import Link from 'next/link';

import type { KnowledgeNoteSummary } from '@/lib/api/schemas';
import { formatDateTime } from '@/lib/time';

export function KnowledgeNotesList({ notes }: { notes: KnowledgeNoteSummary[] }) {
  return (
    <div className="rules-grid">
      {notes.map((note) => (
        <article className="panel-list-item note-list-item" key={note.id}>
          <div className="rule-head">
            <p className="mono-id" style={{ margin: 0 }}>
              {note.id}
            </p>
            <div className="meta-chip-list">
              <span className="meta-chip meta-chip-outline">出链 {note.outgoingLinkCount}</span>
              <span className="meta-chip meta-chip-outline">入链 {note.incomingLinkCount}</span>
            </div>
          </div>
          <h4 className="panel-title note-list-title">{note.title}</h4>
          <p className="note-list-excerpt">{note.excerpt || '（空笔记）'}</p>
          <div className="rule-footer">
            <p className="mono-id rule-time">更新于 {formatDateTime(note.updatedAt)}</p>
            <Link className="button button-secondary rule-action-btn" href={`/knowledge/notes/${note.id}/edit`}>
              打开编辑器
            </Link>
          </div>
        </article>
      ))}
    </div>
  );
}
