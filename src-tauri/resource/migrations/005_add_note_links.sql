CREATE TABLE IF NOT EXISTS note_links (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  note_id INTEGER NOT NULL,
  link_type TEXT NOT NULL CHECK (link_type IN ('linked_paper', 'linked_task', 'linked_note')),
  target_paper_id TEXT,
  target_task_id INTEGER,
  target_note_id INTEGER,
  createdAt TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (note_id) REFERENCES notes (id) ON DELETE CASCADE,
  FOREIGN KEY (target_paper_id) REFERENCES papers (id) ON DELETE CASCADE,
  FOREIGN KEY (target_task_id) REFERENCES tasks (id) ON DELETE CASCADE,
  FOREIGN KEY (target_note_id) REFERENCES notes (id) ON DELETE CASCADE,
  CHECK (
    (CASE WHEN target_paper_id IS NOT NULL THEN 1 ELSE 0 END) +
    (CASE WHEN target_task_id IS NOT NULL THEN 1 ELSE 0 END) +
    (CASE WHEN target_note_id IS NOT NULL THEN 1 ELSE 0 END) = 1
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_note_links_unique_paper
  ON note_links (note_id, link_type, target_paper_id)
  WHERE target_paper_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_note_links_unique_task
  ON note_links (note_id, link_type, target_task_id)
  WHERE target_task_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_note_links_unique_note
  ON note_links (note_id, link_type, target_note_id)
  WHERE target_note_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_note_links_note_id ON note_links (note_id);
CREATE INDEX IF NOT EXISTS idx_note_links_target_note_id ON note_links (target_note_id);
CREATE INDEX IF NOT EXISTS idx_notes_title ON notes (title);
CREATE INDEX IF NOT EXISTS idx_notes_updatedAt ON notes (updatedAt);
