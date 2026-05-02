-- Migration 027: Ingest provenance + public tool analytics aggregates
--
-- Goals:
-- 1. Persist where tool metadata came from so ranking and review can reason
--    about metadata quality explicitly.
-- 2. Expose per-server tool usage as an aggregate view instead of requiring
--    app routes to reconstruct it from raw audit_log rows.

ALTER TABLE public.servers
  ADD COLUMN IF NOT EXISTS tool_extraction_source TEXT NOT NULL DEFAULT 'none'
  CHECK (tool_extraction_source IN (
    'upstream_schemas',
    'upstream_names',
    'mcp_probe',
    'sandbox',
    'readme',
    'none'
  ));

COMMENT ON COLUMN public.servers.tool_extraction_source IS
  'Provenance for the current tools/tool_schemas payload: upstream_schemas, upstream_names, mcp_probe, sandbox, readme, or none.';

-- Best-effort backfill for existing rows. This preserves the most trustworthy
-- signal we can infer from current persisted fields.
UPDATE public.servers
SET tool_extraction_source = CASE
  WHEN COALESCE(jsonb_array_length(tool_schemas), 0) > 0 AND COALESCE(mcp_compliant, FALSE) = TRUE
    THEN 'mcp_probe'
  WHEN COALESCE(jsonb_array_length(tool_schemas), 0) > 0 AND description_quality = 'readme_parsed'
    THEN 'readme'
  WHEN COALESCE(jsonb_array_length(tool_schemas), 0) > 0
    THEN 'upstream_schemas'
  WHEN COALESCE(array_length(tools, 1), 0) > 0
    THEN 'upstream_names'
  ELSE 'none'
END
WHERE tool_extraction_source = 'none';

CREATE OR REPLACE VIEW public.server_tool_usage_30d AS
SELECT
  s.name                                              AS server_name,
  al.tool_name,
  COUNT(*)                                            AS total_calls,
  COUNT(*) FILTER (WHERE COALESCE(al.status_code, 0) < 400) AS successful_calls,
  COUNT(*) FILTER (WHERE COALESCE(al.status_code, 0) >= 400) AS error_calls,
  COUNT(*) FILTER (WHERE al.dlp_triggered)            AS dlp_events,
  ROUND(AVG(al.latency_ms))::INTEGER                  AS avg_latency_ms,
  MAX(al.created_at)                                  AS last_call
FROM public.audit_log al
JOIN public.servers s ON s.id = al.server_id
WHERE al.created_at > NOW() - INTERVAL '30 days'
  AND al.tool_name IS NOT NULL
  AND (
    al.action LIKE 'proxy_%'
    OR al.action LIKE '%blocked%'
  )
GROUP BY s.name, al.tool_name
ORDER BY total_calls DESC, last_call DESC;

GRANT SELECT ON public.server_tool_usage_30d TO anon, authenticated;

NOTIFY pgrst, 'reload schema';
