-- Migration: 034_fix_enum_constraints
--
-- Fixes two check constraint mismatches that were causing mass upsert failures
-- during the official registry ingest run (7574 servers, ~hundreds rejected).
--
-- Root causes:
--
--   1. servers_auth_type_check (migration 012)
--      DB allowed:   'none' | 'managed' | 'key_param' | 'agentsecrets' | 'oauth'
--      Code writes:  'api_key'  (from deriveAuthType() in pipeline.ts)
--      'api_key' was never added to the constraint after the auth type enum was
--      refactored.  Every server with required env vars (isSecret or isRequired)
--      was rejected.
--
--   2. servers_tool_extraction_source_check (migration 027)
--      DB allowed:   'upstream_schemas' | 'upstream_names' | 'mcp_probe' |
--                    'sandbox' | 'readme' | 'none'
--      Code writes:  'readme_parsed'    (pipeline.ts line 277)
--                    'smithery_detail'  (ToolExtractionSource type, smithery fetcher)
--      The DB had 'readme' but the code always writes 'readme_parsed'.
--      'smithery_detail' was in the TypeScript type but never added to the DB.
--
-- Fix strategy:
--   Expand both constraints to match the authoritative TypeScript ToolExtractionSource
--   and auth type values exactly. We keep all legacy values for backward compat with
--   any existing rows (backfill is handled where needed below).
--
-- No data loss. No column changes. Constraint-only migration.

-- ── 1. Fix servers_auth_type_check ───────────────────────────────────────────
-- Add 'api_key' — the value written by deriveAuthType() when env_var_schema has
-- a secret or required variable.

ALTER TABLE public.servers DROP CONSTRAINT IF EXISTS servers_auth_type_check;

ALTER TABLE public.servers ADD CONSTRAINT servers_auth_type_check
  CHECK (auth_type IN (
    -- Current active values written by pipeline.ts / deriveAuthType()
    'none',
    'managed',
    'api_key',
    -- OAuth flow (set by migration 012 and OAuth callback route)
    'oauth',
    -- Legacy values — kept for backward compat with existing rows
    'key_param',
    'agentsecrets'
  ));

-- ── 2. Fix servers_tool_extraction_source_check ───────────────────────────────
-- Add 'readme_parsed' and 'smithery_detail' — both are written by the pipeline
-- but were never in the DB constraint.
-- Backfill: rename the legacy 'readme' rows to 'readme_parsed' so the column
-- value is consistent with what the pipeline now writes.

-- 2a. Drop the old inline check (added as part of ADD COLUMN in migration 027).
--     PostgreSQL names inline constraints as <table>_<column>_check by default.
ALTER TABLE public.servers DROP CONSTRAINT IF EXISTS servers_tool_extraction_source_check;

-- 2b. Backfill: existing rows with 'readme' → 'readme_parsed'
--     (pipeline.ts writes 'readme_parsed', not 'readme'; old rows used 'readme').
UPDATE public.servers
SET tool_extraction_source = 'readme_parsed'
WHERE tool_extraction_source = 'readme';

-- 2c. Add the expanded constraint.
ALTER TABLE public.servers ADD CONSTRAINT servers_tool_extraction_source_check
  CHECK (tool_extraction_source IN (
    -- Full TypeScript ToolExtractionSource enum
    'smithery_detail',    -- Full inputSchema from Smithery GET /v2/servers/{id}
    'mcp_probe',          -- Live MCP handshake to a running HTTP/SSE endpoint
    'sandbox',            -- Sandboxed local execution of a stdio package
    'upstream_schemas',   -- Schemas provided directly by the upstream API
    'upstream_names',     -- Only tool names available (no inputSchema)
    'readme_parsed',      -- Parsed from README markdown (low confidence, stdio fallback)
    'none',               -- No tool data from any source
    -- Legacy value — kept in case any rows were not backfilled above
    'readme'
  ));

-- ── 3. Update quality views affected by the 'readme' → 'readme_parsed' rename ──
-- migration 028 created ingest_quality with a fixed column list. PostgreSQL's
-- CREATE OR REPLACE VIEW cannot add or reorder columns — it errors with:
--   "cannot change name of view column ... Use ALTER VIEW ... RENAME COLUMN"
-- We must DROP the view and recreate it. No other view depends on ingest_quality,
-- so this is safe.

DROP VIEW IF EXISTS public.ingest_quality;

CREATE VIEW public.ingest_quality AS
SELECT
  source,
  COUNT(*)                                                                            AS total_servers,
  COUNT(*) FILTER (WHERE status = 'active')                                           AS active_servers,
  COUNT(*) FILTER (WHERE status = 'rejected')                                         AS rejected_servers,
  COUNT(*) FILTER (WHERE verified = TRUE)                                             AS verified_servers,
  COUNT(*) FILTER (WHERE scan_status = 'passed')                                      AS scan_passed,
  COUNT(*) FILTER (WHERE scan_status = 'failed')                                      AS scan_failed,
  COUNT(*) FILTER (WHERE cve_issues != '[]'::jsonb)                                   AS has_cve_issues,
  ROUND(AVG(trust_score), 1)                                                          AS avg_trust_score,
  ROUND(100.0 * COUNT(*) FILTER (WHERE status = 'rejected') / NULLIF(COUNT(*), 0), 1) AS rejection_rate_pct,
  COUNT(*) FILTER (WHERE description_quality = 'readme_parsed')                       AS readme_enriched,
  COUNT(*) FILTER (WHERE description_quality = 'auto_generated')                      AS auto_described,
  -- Added: smithery_detail_backed (new extraction source not in migration 028)
  COUNT(*) FILTER (WHERE tool_extraction_source = 'smithery_detail')                  AS smithery_detail_backed,
  COUNT(*) FILTER (WHERE tool_extraction_source = 'mcp_probe')                        AS probe_backed,
  COUNT(*) FILTER (WHERE tool_extraction_source = 'sandbox')                          AS sandbox_backed,
  -- Count both spellings (pre- and post-backfill of 'readme' → 'readme_parsed')
  COUNT(*) FILTER (WHERE tool_extraction_source IN ('readme_parsed', 'readme'))        AS readme_backed,
  COUNT(*) FILTER (WHERE tool_extraction_source = 'none')                             AS no_tool_metadata,
  COUNT(*) FILTER (
    WHERE transport = 'stdio'
      AND tool_extraction_source IN ('readme_parsed', 'readme', 'none')
  )                                                                                   AS weak_stdio_rows
FROM public.servers
GROUP BY source
ORDER BY total_servers DESC;

-- platform_kpis: only the weak_stdio_rows subquery changes (match both spellings).
-- CREATE OR REPLACE is safe here because we are not adding/renaming columns.
CREATE OR REPLACE VIEW public.platform_kpis AS
SELECT
  (SELECT COUNT(*) FROM public.servers)                            AS total_servers,
  (SELECT COUNT(*) FROM public.servers WHERE status='active')      AS active_servers,
  (SELECT COUNT(*) FROM public.servers WHERE verified=TRUE)        AS verified_servers,
  (SELECT COUNT(*) FROM public.servers WHERE source='official')    AS official_servers,
  (SELECT COUNT(*) FROM public.servers WHERE source='smithery')    AS smithery_servers,
  (SELECT COUNT(*) FROM public.servers WHERE source='glama')       AS glama_servers,
  (SELECT COUNT(*) FROM public.servers WHERE source='github')      AS github_servers,
  (SELECT COUNT(*) FROM public.servers WHERE source='direct')      AS direct_servers,
  (SELECT COUNT(*) FROM public.servers WHERE scan_status='failed') AS scan_failures,
  (SELECT COUNT(*) FROM public.servers WHERE cve_issues != '[]'::jsonb) AS servers_with_cves,
  (SELECT ROUND(AVG(trust_score),1) FROM public.servers WHERE status='active') AS avg_trust_score,
  (SELECT COUNT(*) FROM public.metering_events WHERE created_at > NOW() - INTERVAL '24 hours') AS calls_24h,
  (SELECT COUNT(*) FROM public.metering_events WHERE created_at > NOW() - INTERVAL '7 days')   AS calls_7d,
  (SELECT COUNT(*) FROM public.metering_events WHERE created_at > NOW() - INTERVAL '30 days')  AS calls_30d,
  (SELECT COUNT(*) FROM public.metering_events WHERE dlp_triggered AND created_at > NOW() - INTERVAL '7 days') AS dlp_triggers_7d,
  (SELECT COUNT(*) FROM public.profiles)                           AS total_users,
  (SELECT COUNT(*) FROM public.api_keys)                          AS active_api_keys,
  (SELECT COUNT(*) FROM public.ingest_runs)                       AS total_ingest_runs,
  (SELECT MAX(finished_at) FROM public.ingest_runs WHERE finished_at IS NOT NULL) AS last_ingest_at,
  (SELECT COUNT(*) FROM public.servers WHERE tool_extraction_source = 'none')     AS no_tool_metadata_servers,
  -- Match both spellings so the counter works pre- and post-backfill
  (SELECT COUNT(*) FROM public.servers
   WHERE transport = 'stdio'
     AND tool_extraction_source IN ('readme_parsed', 'readme', 'none'))           AS weak_stdio_rows;

GRANT SELECT ON public.ingest_quality TO service_role;
GRANT SELECT ON public.platform_kpis  TO service_role;

NOTIFY pgrst, 'reload schema';
