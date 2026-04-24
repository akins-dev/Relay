-- Migration 025: Ingest MVP contract fixes
--
-- Goals:
-- 1. Keep `partner` as the canonical trusted-organization source label.
-- 2. Restore a stable search_servers(...) contract with include_stdio support.
-- 3. Bring global_stats() forward to the latest source set.

-- Backfill any lingering legacy label
UPDATE public.servers
SET source = 'partner'
WHERE source = 'vendor';

ALTER TABLE public.servers
  DROP CONSTRAINT IF EXISTS servers_source_check;

ALTER TABLE public.servers
  ADD CONSTRAINT servers_source_check
  CHECK (source IN (
    'official', 'smithery', 'github', 'glama',
    'pulsemcp', 'direct', 'partner', 'claudemcp',
    'mcpso', 'mcp_run', 'composio'
  ));

DROP FUNCTION IF EXISTS public.search_servers(TEXT, INTEGER);
DROP FUNCTION IF EXISTS public.search_servers(TEXT, INTEGER, BOOLEAN);

CREATE OR REPLACE FUNCTION public.search_servers(
  query_text    TEXT,
  result_limit  INTEGER DEFAULT 10,
  include_stdio BOOLEAN DEFAULT FALSE
)
RETURNS TABLE (
  id             UUID,
  name           TEXT,
  display_name   TEXT,
  description    TEXT,
  endpoint       TEXT,
  version        TEXT,
  github_url     TEXT,
  tags           TEXT[],
  tools          TEXT[],
  tool_schemas   JSONB,
  trust_score    NUMERIC,
  verified       BOOLEAN,
  source         TEXT,
  scan_status    TEXT,
  cve_issues     JSONB,
  latency_ms     INTEGER,
  uptime_pct     NUMERIC,
  stars          INTEGER,
  calls_today    INTEGER,
  is_new         BOOLEAN,
  transport      TEXT,
  proxy_available BOOLEAN,
  auth_type      TEXT,
  auth_setup_url TEXT
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
    b.id, b.name, b.display_name, b.description, b.endpoint, b.version, b.github_url,
    b.tags, b.tools, b.tool_schemas, b.trust_score, b.verified, b.source,
    b.scan_status, b.cve_issues, b.latency_ms, b.uptime_pct, b.stars,
    b.calls_today, b.is_new, b.transport, b.proxy_available, b.auth_type, b.auth_setup_url
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

CREATE OR REPLACE FUNCTION public.global_stats()
RETURNS JSON LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT json_build_object(
    'total_servers',       COUNT(*),
    'active_servers',      COUNT(*) FILTER (WHERE status = 'active'),
    'pending_servers',     COUNT(*) FILTER (WHERE status::text = 'pending_review'),
    'invokable_servers',   COUNT(*) FILTER (WHERE status = 'active' AND COALESCE(transport, 'unknown') != 'stdio'),
    'local_servers',       COUNT(*) FILTER (WHERE status = 'active' AND transport = 'stdio'),
    'verified_servers',    COUNT(*) FILTER (WHERE verified = TRUE),
    'discovered_servers',  COUNT(*) FILTER (WHERE status IN ('active', 'pending_review')),
    'total_calls',         COALESCE(SUM(total_calls), 0),
    'calls_today',         COALESCE(SUM(calls_today), 0),
    'avg_trust_score',     ROUND(COALESCE(AVG(trust_score) FILTER (WHERE status IN ('active', 'pending_review')), 0)::NUMERIC, 1),
    'sources', json_build_object(
      'official',  COUNT(*) FILTER (WHERE source = 'official'),
      'smithery',  COUNT(*) FILTER (WHERE source = 'smithery'),
      'glama',     COUNT(*) FILTER (WHERE source = 'glama'),
      'pulsemcp',  COUNT(*) FILTER (WHERE source = 'pulsemcp'),
      'github',    COUNT(*) FILTER (WHERE source = 'github'),
      'direct',    COUNT(*) FILTER (WHERE source = 'direct'),
      'partner',   COUNT(*) FILTER (WHERE source = 'partner'),
      'claudemcp', COUNT(*) FILTER (WHERE source = 'claudemcp'),
      'mcpso',     COUNT(*) FILTER (WHERE source = 'mcpso'),
      'mcp_run',   COUNT(*) FILTER (WHERE source = 'mcp_run'),
      'composio',  COUNT(*) FILTER (WHERE source = 'composio')
    )
  ) FROM public.servers;
$$;

NOTIFY pgrst, 'reload schema';
