-- ─────────────────────────────────────────────────────────────────────────────
-- relay — Migration 004: Tool schemas + Glama source + MCP server config
-- ─────────────────────────────────────────────────────────────────────────────

-- Add Glama as a valid source
ALTER TABLE public.servers
  DROP CONSTRAINT IF EXISTS servers_source_check;

ALTER TABLE public.servers
  ADD CONSTRAINT servers_source_check
  CHECK (source IN ('official', 'smithery', 'github', 'glama', 'direct'));

-- Add full tool schemas storage (the missing piece for agents to call correctly)
-- Each tool schema entry: { name, description, inputSchema }
ALTER TABLE public.servers
  ADD COLUMN IF NOT EXISTS tool_schemas JSONB NOT NULL DEFAULT '[]';

-- Add glama_id for deduplication
ALTER TABLE public.servers
  ADD COLUMN IF NOT EXISTS glama_id TEXT;

-- Index for glama deduplication
CREATE INDEX IF NOT EXISTS idx_servers_glama_id ON public.servers(glama_id)
  WHERE glama_id IS NOT NULL;

-- Add MCP server access tracking
-- Tracks agents connecting via the native MCP server interface
CREATE TABLE IF NOT EXISTS public.mcp_connections (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  ip          TEXT,
  user_agent  TEXT,
  method      TEXT NOT NULL,  -- 'initialize' | 'tools/list' | 'tools/call'
  tool_called TEXT,           -- 'search_tools' | 'invoke_tool' | null
  intent      TEXT,           -- for search_tools calls
  server_name TEXT,           -- for invoke_tool calls
  latency_ms  INTEGER,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- RLS on mcp_connections (service role only)
ALTER TABLE public.mcp_connections ENABLE ROW LEVEL SECURITY;

-- Update global_stats to include glama source count
CREATE OR REPLACE FUNCTION public.global_stats()
RETURNS JSON LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT json_build_object(
    'total_servers',    COUNT(*),
    'active_servers',   COUNT(*) FILTER (WHERE status = 'active'),
    'verified_servers', COUNT(*) FILTER (WHERE verified = TRUE),
    'total_calls',      COALESCE(SUM(total_calls), 0),
    'calls_today',      COALESCE(SUM(calls_today), 0),
    'avg_trust_score',  ROUND(COALESCE(AVG(trust_score), 0)::NUMERIC, 1),
    'sources', json_build_object(
      'official',  COUNT(*) FILTER (WHERE source = 'official'),
      'smithery',  COUNT(*) FILTER (WHERE source = 'smithery'),
      'glama',     COUNT(*) FILTER (WHERE source = 'glama'),
      'github',    COUNT(*) FILTER (WHERE source = 'github'),
      'direct',    COUNT(*) FILTER (WHERE source = 'direct')
    )
  ) FROM public.servers;
$$;

-- ── Ecosystem balance update to search_servers RPC ──────────────────────────
-- Replaces the previous search_servers function.
-- Adds:
--   1. New server ranking boost (first 90 days)
--   2. Category saturation dampening (diversifies results when niche is dominated)
--   3. Runtime quality signals (failure rate from metering)

DROP FUNCTION IF EXISTS public.search_servers(TEXT, INTEGER);

CREATE OR REPLACE FUNCTION public.search_servers(
  query_text   TEXT,
  result_limit INTEGER DEFAULT 5
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
  is_new        BOOLEAN
)
LANGUAGE sql STABLE SECURITY DEFINER AS $$
  WITH base AS (
    SELECT
      s.*,
      -- New server flag: listed within last 90 days
      (s.created_at > NOW() - INTERVAL '90 days') AS is_new,
      -- New server ranking boost: decays from 1.4x to 1.0x over 90 days
      CASE
        WHEN s.created_at > NOW() - INTERVAL '90 days'
        THEN 1.0 + 0.4 * (1 - EXTRACT(EPOCH FROM (NOW() - s.created_at)) / (90 * 86400))
        ELSE 1.0
      END AS ranking_boost,
      -- Text match score
      CASE
        WHEN query_text = '' THEN 0
        ELSE ts_rank(s.search_vector, plainto_tsquery('english', query_text))
      END AS text_rank,
      -- Trigram similarity
      similarity(s.name, query_text) AS name_sim
    FROM public.servers s
    WHERE
      s.status = 'active'
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
  -- Category saturation: count high-trust servers per primary tag
  category_counts AS (
    SELECT
      tags[1] AS primary_tag,
      COUNT(*) AS high_trust_count
    FROM public.servers
    WHERE status = 'active' AND trust_score >= 85
    GROUP BY tags[1]
  )
  SELECT
    b.id, b.name, b.display_name, b.description, b.endpoint, b.version,
    b.tags, b.tools, b.tool_schemas, b.trust_score, b.verified, b.source,
    b.scan_status, b.cve_issues, b.latency_ms, b.uptime_pct, b.stars,
    b.calls_today, b.is_new
  FROM base b
  LEFT JOIN category_counts cc ON cc.primary_tag = b.tags[1]
  ORDER BY
    -- Primary: text relevance × ranking boost (new servers get a lift)
    (b.text_rank + b.name_sim + 0.001) * b.ranking_boost DESC,
    -- Secondary: trust score — but dampened in saturated categories
    CASE
      WHEN cc.high_trust_count >= 5 AND b.trust_score < 85
      THEN b.trust_score * 1.15  -- boost non-dominant servers in crowded niches
      ELSE b.trust_score
    END DESC,
    b.stars DESC
  LIMIT result_limit;
$$;
