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
  statistics TEXT NOT NULL,
  report TEXT NOT NULL,
  startDate TEXT NOT NULL,
  endDate TEXT NOT NULL,
  createdAt TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updatedAt TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
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

CREATE INDEX IF NOT EXISTS idx_papers_published_at ON papers (publishedAt);
CREATE INDEX IF NOT EXISTS idx_tasks_completed_date ON tasks (completedDate);
CREATE INDEX IF NOT EXISTS idx_work_reports_date_range ON work_reports (startDate, endDate);
CREATE INDEX IF NOT EXISTS idx_llm_logs_model ON llm_invocation_logs (model);
CREATE INDEX IF NOT EXISTS idx_workflows_stage ON workflows (stage);
