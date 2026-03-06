ALTER TABLE paper_reports ADD COLUMN workflow_id INTEGER;
ALTER TABLE paper_reports ADD COLUMN source TEXT NOT NULL DEFAULT 'huggingface|arxiv';
ALTER TABLE paper_reports ADD COLUMN ocr_model TEXT;
ALTER TABLE paper_reports ADD COLUMN status TEXT NOT NULL DEFAULT 'ready';
ALTER TABLE paper_reports ADD COLUMN error TEXT;

CREATE INDEX IF NOT EXISTS idx_paper_reports_updatedAt ON paper_reports (updatedAt);
CREATE INDEX IF NOT EXISTS idx_paper_reports_status ON paper_reports (status);
