CREATE TABLE IF NOT EXISTS paper_recommendations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  day_key TEXT NOT NULL UNIQUE,
  summary TEXT NOT NULL,
  selected_ids_json TEXT NOT NULL,
  decisions_json TEXT NOT NULL,
  candidate_ids_json TEXT NOT NULL,
  workflow_id INTEGER,
  triggered_at TEXT NOT NULL,
  finished_at TEXT NOT NULL,
  createdAt TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updatedAt TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (workflow_id) REFERENCES workflows (id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_paper_recommendations_day_key ON paper_recommendations (day_key);
