-- Idempotent schema fixes for FWAI Voice AI Agent
-- Safe to run on every startup — only adds missing columns, never destroys data

-- Add missing columns to calls table
ALTER TABLE calls ADD COLUMN IF NOT EXISTS transcript_entries JSONB DEFAULT '[]'::jsonb;
ALTER TABLE calls ADD COLUMN IF NOT EXISTS call_metrics JSONB DEFAULT '{}'::jsonb;
ALTER TABLE calls ADD COLUMN IF NOT EXISTS recording_url TEXT;
ALTER TABLE calls ADD COLUMN IF NOT EXISTS persona TEXT;

-- Indexes (idempotent)
CREATE INDEX IF NOT EXISTS idx_calls_phone ON calls(phone);

-- Add org_id to contact_memory for tenant isolation
ALTER TABLE contact_memory ADD COLUMN IF NOT EXISTS org_id TEXT DEFAULT '';

-- Migrate primary key from (phone) to (phone, org_id) for multi-tenant support
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.key_column_usage
        WHERE table_name = 'contact_memory' AND column_name = 'org_id'
        AND constraint_name = 'contact_memory_pkey'
    ) THEN
        ALTER TABLE contact_memory DROP CONSTRAINT IF EXISTS contact_memory_pkey;
        ALTER TABLE contact_memory ADD PRIMARY KEY (phone, org_id);
    END IF;
END $$;
