-- Migration: 036_processing_jobs_and_mvp_ingest
--
-- Adds a small DB-backed queue for post-ingest processing. Initial catalog
-- ingest can now write rows quickly, while probe/sandbox/readme/CVE work runs
-- later in bounded cron batches.

CREATE TABLE IF NOT EXISTS public.server_processing_jobs (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  server_id   UUID NOT NULL REFERENCES public.servers(id) ON DELETE CASCADE,
  job_type    TEXT NOT NULL CHECK (job_type IN (
    'probe',
    'sandbox',
    'readme_enrich',
    'cve_scan'
  )),
  status      TEXT NOT NULL DEFAULT 'queued' CHECK (status IN (
    'queued',
    'running',
    'success',
    'failed'
  )),
  priority    INTEGER NOT NULL DEFAULT 100,
  attempts    INTEGER NOT NULL DEFAULT 0,
  run_after   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  locked_at   TIMESTAMPTZ,
  last_error  TEXT,
  result      JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (server_id, job_type)
);

CREATE INDEX IF NOT EXISTS idx_server_processing_jobs_ready
  ON public.server_processing_jobs(status, run_after, priority, created_at);

CREATE INDEX IF NOT EXISTS idx_server_processing_jobs_server
  ON public.server_processing_jobs(server_id, status);

ALTER TABLE public.server_processing_jobs ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.server_processing_jobs TO service_role;

CREATE OR REPLACE VIEW public.processing_job_health AS
SELECT
  job_type,
  status,
  COUNT(*) AS job_count,
  MIN(run_after) AS oldest_run_after,
  MAX(updated_at) AS latest_update
FROM public.server_processing_jobs
GROUP BY job_type, status
ORDER BY job_type, status;

GRANT SELECT ON public.processing_job_health TO service_role;

NOTIFY pgrst, 'reload schema';
