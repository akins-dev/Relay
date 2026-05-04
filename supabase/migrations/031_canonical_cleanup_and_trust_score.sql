-- Migration: 031_canonical_cleanup_and_trust_score
--
-- Summary of changes:
--   1. Add `is_canonical` column — marks Smithery's own curated servers (bySmithery=true).
--      These float to the top of search results via ORDER BY is_canonical DESC.
--   2. Add `use_count` column — real usage count from Smithery listing API.
--      Grade B trust signal in the redesigned trust score formula.
--   3. Migrate `source = 'partner'` rows → `source = 'direct'`.
--      The partner source was based on a hallucinated GitHub org (github.com/mcp).
--   4. Update source_check constraint: remove 'partner' from active sources (keep in legacy block).
--   5. Update global_stats() — remove 'partner' counter.
--   6. Update search_servers() — add is_canonical to SELECT + ORDER BY is_canonical DESC.

-- ── 1. Add is_canonical column ────────────────────────────────────────────────
-- True when Smithery itself built and hosts this server (bySmithery: true).
-- These are Smithery's own curated integrations (Gmail, GitHub, Google Sheets, etc.).
-- Default false for all existing rows; updated by the next Smithery ingest run.

ALTER TABLE public.servers
  ADD COLUMN IF NOT EXISTS is_canonical BOOLEAN NOT NULL DEFAULT FALSE;

COMMENT ON COLUMN public.servers.is_canonical IS
  'True when Smithery itself built and hosts this server (bySmithery: true in listing API). '
  'These are Smithery''s own curated integrations — the canonical choice for their domain. '
  'Drives ORDER BY is_canonical DESC in search_servers() for superior ranking.';

-- ── 2. Add use_count column ───────────────────────────────────────────────────
-- Real-world usage count from Smithery listing API (useCount field).
-- Grade B signal in the trust score formula (log scale, max 15 pts).
-- NULL for non-Smithery servers. 0 for Smithery servers with no recorded usage.

ALTER TABLE public.servers
  ADD COLUMN IF NOT EXISTS use_count INTEGER;

COMMENT ON COLUMN public.servers.use_count IS
  'Real-world agent invocation count from Smithery (useCount field). '
  'NULL for non-Smithery sources. Used in trust score (log scale, max 15 pts).';

-- ── 3. Migrate partner rows → direct ─────────────────────────────────────────
-- The partner source was a hallucinated GitHub org scraper. Any rows that were
-- written with source='partner' are migrated to source='direct' (self-submitted).

UPDATE public.servers
  SET source = 'direct'
  WHERE source = 'partner';

-- ── 4. Update source_check constraint ─────────────────────────────────────────
-- Remove 'partner' from active sources. Retain it in the legacy block since
-- the UPDATE above should handle all existing rows, but keep it for safety
-- in case there are any rows we missed.

ALTER TABLE public.servers DROP CONSTRAINT IF EXISTS servers_source_check;

ALTER TABLE public.servers ADD CONSTRAINT servers_source_check
  CHECK (source IN (
    -- Active ingestion sources
    'official', 'smithery', 'glama', 'mcp_directory', 'direct',
    -- Legacy sources (historical data only — no new writes)
    'partner', 'github', 'pulsemcp', 'claudemcp', 'mcpso', 'mcp_run', 'composio'
  ));

-- ── 5. Update global_stats() ─────────────────────────────────────────────────
-- Removes 'partner' counter. Adds 'canonical_servers' count.

CREATE OR REPLACE FUNCTION public.global_stats()
RETURNS JSON LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT json_build_object(
    'total_servers',       COUNT(*),
    'active_servers',      COUNT(*) FILTER (WHERE status = 'active'),
    'pending_servers',     COUNT(*) FILTER (WHERE status::text = 'pending_review'),
    'invokable_servers',   COUNT(*) FILTER (WHERE status = 'active' AND COALESCE(transport, 'unknown') != 'stdio'),
    'local_servers',       COUNT(*) FILTER (WHERE status = 'active' AND transport = 'stdio'),
    'verified_servers',    COUNT(*) FILTER (WHERE verified = TRUE),
    'canonical_servers',   COUNT(*) FILTER (WHERE is_canonical = TRUE),
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
      'direct',        COUNT(*) FILTER (WHERE source = 'direct'),
      'github',        COUNT(*) FILTER (WHERE source = 'github'),
      'pulsemcp',      COUNT(*) FILTER (WHERE source = 'pulsemcp'),
      'claudemcp',     COUNT(*) FILTER (WHERE source = 'claudemcp')
    )
  ) FROM public.servers;
$$;

-- ── 6. Update search_servers() ───────────────────────────────────────────────
-- Adds is_canonical to the return set and to ORDER BY (DESC — canonical first).
-- is_canonical DESC is the primary sort key within each relevance band, so
-- Smithery's own curated servers (bySmithery=true) always outrank community
-- alternatives when intent is the same (e.g. "use GitHub").

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
  is_canonical    BOOLEAN,
  source          TEXT,
  scan_status     TEXT,
  cve_issues      JSONB,
  latency_ms      INTEGER,
  uptime_pct      NUMERIC,
  stars           INTEGER,
  use_count       INTEGER,
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
    b.trust_score, b.verified, b.is_canonical, b.source,
    b.scan_status, b.cve_issues, b.latency_ms, b.uptime_pct, b.stars,
    b.use_count, b.calls_today, b.is_new, b.transport, b.proxy_available,
    b.auth_type, b.auth_setup_url
  FROM base b
  LEFT JOIN category_counts cc ON cc.primary_tag = b.tags[1]
  ORDER BY
    -- Canonical servers (bySmithery=true) always rank first within each relevance band.
    b.is_canonical DESC,
    -- Semantic + name similarity weighted by new-server boost.
    (b.text_rank + b.name_sim + 0.001) * b.ranking_boost DESC,
    -- Diversity boost for under-represented categories.
    CASE
      WHEN cc.high_trust_count >= 5 AND b.trust_score < 85
      THEN b.trust_score * 1.15
      ELSE b.trust_score
    END DESC,
    -- Usage count as final tiebreaker.
    COALESCE(b.use_count, 0) DESC
  LIMIT result_limit;
$$;

NOTIFY pgrst, 'reload schema';
