-- ─────────────────────────────────────────────────────────────────────────────
-- openMCP — Migration 010: Auth transparency + public audit log access
-- ─────────────────────────────────────────────────────────────────────────────

-- ── Auth transparency on servers ──────────────────────────────────────────────
-- Tells agents upfront whether a server requires credential setup
-- and what kind of auth it uses
ALTER TABLE public.servers
  ADD COLUMN IF NOT EXISTS auth_type TEXT NOT NULL DEFAULT 'managed'
    CHECK (auth_type IN (
      'none',      -- fully public, no credentials needed (weather, public data APIs)
      'managed',   -- server manages OAuth / credentials internally (most hosted servers)
      'key_param' -- server expects credentials as arguments (bad design, DLP will block)
    )),
  ADD COLUMN IF NOT EXISTS auth_setup_url TEXT;  -- link to OAuth/connection setup

-- Update servers where we can infer auth_type
-- Public data servers (no auth needed)
UPDATE public.servers
SET auth_type = 'none'
WHERE (
  'weather' = ANY(tags) OR
  'news' = ANY(tags) OR
  'public-data' = ANY(tags) OR
  'wikipedia' = ANY(tags) OR
  'search' = ANY(tags)
) AND verified = FALSE;  -- only for community servers, not verified ones

-- ── Audit log — tiered public access ──────────────────────────────────────────
-- Public: aggregate stats per server (no IPs, no DLP details, no user info)
-- Server authors: full log for their servers (minus IPs)
-- Admin: everything

-- Drop existing policy
DROP POLICY IF EXISTS "audit_author_read" ON public.audit_log;

-- Public policy: aggregate view only (enforced in the view below, not raw table)
-- Raw table: server authors only
CREATE POLICY "audit_author_read"
  ON public.audit_log FOR SELECT TO authenticated
  USING (
    server_id IN (
      SELECT id FROM public.servers WHERE author_id = auth.uid()
    )
    OR auth.uid() IN (
      -- Admin override (set via service role or admin flag in profiles)
      SELECT id FROM public.profiles WHERE id = auth.uid()
      AND id::TEXT = current_setting('app.admin_uid', TRUE)
    )
  );

-- ── Public audit summary view ─────────────────────────────────────────────────
-- What anyone can see: aggregate stats per server, no PII
-- Used to build trust: "we processed X calls, Y% had DLP events, all blocked"
CREATE OR REPLACE VIEW public.audit_summary AS
SELECT
  s.name                                                          AS server_name,
  s.display_name,
  DATE(al.created_at)                                            AS day,
  COUNT(*)                                                        AS total_calls,
  COUNT(*) FILTER (WHERE al.status_code = 200)                   AS successful_calls,
  COUNT(*) FILTER (WHERE al.status_code = 400)                   AS blocked_calls,
  COUNT(*) FILTER (WHERE al.status_code >= 500)                  AS error_calls,
  COUNT(*) FILTER (WHERE al.dlp_triggered)                       AS dlp_events,
  ROUND(100.0 * COUNT(*) FILTER (WHERE al.dlp_triggered) / NULLIF(COUNT(*), 0), 2) AS dlp_rate_pct,
  ROUND(AVG(al.latency_ms))::INTEGER                             AS avg_latency_ms,
  -- No IPs, no DLP details, no user info — public aggregates only
  MIN(al.created_at)                                             AS first_call,
  MAX(al.created_at)                                             AS last_call
FROM public.audit_log al
JOIN public.servers s ON s.id = al.server_id
WHERE al.created_at > NOW() - INTERVAL '30 days'
GROUP BY s.name, s.display_name, DATE(al.created_at)
ORDER BY day DESC, total_calls DESC;

-- Publicly accessible
GRANT SELECT ON public.audit_summary TO anon, authenticated;

-- ── Platform transparency view ────────────────────────────────────────────────
-- What anyone can see about the platform overall
CREATE OR REPLACE VIEW public.platform_transparency AS
SELECT
  COUNT(*)                                                        AS total_calls_30d,
  COUNT(*) FILTER (WHERE dlp_triggered)                          AS dlp_events_30d,
  COUNT(*) FILTER (WHERE status_code = 400)                      AS blocked_calls_30d,
  COUNT(DISTINCT server_id)                                       AS active_servers_30d,
  ROUND(AVG(latency_ms))::INTEGER                                AS avg_latency_ms,
  ROUND(100.0 * COUNT(*) FILTER (WHERE dlp_triggered) / NULLIF(COUNT(*), 0), 3) AS dlp_rate_pct
FROM public.audit_log
WHERE created_at > NOW() - INTERVAL '30 days';

GRANT SELECT ON public.platform_transparency TO anon, authenticated;

-- ── Update search RPC to include auth_type ────────────────────────────────────
-- Agents need to know upfront whether they need to set up auth
-- before attempting to call a tool
CREATE OR REPLACE FUNCTION public.search_servers(
  query_text    TEXT,
  result_limit  INTEGER DEFAULT 5,
  include_stdio BOOLEAN DEFAULT FALSE
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
  transport     TEXT,
  auth_type     TEXT,
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
    WHERE status = 'active' AND trust_score >= 85 AND transport != 'stdio'
    GROUP BY tags[1]
  )
  SELECT
    b.id, b.name, b.display_name, b.description, b.endpoint, b.version,
    b.tags, b.tools, b.tool_schemas, b.trust_score, b.verified, b.source,
    b.scan_status, b.cve_issues, b.latency_ms, b.uptime_pct, b.stars,
    b.calls_today, b.is_new, b.transport,
    b.auth_type,
    b.auth_setup_url
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
