-- ─────────────────────────────────────────────────────────────────────────────
-- openMCP — Migration 008: Anomaly detection views
-- Visibility into suspicious traffic patterns without automatic blocking.
-- Query these from the admin panel or Supabase SQL Editor.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── Suspicious IP activity ────────────────────────────────────────────────────
-- IPs with unusually high call volume, high DLP trigger rate,
-- or high error rate in the last hour.
CREATE OR REPLACE VIEW public.suspicious_ips AS
SELECT
  ip,
  COUNT(*)                                                             AS calls_1h,
  COUNT(*) FILTER (WHERE dlp_triggered)                               AS dlp_triggers,
  COUNT(*) FILTER (WHERE status_code = 400)                           AS blocked_calls,
  COUNT(*) FILTER (WHERE status_code = 429)                           AS rate_limited,
  COUNT(DISTINCT server_id)                                           AS servers_hit,
  COUNT(DISTINCT tool_name)                                           AS tools_tried,
  ROUND(100.0 * COUNT(*) FILTER (WHERE dlp_triggered) / NULLIF(COUNT(*), 0), 1) AS dlp_rate_pct,
  ROUND(100.0 * COUNT(*) FILTER (WHERE status_code = 400) / NULLIF(COUNT(*), 0), 1) AS block_rate_pct,
  MIN(created_at)                                                     AS first_seen,
  MAX(created_at)                                                     AS last_seen,
  -- Risk score: higher = more suspicious
  (
    COUNT(*) / 10                                                      -- volume component
    + COUNT(*) FILTER (WHERE dlp_triggered) * 5                       -- DLP hits weighted heavily
    + COUNT(*) FILTER (WHERE status_code = 400) * 3                   -- blocked calls
    + COUNT(DISTINCT server_id) * 2                                    -- scanning many servers
  )::INTEGER                                                           AS risk_score
FROM public.audit_log
WHERE created_at > NOW() - INTERVAL '1 hour'
  AND ip IS NOT NULL
  AND ip != ''
GROUP BY ip
HAVING
  COUNT(*) > 20                          -- only IPs with meaningful volume
  OR COUNT(*) FILTER (WHERE dlp_triggered) > 3    -- or any significant DLP activity
  OR COUNT(DISTINCT server_id) > 10      -- or broad scanning behaviour
ORDER BY risk_score DESC
LIMIT 100;

-- ── Coordinated attack detection ──────────────────────────────────────────────
-- Multiple IPs hitting the same server+tool combo in a tight time window.
-- Botnet signature: many different IPs, same target, coordinated timing.
CREATE OR REPLACE VIEW public.coordinated_patterns AS
SELECT
  server_id,
  tool_name,
  DATE_TRUNC('minute', created_at)                                    AS minute,
  COUNT(*)                                                             AS calls,
  COUNT(DISTINCT ip)                                                   AS unique_ips,
  COUNT(*) FILTER (WHERE dlp_triggered)                               AS dlp_hits,
  -- Coordination signal: many IPs, many calls, tight window
  CASE
    WHEN COUNT(DISTINCT ip) > 10 AND COUNT(*) > 50 THEN 'high'
    WHEN COUNT(DISTINCT ip) > 5  AND COUNT(*) > 20 THEN 'medium'
    ELSE 'low'
  END                                                                  AS threat_level
FROM public.audit_log
WHERE created_at > NOW() - INTERVAL '1 hour'
  AND action IN ('proxy_call', 'mcp_server_invoke')
GROUP BY server_id, tool_name, DATE_TRUNC('minute', created_at)
HAVING COUNT(DISTINCT ip) > 3
ORDER BY unique_ips DESC, calls DESC;

-- ── New IP velocity check ──────────────────────────────────────────────────────
-- IPs that appeared for the first time in the last 10 minutes
-- and immediately made proxy calls. Legitimate users typically browse first.
CREATE OR REPLACE VIEW public.new_ip_velocity AS
SELECT
  ip,
  MIN(created_at)                                                      AS first_call_at,
  COUNT(*)                                                             AS total_calls,
  COUNT(*) FILTER (WHERE action LIKE 'proxy_%')                       AS proxy_calls,
  COUNT(*) FILTER (WHERE dlp_triggered)                               AS dlp_hits,
  COUNT(DISTINCT server_id)                                           AS servers_targeted,
  -- Flag: proxy calls with no prior search activity
  COUNT(*) FILTER (WHERE action LIKE 'proxy_%') > 0
    AND COUNT(*) FILTER (WHERE action = 'search') = 0                 AS no_search_first
FROM public.audit_log
WHERE
  ip NOT IN (
    SELECT DISTINCT ip FROM public.audit_log
    WHERE created_at < NOW() - INTERVAL '10 minutes'
      AND ip IS NOT NULL
  )
  AND created_at > NOW() - INTERVAL '10 minutes'
  AND ip IS NOT NULL
GROUP BY ip
HAVING COUNT(*) > 3
ORDER BY proxy_calls DESC;

-- ── Global rate summary (1h) ───────────────────────────────────────────────────
-- Quick overview of traffic health. Run this first when investigating.
-- SELECT * FROM rate_summary;
CREATE OR REPLACE VIEW public.rate_summary AS
SELECT
  DATE_TRUNC('minute', created_at)                                    AS minute,
  COUNT(*)                                                             AS total_calls,
  COUNT(DISTINCT ip)                                                   AS unique_ips,
  COUNT(*) FILTER (WHERE dlp_triggered)                               AS dlp_triggers,
  COUNT(*) FILTER (WHERE status_code = 400)                           AS blocked,
  COUNT(*) FILTER (WHERE status_code = 429)                           AS rate_limited,
  COUNT(*) FILTER (WHERE status_code >= 500)                          AS errors,
  ROUND(AVG(latency_ms))::INTEGER                                     AS avg_latency_ms
FROM public.audit_log
WHERE created_at > NOW() - INTERVAL '1 hour'
GROUP BY DATE_TRUNC('minute', created_at)
ORDER BY minute DESC;

-- ── Grant service role access ─────────────────────────────────────────────────
GRANT SELECT ON public.suspicious_ips       TO service_role;
GRANT SELECT ON public.coordinated_patterns TO service_role;
GRANT SELECT ON public.new_ip_velocity      TO service_role;
GRANT SELECT ON public.rate_summary         TO service_role;

-- ── How to use ────────────────────────────────────────────────────────────────
-- Quick health check:
--   SELECT * FROM rate_summary LIMIT 10;
--
-- See suspicious IPs right now:
--   SELECT * FROM suspicious_ips WHERE risk_score > 50;
--
-- Check for coordinated attacks:
--   SELECT * FROM coordinated_patterns WHERE threat_level = 'high';
--
-- Block a suspicious IP (manual, via Vercel dashboard or middleware):
--   Note the IP from suspicious_ips, add to Vercel IP blocking rules.
