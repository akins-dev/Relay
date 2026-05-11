-- Migration 020: Add github_url to search_servers output
DROP FUNCTION IF EXISTS public.search_servers(TEXT, INTEGER);

CREATE OR REPLACE FUNCTION public.search_servers(
  query_text   TEXT,
  result_limit INTEGER DEFAULT 10
)
RETURNS TABLE (
  id            UUID,
  name          TEXT,
  display_name  TEXT,
  description   TEXT,
  endpoint      TEXT,
  version       TEXT,
  github_url    TEXT,
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
    WHERE s.status = 'active'
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
    WHERE status = 'active' AND trust_score >= 85
    GROUP BY tags[1]
  )
  SELECT
    b.id, b.name, b.display_name, b.description, b.endpoint, b.version, b.github_url,
    b.tags, b.tools, b.tool_schemas, b.trust_score, b.verified, b.source,
    b.scan_status, b.cve_issues, b.latency_ms, b.uptime_pct, b.stars,
    b.calls_today, b.is_new
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
