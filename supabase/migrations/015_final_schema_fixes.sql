-- Migration 015: Final schema fixes for the ingestion pipeline

-- 1. The ingest pipeline sets status to 'pending_review' for servers with high-severity issues
ALTER TYPE server_status ADD VALUE IF NOT EXISTS 'pending_review';

-- 2. Stdio servers (local executables/repos) do not have HTTP endpoints.
-- The ingest pipeline correctly passes null, but the column was originally defined as NOT NULL.
ALTER TABLE public.servers ALTER COLUMN endpoint DROP NOT NULL;

-- 3. Force PostgREST schema cache to reload immediately to pick up all changes
NOTIFY pgrst, 'reload schema';
