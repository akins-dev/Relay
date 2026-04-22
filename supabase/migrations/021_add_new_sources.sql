-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 021: Add claudemcp and mcpso as valid ingest sources
--
-- claudemcp.com — curated MCP directory (high quality)
-- mcp.so        — curated MCP directory (high quality)
-- ─────────────────────────────────────────────────────────────────────────────

-- Expand the source CHECK constraint on servers table
ALTER TABLE public.servers
  DROP CONSTRAINT IF EXISTS servers_source_check;

ALTER TABLE public.servers
  ADD CONSTRAINT servers_source_check
  CHECK (source IN (
    'official', 'smithery', 'github', 'glama',
    'pulsemcp', 'direct', 'vendor', 'claudemcp', 'mcpso'
  ));

-- Update global_stats view to include new source counts
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
      'vendor',    COUNT(*) FILTER (WHERE source = 'vendor'),
      'claudemcp', COUNT(*) FILTER (WHERE source = 'claudemcp'),
      'mcpso',     COUNT(*) FILTER (WHERE source = 'mcpso')
    )
  )
  FROM public.servers;
$$;