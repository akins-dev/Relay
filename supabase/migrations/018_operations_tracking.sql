-- ─────────────────────────────────────────────────────────────────────────────
-- relay — Migration 018: Operations tracking & ingestion optimization
--
-- 1. cron_job_runs table          — admin visibility into background jobs
-- 2. upstream_updated_at column   — zero-cost skip in ingestion pipeline
-- 3. cron_job_health view         — latest run per job
-- 4. uptime_issues view           — servers with poor uptime/latency
-- 5. drift_events view            — recent schema drift suspensions
-- 6. security_threats view fix    — add missing unique_ips column
-- ─────────────────────────────────────────────────────────────────────────────

-- ── 1. Cron job execution tracking ──────────────────────────────────────────
-- Every cron job records start/finish/result for admin dashboard visibility.
-- Previously, cron results were invisible — only visible via Supabase SQL Editor.

CREATE TABLE IF NOT EXISTS public.cron_job_runs (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  job_name    TEXT NOT NULL,         -- 'uptime_check', 'schema_drift', 'reset_daily_calls', 'ingest'
  started_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  finished_at TIMESTAMPTZ,
  status      TEXT NOT NULL DEFAULT 'running',  -- 'running', 'success', 'error'
  result      JSONB DEFAULT '{}',    -- job-specific result data (e.g. { checked: 487, up: 482 })
  error       TEXT,                  -- error message if status = 'error'
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Fast lookup: latest run per job name
CREATE INDEX IF NOT EXISTS idx_cron_job_runs_name
  ON public.cron_job_runs(job_name, started_at DESC);

-- Retention: auto-delete runs older than 30 days to prevent table bloat
-- (can be changed to a scheduled cleanup if needed)

-- RLS: service_role only (admin queries only, not public)
ALTER TABLE public.cron_job_runs ENABLE ROW LEVEL SECURITY;

-- ── 2. upstream_updated_at on servers ───────────────────────────────────────
-- Stores when the upstream source (Official Registry, Smithery, Glama, GitHub)
-- last modified this server. Enables zero-cost skip: if upstream hasn't changed
-- since our last scan, skip immediately without computing hashes.
--
-- Time complexity improvement: O(1) timestamp comparison vs O(T log T) hash computation
-- where T = number of tools on the server.

ALTER TABLE public.servers
  ADD COLUMN IF NOT EXISTS upstream_updated_at TIMESTAMPTZ;

-- ── 3. Cron job health view ─────────────────────────────────────────────────
-- Returns the latest run for each job. Used by admin Operations tab.
-- DISTINCT ON (job_name) with ORDER BY started_at DESC gives us exactly
-- the most recent run per job in a single index scan — O(J) where J = job count.

CREATE OR REPLACE VIEW public.cron_job_health AS
SELECT DISTINCT ON (job_name)
  id,
  job_name,
  started_at,
  finished_at,
  status,
  result,
  error,
  EXTRACT(EPOCH FROM (COALESCE(finished_at, NOW()) - started_at))::INTEGER AS duration_seconds
FROM public.cron_job_runs
ORDER BY job_name, started_at DESC;

-- ── 4. Servers with uptime/latency issues ───────────────────────────────────
-- Shows servers below 95% uptime or with latency > 5 seconds.
-- Admin uses this to identify candidates for suspension or investigation.

CREATE OR REPLACE VIEW public.uptime_issues AS
SELECT
  name, display_name, source, endpoint, transport,
  uptime_pct, latency_ms, trust_score, mcp_compliant, last_scanned_at,
  status
FROM public.servers
WHERE status = 'active'
  AND (uptime_pct < 95 OR latency_ms > 5000 OR latency_ms IS NULL)
ORDER BY uptime_pct ASC NULLS FIRST, latency_ms DESC NULLS LAST;

-- ── 5. Recent schema drift events ───────────────────────────────────────────
-- Shows servers that failed drift checks (tools changed post-approval).
-- L3 defense: rug-pull detection. Admin can re-scan or permanently reject.

CREATE OR REPLACE VIEW public.drift_events AS
SELECT
  s.name,
  s.display_name,
  s.source,
  s.status,
  s.trust_score,
  sr.created_at AS drifted_at,
  sr.issues,
  sr.details
FROM public.scan_results sr
JOIN public.servers s ON s.id = sr.server_id
WHERE sr.scan_type = 'drift' AND sr.passed = false
ORDER BY sr.created_at DESC
LIMIT 50;

-- ── 6. Fix security_threats view ────────────────────────────────────────────
-- The admin dashboard expects `unique_ips` but the original view in 006
-- used audit_log. The corrected version below queries metering_events and
-- includes the missing unique_ips column.

DROP VIEW IF EXISTS public.security_threats CASCADE;

CREATE OR REPLACE VIEW public.security_threats AS
SELECT
  DATE(created_at)                                      AS day,
  COUNT(*)                                              AS total_calls,
  COUNT(DISTINCT user_id)                               AS unique_ips,
  COUNT(*) FILTER (WHERE dlp_triggered)                 AS dlp_triggers,
  COUNT(*) FILTER (WHERE status_code = 400)             AS blocked_calls,
  COUNT(*) FILTER (WHERE status_code = 429)             AS rate_limited,
  COUNT(*) FILTER (WHERE status_code >= 500)            AS errors,
  ROUND(100.0 * COUNT(*) FILTER (WHERE dlp_triggered) / NULLIF(COUNT(*), 0), 2) AS dlp_rate_pct,
  ROUND(AVG(latency_ms))::INTEGER                       AS avg_latency_ms
FROM public.metering_events
WHERE created_at > NOW() - INTERVAL '90 days'
GROUP BY DATE(created_at)
ORDER BY day DESC;

-- ── Grants ──────────────────────────────────────────────────────────────────
GRANT SELECT ON public.cron_job_runs   TO service_role;
GRANT INSERT ON public.cron_job_runs   TO service_role;
GRANT UPDATE ON public.cron_job_runs   TO service_role;
GRANT SELECT ON public.cron_job_health TO service_role;
GRANT SELECT ON public.uptime_issues   TO service_role;
GRANT SELECT ON public.drift_events    TO service_role;

NOTIFY pgrst, 'reload schema';
