ALTER TABLE notes ADD COLUMN content_hash TEXT NOT NULL DEFAULT '';

CREATE TABLE IF NOT EXISTS note_revisions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  note_id INTEGER NOT NULL,
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  content_length INTEGER NOT NULL,
  source TEXT NOT NULL DEFAULT 'unknown',
  createdAt TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  content_hash TEXT NOT NULL DEFAULT '',
  snapshot_size INTEGER NOT NULL DEFAULT 0,
  FOREIGN KEY (note_id) REFERENCES notes (id) ON DELETE CASCADE
);

UPDATE notes
SET content_hash = printf('%016x', id)
WHERE COALESCE(content_hash, '') = '';

UPDATE note_revisions
SET content_hash = printf('%016x', id)
WHERE COALESCE(content_hash, '') = '';

UPDATE note_revisions
SET snapshot_size = length(content)
WHERE COALESCE(snapshot_size, 0) <= 0;

CREATE INDEX IF NOT EXISTS idx_notes_content_hash ON notes (content_hash);
CREATE INDEX IF NOT EXISTS idx_note_revisions_note_id ON note_revisions (note_id);
CREATE INDEX IF NOT EXISTS idx_note_revisions_note_id_desc ON note_revisions (note_id, id DESC);
CREATE INDEX IF NOT EXISTS idx_note_revisions_created_at ON note_revisions (createdAt);
CREATE INDEX IF NOT EXISTS idx_note_revisions_note_hash ON note_revisions (note_id, content_hash);
