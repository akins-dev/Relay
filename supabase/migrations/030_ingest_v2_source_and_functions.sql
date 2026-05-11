-- Migration: 030_ingest_v2_source_and_functions
--
-- Builds on 029_ingest_v2_fields.
-- Adds: mcp_directory source to constraint, updated global_stats(),
--       updated search_servers() returning icon_url + env_var_schema + package_info,
--       backfill of fake version strings to null.

-- ── 1. Update source_check constraint to include mcp_directory ────────────────
-- Migration 025 set this constraint but didn't include mcp_directory.

ALTER TABLE public.servers DROP CONSTRAINT IF EXISTS servers_source_check;

ALTER TABLE public.servers ADD CONSTRAINT servers_source_check
  CHECK (source IN (
    -- Active sources
    'official', 'smithery', 'glama', 'mcp_directory', 'partner', 'direct',
    -- Legacy sources (existing data)
    'github', 'pulsemcp', 'claudemcp', 'mcpso', 'mcp_run', 'composio'
  ));

-- ── 2. Backfill fake version strings to null ──────────────────────────────────
-- Older ingestion used '0.0.0' or '1.0.0' as placeholder versions for
-- Smithery/Glama servers that don't actually version their listings.
-- Now that version is nullable, replace with honest null.

UPDATE public.servers
SET version = NULL
WHERE version IN ('0.0.0', '1.0.0')
  AND source NOT IN ('official', 'partner');

-- ── 3. Update global_stats() ──────────────────────────────────────────────────
-- Adds: mcp_directory source counter, with_tools, with_env_schema, grade_a_ready

CREATE OR REPLACE FUNCTION public.global_stats()
RETURNS JSON LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT json_build_object(
    'total_servers',       COUNT(*),
    'active_servers',      COUNT(*) FILTER (WHERE status = 'active'),
    'pending_servers',     COUNT(*) FILTER (WHERE status::text = 'pending_review'),
    'invokable_servers',   COUNT(*) FILTER (WHERE status = 'active' AND COALESCE(transport, 'unknown') != 'stdio'),
    'local_servers',       COUNT(*) FILTER (WHERE status = 'active' AND transport = 'stdio'),
    'verified_servers',    COUNT(*) FILTER (WHERE verified = TRUE),
    'with_tools',          COUNT(*) FILTER (WHERE array_length(tools, 1) > 0),
    'with_env_schema',     COUNT(*) FILTER (WHERE env_var_schema IS NOT NULL),
    'grade_a_ready',       COUNT(*) FILTER (
                             WHERE status = 'active'
                               AND array_length(tools, 1) > 0
                               AND env_var_schema IS NOT NULL
                               AND (endpoint IS NOT NULL OR package_info IS NOT NULL)
                           ),
    'discovered_servers',  COUNT(*) FILTER (WHERE status IN ('active', 'pending_review')),
    'total_calls',         COALESCE(SUM(total_calls), 0),
    'calls_today',         COALESCE(SUM(calls_today), 0),
    'avg_trust_score',     ROUND(COALESCE(AVG(trust_score) FILTER (WHERE status IN ('active', 'pending_review')), 0)::NUMERIC, 1),
    'sources', json_build_object(
      'official',      COUNT(*) FILTER (WHERE source = 'official'),
      'smithery',      COUNT(*) FILTER (WHERE source = 'smithery'),
      'glama',         COUNT(*) FILTER (WHERE source = 'glama'),
      'mcp_directory', COUNT(*) FILTER (WHERE source = 'mcp_directory'),
      'partner',       COUNT(*) FILTER (WHERE source = 'partner'),
      'direct',        COUNT(*) FILTER (WHERE source = 'direct'),
      'github',        COUNT(*) FILTER (WHERE source = 'github'),
      'pulsemcp',      COUNT(*) FILTER (WHERE source = 'pulsemcp'),
      'claudemcp',     COUNT(*) FILTER (WHERE source = 'claudemcp')
    )
  ) FROM public.servers;
$$;

-- ── 4. Update search_servers() to return new Grade-A fields ──────────────────
-- Adds icon_url, env_var_schema, package_info to the return set.
-- These are needed by search_tools (for display) and invoke_tool (for routing).

DROP FUNCTION IF EXISTS public.search_servers(TEXT, INTEGER, BOOLEAN);

CREATE OR REPLACE FUNCTION public.search_servers(
  query_text    TEXT,
  result_limit  INTEGER DEFAULT 10,
  include_stdio BOOLEAN DEFAULT FALSE
)
RETURNS TABLE (
  id              UUID,
  name            TEXT,
  display_name    TEXT,
  description     TEXT,
  endpoint        TEXT,
  version         TEXT,
  github_url      TEXT,
  icon_url        TEXT,
  tags            TEXT[],
  tools           TEXT[],
  tool_schemas    JSONB,
  env_var_schema  JSONB,
  package_info    JSONB,
  trust_score     NUMERIC,
  verified        BOOLEAN,
  source          TEXT,
  scan_status     TEXT,
  cve_issues      JSONB,
  latency_ms      INTEGER,
  uptime_pct      NUMERIC,
  stars           INTEGER,
  calls_today     INTEGER,
  is_new          BOOLEAN,
  transport       TEXT,
  proxy_available BOOLEAN,
  auth_type       TEXT,
  auth_setup_url  TEXT
)
LANGUAGE sql STABLE SECURITY DEFINER AS $$
  WITH base AS (
    SELECT
      s.*,
      (s.created_at > NOW() - INTERVAL '90 days') AS is_new,
      CASE
        WHEN s.created_at > NOW() - INTERVAL '90 days'
        THEN 1.0 + 0.4 * (1 - EXTRACT(EPOCH FROM (NOW() - s.created_at)) / (90 * 86400))
        ELSE 1.0
      END AS ranking_boost,
      CASE
        WHEN query_text = '' THEN 0
        ELSE ts_rank(s.search_vector, plainto_tsquery('english', query_text))
      END AS text_rank,
      similarity(s.name, query_text) AS name_sim
    FROM public.servers s
    WHERE
      s.status = 'active'
      AND (include_stdio OR COALESCE(s.transport, 'unknown') != 'stdio')
      AND (
        query_text = ''
        OR s.search_vector @@ plainto_tsquery('english', query_text)
        OR similarity(s.name, query_text) > 0.15
        OR EXISTS (
          SELECT 1 FROM unnest(s.tags) t(tag)
          WHERE t.tag ILIKE '%' || query_text || '%'
        )
      )
  ),
  category_counts AS (
    SELECT tags[1] AS primary_tag, COUNT(*) AS high_trust_count
    FROM public.servers
    WHERE status = 'active'
      AND trust_score >= 85
      AND COALESCE(transport, 'unknown') != 'stdio'
    GROUP BY tags[1]
  )
  SELECT
    b.id, b.name, b.display_name, b.description, b.endpoint, b.version,
    b.github_url, b.icon_url, b.tags, b.tools, b.tool_schemas,
    b.env_var_schema, b.package_info,
    b.trust_score, b.verified, b.source,
    b.scan_status, b.cve_issues, b.latency_ms, b.uptime_pct, b.stars,
    b.calls_today, b.is_new, b.transport, b.proxy_available,
    b.auth_type, b.auth_setup_url
  FROM base b
  LEFT JOIN category_counts cc ON cc.primary_tag = b.tags[1]
  ORDER BY
    (b.text_rank + b.name_sim + 0.001) * b.ranking_boost DESC,
    CASE
      WHEN cc.high_trust_count >= 5 AND b.trust_score < 85
      THEN b.trust_score * 1.15
      ELSE b.trust_score
    END DESC,
    b.stars DESC
  LIMIT result_limit;
$$;

NOTIFY pgrst, 'reload schema';
