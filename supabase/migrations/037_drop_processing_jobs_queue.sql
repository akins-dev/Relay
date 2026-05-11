-- Migration: 037_drop_processing_jobs_queue
--
-- Relay's prototype path no longer runs post-ingest processing jobs.
-- The queue introduced in 036 was useful for a production-style probe,
-- sandbox, README enrichment, and CVE pipeline, but it is not part of the
-- current MVP contract: ingest catalog metadata, search by intent, return a
-- local/remote run manifest, and let the CLI/agent host execute locally.
--
-- This queue is disposable derived state, not canonical product data.

DROP VIEW IF EXISTS public.processing_job_health;
DROP TABLE IF EXISTS public.server_processing_jobs;

NOTIFY pgrst, 'reload schema';
