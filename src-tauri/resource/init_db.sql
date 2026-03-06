PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS runtime_settings (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  provider TEXT NOT NULL,
  base_url TEXT NOT NULL,
  api_key TEXT NOT NULL,
  model_name TEXT NOT NULL,
  ocr_provider TEXT NOT NULL DEFAULT 'mistral_ai',
  ocr_base_url TEXT,
  ocr_api_key TEXT,
  ocr_model TEXT,
  thinking_level TEXT CHECK (thinking_level IN ('low', 'medium', 'high')),
  temperature REAL,
  paper_filter_prompt TEXT,
  paper_reading_prompt TEXT,
  work_report_prompt TEXT,
  createdAt TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updatedAt TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS papers (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  authors TEXT NOT NULL,
  organization TEXT,
  summary TEXT,
  ai_summary TEXT,
  ai_keywords TEXT,
  upvotes INTEGER,
  githubRepo TEXT,
  githubStars INTEGER,
  publishedAt TEXT,
  createdAt TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updatedAt TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS paper_reports (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  paper_id TEXT NOT NULL UNIQUE,
  workflow_id INTEGER,
  source TEXT NOT NULL DEFAULT 'huggingface|arxiv',
  ocr_model TEXT,
  status TEXT NOT NULL DEFAULT 'ready',
  error TEXT,
  comment TEXT,
  report TEXT,
  createdAt TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updatedAt TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (paper_id) REFERENCES papers (id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS tasks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  description TEXT,
  priority TEXT NOT NULL DEFAULT 'medium' CHECK (priority IN ('low', 'medium', 'meidum', 'high')),
  completedDate TEXT,
  createdAt TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updatedAt TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS notes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  linkedPaper TEXT,
  linkedTask INTEGER,
  linkedNote INTEGER,
  createdAt TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updatedAt TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (linkedPaper) REFERENCES papers (id) ON DELETE SET NULL,
  FOREIGN KEY (linkedTask) REFERENCES tasks (id) ON DELETE SET NULL,
  FOREIGN KEY (linkedNote) REFERENCES notes (id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS behavior_snapshots (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  tasks TEXT NOT NULL,
  comments TEXT NOT NULL,
  notes TEXT NOT NULL,
  createdAt TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updatedAt TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS work_reports (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  workflow_id INTEGER,
  statistics TEXT NOT NULL,
  report TEXT NOT NULL,
  startDate TEXT NOT NULL,
  endDate TEXT NOT NULL,
  createdAt TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updatedAt TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (workflow_id) REFERENCES workflows (id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS llm_invocation_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  base_url TEXT NOT NULL,
  model TEXT NOT NULL,
  prompt TEXT NOT NULL,
  output TEXT,
  inputToken INTEGER,
  outputToken INTEGER,
  temperature REAL,
  thinking_level TEXT,
  createdAt TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updatedAt TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS workflows (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  stage TEXT NOT NULL,
  error TEXT,
  payload TEXT,
  createdAt TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updatedAt TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS rules (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  content TEXT NOT NULL,
  createdAt TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updatedAt TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

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

CREATE TABLE IF NOT EXISTS note_links (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  note_id INTEGER NOT NULL,
  link_type TEXT NOT NULL CHECK (link_type IN ('linked_paper', 'linked_task', 'linked_note', 'linked_work_report')),
  target_paper_id TEXT,
  target_task_id INTEGER,
  target_note_id INTEGER,
  target_work_report_date TEXT,
  createdAt TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (note_id) REFERENCES notes (id) ON DELETE CASCADE,
  FOREIGN KEY (target_paper_id) REFERENCES papers (id) ON DELETE CASCADE,
  FOREIGN KEY (target_task_id) REFERENCES tasks (id) ON DELETE CASCADE,
  FOREIGN KEY (target_note_id) REFERENCES notes (id) ON DELETE CASCADE,
  FOREIGN KEY (target_work_report_date) REFERENCES work_reports (endDate) ON DELETE CASCADE,
  CHECK (
    (CASE WHEN target_paper_id IS NOT NULL THEN 1 ELSE 0 END) +
    (CASE WHEN target_task_id IS NOT NULL THEN 1 ELSE 0 END) +
    (CASE WHEN target_note_id IS NOT NULL THEN 1 ELSE 0 END) +
    (CASE WHEN target_work_report_date IS NOT NULL THEN 1 ELSE 0 END) = 1
  )
);

CREATE INDEX IF NOT EXISTS idx_papers_published_at ON papers (publishedAt);
CREATE INDEX IF NOT EXISTS idx_tasks_completed_date ON tasks (completedDate);
CREATE INDEX IF NOT EXISTS idx_work_reports_date_range ON work_reports (startDate, endDate);
CREATE UNIQUE INDEX IF NOT EXISTS idx_work_reports_end_date_unique ON work_reports (endDate);
CREATE INDEX IF NOT EXISTS idx_llm_logs_model ON llm_invocation_logs (model);
CREATE INDEX IF NOT EXISTS idx_workflows_stage ON workflows (stage);
CREATE INDEX IF NOT EXISTS idx_paper_recommendations_day_key ON paper_recommendations (day_key);
CREATE INDEX IF NOT EXISTS idx_paper_reports_updatedAt ON paper_reports (updatedAt);
CREATE INDEX IF NOT EXISTS idx_paper_reports_status ON paper_reports (status);
CREATE UNIQUE INDEX IF NOT EXISTS idx_note_links_unique_paper
  ON note_links (note_id, link_type, target_paper_id)
  WHERE target_paper_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_note_links_unique_task
  ON note_links (note_id, link_type, target_task_id)
  WHERE target_task_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_note_links_unique_note
  ON note_links (note_id, link_type, target_note_id)
  WHERE target_note_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_note_links_unique_work_report
  ON note_links (note_id, link_type, target_work_report_date)
  WHERE target_work_report_date IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_note_links_note_id ON note_links (note_id);
CREATE INDEX IF NOT EXISTS idx_note_links_target_note_id ON note_links (target_note_id);
CREATE INDEX IF NOT EXISTS idx_notes_title ON notes (title);
CREATE INDEX IF NOT EXISTS idx_notes_updatedAt ON notes (updatedAt);
