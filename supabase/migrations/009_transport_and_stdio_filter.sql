-- ─────────────────────────────────────────────────────────────────────────────
-- relay — Migration 009: Transport type + stdio exclusion from agent search
-- ─────────────────────────────────────────────────────────────────────────────

-- Add transport column to servers table
-- Determines whether a server is invokable through the relay proxy
ALTER TABLE public.servers
  ADD COLUMN IF NOT EXISTS transport TEXT NOT NULL DEFAULT 'unknown'
    CHECK (transport IN ('stdio', 'sse', 'streamable_http', 'unknown'));

-- Index for fast transport filtering
CREATE INDEX IF NOT EXISTS idx_servers_transport ON public.servers(transport);

-- ── Logic for transport detection ─────────────────────────────────────────────
-- During ingest, transport is set based on the endpoint field:
--
-- endpoint starts with http:// or https://     → 'sse' or 'streamable_http' (unknown until probed)
-- endpoint is a GitHub repo URL                → 'stdio' (local process only)
-- endpoint is a file path or command name      → 'stdio'
-- endpoint is empty or null                   → 'unknown'
--
-- After first successful proxy call, transport is updated to the actual transport used.
-- search_servers() only returns non-stdio servers.

-- ── Backfill existing servers based on endpoint ───────────────────────────────
UPDATE public.servers
SET transport = CASE
  WHEN endpoint LIKE 'https://%' OR endpoint LIKE 'http://%'
    THEN 'sse'                    -- assume SSE until proven otherwise; proxy updates on first call
  WHEN endpoint LIKE 'github.com/%' OR endpoint LIKE 'https://github.com/%'
    THEN 'stdio'
  WHEN endpoint = '' OR endpoint IS NULL
    THEN 'unknown'
  ELSE 'stdio'                    -- anything else (file paths, commands) is local only
END
WHERE transport = 'unknown';

-- ── Update search_servers RPC to exclude stdio ────────────────────────────────
-- Agents should only discover servers they can actually invoke through the proxy.
-- stdio servers are listed in the human browse UI but not returned in search.

DROP FUNCTION IF EXISTS public.search_servers(TEXT, INTEGER);
DROP FUNCTION IF EXISTS public.search_servers(TEXT, INTEGER, BOOLEAN);

CREATE OR REPLACE FUNCTION public.search_servers(
  query_text   TEXT,
  result_limit INTEGER DEFAULT 5,
  include_stdio BOOLEAN DEFAULT FALSE  -- pass TRUE for human browse UI, FALSE for agents
)
RETURNS TABLE (
  id            UUID,
  name          TEXT,
  display_name  TEXT,
  description   TEXT,
  endpoint      TEXT,
  version       TEXT,
  tags          TEXT[],
  tools         TEXT[],
  tool_schemas  JSONB,
  trust_score   NUMERIC,
  verified      BOOLEAN,
  source        TEXT,
  scan_status   TEXT,
  cve_issues    JSONB,
  latency_ms    INTEGER,
  uptime_pct    NUMERIC,
  stars         INTEGER,
  calls_today   INTEGER,
  is_new        BOOLEAN,
  transport     TEXT
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
      -- Core filter: exclude stdio unless explicitly requested (human browse)
      AND (include_stdio OR s.transport != 'stdio')
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
    SELECT
      tags[1] AS primary_tag,
      COUNT(*) AS high_trust_count
    FROM public.servers
    WHERE status = 'active' AND trust_score >= 85
      AND transport != 'stdio'
    GROUP BY tags[1]
  )
  SELECT
    b.id, b.name, b.display_name, b.description, b.endpoint, b.version,
    b.tags, b.tools, b.tool_schemas, b.trust_score, b.verified, b.source,
    b.scan_status, b.cve_issues, b.latency_ms, b.uptime_pct, b.stars,
    b.calls_today, b.is_new, b.transport
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

-- ── Update global_stats to distinguish stdio vs invokable ─────────────────────
CREATE OR REPLACE FUNCTION public.global_stats()
RETURNS JSON LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT json_build_object(
    'total_servers',       COUNT(*),
    'active_servers',      COUNT(*) FILTER (WHERE status = 'active'),
    'invokable_servers',   COUNT(*) FILTER (WHERE status = 'active' AND transport != 'stdio'),
    'local_servers',       COUNT(*) FILTER (WHERE status = 'active' AND transport = 'stdio'),
    'verified_servers',    COUNT(*) FILTER (WHERE verified = TRUE),
    'total_calls',         COALESCE(SUM(total_calls), 0),
    'calls_today',         COALESCE(SUM(calls_today), 0),
    'avg_trust_score',     ROUND(COALESCE(AVG(trust_score) FILTER (WHERE status = 'active'), 0)::NUMERIC, 1),
    'sources', json_build_object(
      'official',  COUNT(*) FILTER (WHERE source = 'official'),
      'smithery',  COUNT(*) FILTER (WHERE source = 'smithery'),
      'glama',     COUNT(*) FILTER (WHERE source = 'glama'),
      'pulsemcp',  COUNT(*) FILTER (WHERE source = 'direct'),
      'github',    COUNT(*) FILTER (WHERE source = 'github'),
      'direct',    COUNT(*) FILTER (WHERE source = 'direct')
    )
  ) FROM public.servers;
$$;

-- ── LocalServerView for human browse (shows stdio with clear label) ──────────
CREATE OR REPLACE VIEW public.local_servers AS
SELECT
  id, name, display_name, description, tags, tools, tool_schemas,
  trust_score, verified, source, github_url, homepage_url,
  created_at, updated_at
FROM public.servers
WHERE status = 'active' AND transport = 'stdio'
ORDER BY trust_score DESC, stars DESC;

GRANT SELECT ON public.local_servers TO anon, authenticated;
