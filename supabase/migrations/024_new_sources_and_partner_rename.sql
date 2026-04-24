-- ═════════════════════════════════════════════════════════════════════════════
-- Migration 024: Add mcp_run and composio sources, rename vendor→partner
-- ═════════════════════════════════════════════════════════════════════════════

-- Rename existing vendor rows to partner
UPDATE public.servers SET source = 'partner' WHERE source = 'vendor';

-- Expand source CHECK constraint
ALTER TABLE public.servers
  DROP CONSTRAINT IF EXISTS servers_source_check;

ALTER TABLE public.servers
  ADD CONSTRAINT servers_source_check
  CHECK (source IN (
    'official', 'smithery', 'github', 'glama',
    'pulsemcp', 'direct', 'partner', 'claudemcp',
    'mcpso', 'mcp_run', 'composio'
  ));

-- Update global stats function
CREATE OR REPLACE FUNCTION public.get_global_stats()
RETURNS json
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT json_build_object(
    'total_servers',  COUNT(*),
    'active_servers', COUNT(*) FILTER (WHERE status = 'active'),
    'verified',       COUNT(*) FILTER (WHERE verified = true),
    'avg_trust',      ROUND(AVG(trust_score)::numeric, 1),
    'sources', json_build_object(
      'official',  COUNT(*) FILTER (WHERE source = 'official'),
      'smithery',  COUNT(*) FILTER (WHERE source = 'smithery'),
      'glama',     COUNT(*) FILTER (WHERE source = 'glama'),
      'github',    COUNT(*) FILTER (WHERE source = 'github'),
      'pulsemcp',  COUNT(*) FILTER (WHERE source = 'pulsemcp'),
      'direct',    COUNT(*) FILTER (WHERE source = 'direct'),
      'partner',   COUNT(*) FILTER (WHERE source = 'partner'),
      'claudemcp', COUNT(*) FILTER (WHERE source = 'claudemcp'),
      'mcpso',     COUNT(*) FILTER (WHERE source = 'mcpso'),
      'mcp_run',   COUNT(*) FILTER (WHERE source = 'mcp_run'),
      'composio',  COUNT(*) FILTER (WHERE source = 'composio')
    )
  )
  FROM public.servers;
$$;

-- Add description_quality column if not exists (tracks how descriptions were obtained)
ALTER TABLE public.servers
  ADD COLUMN IF NOT EXISTS description_quality TEXT DEFAULT 'upstream'
  CHECK (description_quality IN ('upstream', 'readme_parsed', 'auto_generated', 'manual'));

-- Add readme_url column for linking to source
ALTER TABLE public.servers
  ADD COLUMN IF NOT EXISTS readme_url TEXT;

-- Update ingest_quality view to include new sources
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
  ROUND(100.0 * COUNT(*) FILTER (WHERE status = 'rejected') / NULLIF(COUNT(*), 0), 1) AS rejection_rate_pct,
  COUNT(*) FILTER (WHERE description_quality = 'readme_parsed') AS readme_enriched,
  COUNT(*) FILTER (WHERE description_quality = 'auto_generated') AS auto_described
FROM public.servers
GROUP BY source
ORDER BY total_servers DESC;