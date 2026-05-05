-- Migration 028: Ingest provenance quality views
--
-- Goals:
-- 1. Make tool extraction quality measurable per source.
-- 2. Promote weak stdio inventory to a first-class admin/release signal.

CREATE OR REPLACE VIEW public.ingest_quality AS
SELECT
  source,
  COUNT(*)                                              AS total_servers,
  COUNT(*) FILTER (WHERE status = 'active')             AS active_servers,
  COUNT(*) FILTER (WHERE status = 'rejected')           AS rejected_servers,
  COUNT(*) FILTER (WHERE verified = TRUE)               AS verified_servers,
  COUNT(*) FILTER (WHERE scan_status = 'passed')        AS scan_passed,
  COUNT(*) FILTER (WHERE scan_status = 'failed')        AS scan_failed,
  COUNT(*) FILTER (WHERE cve_issues != '[]'::jsonb)     AS has_cve_issues,
  ROUND(AVG(trust_score), 1)                            AS avg_trust_score,
  ROUND(100.0 * COUNT(*) FILTER (WHERE status = 'rejected') / NULLIF(COUNT(*), 0), 1) AS rejection_rate_pct,
  COUNT(*) FILTER (WHERE description_quality = 'readme_parsed') AS readme_enriched,
  COUNT(*) FILTER (WHERE description_quality = 'auto_generated') AS auto_described,
  COUNT(*) FILTER (WHERE tool_extraction_source = 'mcp_probe') AS probe_backed,
  COUNT(*) FILTER (WHERE tool_extraction_source = 'sandbox')   AS sandbox_backed,
  COUNT(*) FILTER (WHERE tool_extraction_source = 'readme')    AS readme_backed,
  COUNT(*) FILTER (WHERE tool_extraction_source = 'none')      AS no_tool_metadata,
  COUNT(*) FILTER (
    WHERE transport = 'stdio'
      AND tool_extraction_source IN ('readme', 'none')
  ) AS weak_stdio_rows
FROM public.servers
GROUP BY source
ORDER BY total_servers DESC;

CREATE OR REPLACE VIEW public.ingest_provenance_quality AS
SELECT
  source,
  tool_extraction_source,
  COUNT(*) AS server_count,
  COUNT(*) FILTER (WHERE transport = 'stdio') AS stdio_count,
  COUNT(*) FILTER (WHERE status = 'active') AS active_count,
  ROUND(AVG(trust_score), 1) AS avg_trust_score
FROM public.servers
GROUP BY source, tool_extraction_source
ORDER BY source, server_count DESC, tool_extraction_source;

CREATE OR REPLACE VIEW public.platform_kpis AS
SELECT
  (SELECT COUNT(*) FROM public.servers)                         AS total_servers,
  (SELECT COUNT(*) FROM public.servers WHERE status='active')   AS active_servers,
  (SELECT COUNT(*) FROM public.servers WHERE verified=TRUE)     AS verified_servers,
  (SELECT COUNT(*) FROM public.servers WHERE source='official') AS official_servers,
  (SELECT COUNT(*) FROM public.servers WHERE source='smithery') AS smithery_servers,
  (SELECT COUNT(*) FROM public.servers WHERE source='glama')    AS glama_servers,
  (SELECT COUNT(*) FROM public.servers WHERE source='github')   AS github_servers,
  (SELECT COUNT(*) FROM public.servers WHERE source='direct')   AS direct_servers,
  (SELECT COUNT(*) FROM public.servers WHERE scan_status='failed') AS scan_failures,
  (SELECT COUNT(*) FROM public.servers WHERE cve_issues != '[]'::jsonb) AS servers_with_cves,
  (SELECT ROUND(AVG(trust_score),1) FROM public.servers WHERE status='active') AS avg_trust_score,
  (SELECT COUNT(*) FROM public.metering_events WHERE created_at > NOW() - INTERVAL '24 hours') AS calls_24h,
  (SELECT COUNT(*) FROM public.metering_events WHERE created_at > NOW() - INTERVAL '7 days')   AS calls_7d,
  (SELECT COUNT(*) FROM public.metering_events WHERE created_at > NOW() - INTERVAL '30 days')  AS calls_30d,
  (SELECT COUNT(*) FROM public.metering_events WHERE dlp_triggered AND created_at > NOW() - INTERVAL '7 days') AS dlp_triggers_7d,
  (SELECT COUNT(*) FROM public.profiles) AS total_users,
  (SELECT COUNT(*) FROM public.api_keys) AS active_api_keys,
  (SELECT COUNT(*) FROM public.ingest_runs) AS total_ingest_runs,
  (SELECT MAX(finished_at) FROM public.ingest_runs WHERE finished_at IS NOT NULL) AS last_ingest_at,
  (SELECT COUNT(*) FROM public.servers WHERE tool_extraction_source = 'none') AS no_tool_metadata_servers,
  (SELECT COUNT(*) FROM public.servers WHERE transport = 'stdio' AND tool_extraction_source IN ('readme', 'none')) AS weak_stdio_rows;

GRANT SELECT ON public.ingest_quality TO service_role;
GRANT SELECT ON public.ingest_provenance_quality TO service_role;
GRANT SELECT ON public.platform_kpis TO service_role;

NOTIFY pgrst, 'reload schema';
