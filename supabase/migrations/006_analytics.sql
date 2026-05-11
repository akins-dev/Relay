-- ─────────────────────────────────────────────────────────────────────────────
-- relay — Migration 006: Detailed analytics views
-- Run after 005_metering.sql
-- ─────────────────────────────────────────────────────────────────────────────

-- ── Server health dashboard ───────────────────────────────────────────────────
CREATE OR REPLACE VIEW public.server_health AS
SELECT
  s.id,
  s.name,
  s.display_name,
  s.source,
  s.trust_score,
  s.verified,
  s.scan_status,
  s.status,
  s.latency_ms,
  s.uptime_pct,
  s.stars,
  s.total_calls,
  s.calls_today,
  s.last_scanned_at,
  jsonb_array_length(s.cve_issues)  AS cve_count,
  jsonb_array_length(s.scan_issues) AS scan_issue_count,
  -- DLP trigger rate from metering
  COALESCE((
    SELECT ROUND(100.0 * COUNT(*) FILTER (WHERE dlp_triggered) / NULLIF(COUNT(*), 0), 2)
    FROM public.metering_events m
    WHERE m.server_id = s.id
      AND m.created_at > NOW() - INTERVAL '7 days'
  ), 0) AS dlp_trigger_rate_7d,
  -- Avg latency from metering (more accurate than stored value)
  (
    SELECT AVG(latency_ms)::INTEGER
    FROM public.metering_events m
    WHERE m.server_id = s.id
      AND m.created_at > NOW() - INTERVAL '7 days'
  ) AS measured_latency_7d,
  s.created_at,
  s.updated_at
FROM public.servers s;

-- ── Ingest quality report ─────────────────────────────────────────────────────
CREATE OR REPLACE VIEW public.ingest_quality AS
SELECT
  source,
  COUNT(*)                                              AS total_servers,
  COUNT(*) FILTER (WHERE status = 'active')            AS active_servers,
  COUNT(*) FILTER (WHERE status = 'rejected')          AS rejected_servers,
  COUNT(*) FILTER (WHERE verified = TRUE)              AS verified_servers,
  COUNT(*) FILTER (WHERE scan_status = 'passed')       AS scan_passed,
  COUNT(*) FILTER (WHERE scan_status = 'failed')       AS scan_failed,
  COUNT(*) FILTER (WHERE cve_issues != '[]'::jsonb)    AS has_cve_issues,
  ROUND(AVG(trust_score), 1)                           AS avg_trust_score,
  ROUND(100.0 * COUNT(*) FILTER (WHERE status = 'rejected') / NULLIF(COUNT(*), 0), 1) AS rejection_rate_pct
FROM public.servers
GROUP BY source
ORDER BY total_servers DESC;

-- ── Security threat analysis ──────────────────────────────────────────────────
CREATE OR REPLACE VIEW public.security_threats AS
SELECT
  DATE(created_at)                                      AS day,
  COUNT(*)                                              AS total_calls,
  COUNT(*) FILTER (WHERE dlp_triggered)                 AS dlp_triggers,
  COUNT(*) FILTER (WHERE status_code = 400)             AS blocked_calls,
  COUNT(*) FILTER (WHERE status_code = 429)             AS rate_limited,
  COUNT(*) FILTER (WHERE status_code >= 500)            AS upstream_errors,
  ROUND(100.0 * COUNT(*) FILTER (WHERE dlp_triggered) / NULLIF(COUNT(*), 0), 2) AS dlp_rate_pct,
  ROUND(AVG(latency_ms))::INTEGER                       AS avg_latency_ms,
  SUM(request_bytes)                                    AS total_request_bytes,
  SUM(response_bytes)                                   AS total_response_bytes
FROM public.metering_events
WHERE created_at > NOW() - INTERVAL '90 days'
GROUP BY DATE(created_at)
ORDER BY day DESC;

-- ── Top servers by usage ──────────────────────────────────────────────────────
CREATE OR REPLACE VIEW public.top_servers_by_usage AS
SELECT
  s.name,
  s.display_name,
  s.source,
  s.trust_score,
  s.verified,
  s.scan_status,
  COUNT(m.id)                                           AS calls_30d,
  COUNT(m.id) FILTER (WHERE m.dlp_triggered)           AS dlp_triggers_30d,
  COUNT(DISTINCT m.user_id)                             AS unique_callers_30d,
  ROUND(AVG(m.latency_ms))::INTEGER                     AS avg_latency_30d,
  ROUND(100.0 * COUNT(m.id) FILTER (WHERE m.status_code >= 400) / NULLIF(COUNT(m.id), 0), 2) AS error_rate_pct
FROM public.servers s
LEFT JOIN public.metering_events m
  ON m.server_id = s.id
  AND m.created_at > NOW() - INTERVAL '30 days'
GROUP BY s.id, s.name, s.display_name, s.source, s.trust_score, s.verified, s.scan_status
ORDER BY calls_30d DESC;

-- ── User activity summary ─────────────────────────────────────────────────────
CREATE OR REPLACE VIEW public.user_activity AS
SELECT
  p.id,
  p.username,
  p.created_at                                          AS joined_at,
  COUNT(DISTINCT s.id)                                  AS servers_published,
  COUNT(DISTINCT k.id)                                  AS api_keys_created,
  COALESCE(SUM(m.calls_30d), 0)                        AS proxy_calls_30d,
  MAX(s.last_scanned_at)                                AS last_server_scan
FROM public.profiles p
LEFT JOIN public.servers s    ON s.author_id = p.id
LEFT JOIN public.api_keys k   ON k.user_id = p.id
LEFT JOIN (
  SELECT user_id, COUNT(*) AS calls_30d
  FROM public.metering_events
  WHERE created_at > NOW() - INTERVAL '30 days'
  GROUP BY user_id
) m ON m.user_id = p.id
GROUP BY p.id, p.username, p.created_at;

-- ── Platform-level KPIs ───────────────────────────────────────────────────────
-- Single-row summary of all platform metrics
-- Run: SELECT * FROM platform_kpis;
CREATE OR REPLACE VIEW public.platform_kpis AS
SELECT
  -- Registry
  (SELECT COUNT(*) FROM public.servers)                         AS total_servers,
  (SELECT COUNT(*) FROM public.servers WHERE status='active')   AS active_servers,
  (SELECT COUNT(*) FROM public.servers WHERE verified=TRUE)     AS verified_servers,
  (SELECT COUNT(*) FROM public.servers WHERE source='official') AS official_servers,
  (SELECT COUNT(*) FROM public.servers WHERE source='smithery') AS smithery_servers,
  (SELECT COUNT(*) FROM public.servers WHERE source='glama')    AS glama_servers,
  (SELECT COUNT(*) FROM public.servers WHERE source='github')   AS github_servers,
  (SELECT COUNT(*) FROM public.servers WHERE source='direct')   AS direct_servers,
  -- Security
  (SELECT COUNT(*) FROM public.servers WHERE scan_status='failed') AS scan_failures,
  (SELECT COUNT(*) FROM public.servers WHERE cve_issues != '[]'::jsonb) AS servers_with_cves,
  (SELECT ROUND(AVG(trust_score),1) FROM public.servers WHERE status='active') AS avg_trust_score,
  -- Usage
  (SELECT COUNT(*) FROM public.metering_events WHERE created_at > NOW() - INTERVAL '24 hours') AS calls_24h,
  (SELECT COUNT(*) FROM public.metering_events WHERE created_at > NOW() - INTERVAL '7 days')   AS calls_7d,
  (SELECT COUNT(*) FROM public.metering_events WHERE created_at > NOW() - INTERVAL '30 days')  AS calls_30d,
  (SELECT COUNT(*) FROM public.metering_events WHERE dlp_triggered AND created_at > NOW() - INTERVAL '7 days') AS dlp_triggers_7d,
  -- Users
  (SELECT COUNT(*) FROM public.profiles) AS total_users,
  (SELECT COUNT(*) FROM public.api_keys) AS active_api_keys,
  -- Ingest
  (SELECT COUNT(*) FROM public.ingest_runs) AS total_ingest_runs,
  (SELECT MAX(finished_at) FROM public.ingest_runs WHERE finished_at IS NOT NULL) AS last_ingest_at;

-- ── Grant read access to service role ────────────────────────────────────────
-- These views are for internal analytics — service role only
GRANT SELECT ON public.server_health       TO service_role;
GRANT SELECT ON public.ingest_quality      TO service_role;
GRANT SELECT ON public.security_threats    TO service_role;
GRANT SELECT ON public.top_servers_by_usage TO service_role;
GRANT SELECT ON public.user_activity       TO service_role;
GRANT SELECT ON public.platform_kpis       TO service_role;
