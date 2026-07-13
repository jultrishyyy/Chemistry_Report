-- 006: Add attachments column to record_data
ALTER TABLE record_data ADD COLUMN IF NOT EXISTS attachments JSONB DEFAULT '[]';
-- Format: [{"id": "uuid", "filename": "original.xlsx", "path": "uploads/file.xlsx", "uploaded_at": "ISO timestamp"}]
