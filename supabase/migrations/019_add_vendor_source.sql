-- Migration 019: Add 'vendor' to allowed sources and expand global_stats
ALTER TABLE public.servers
  DROP CONSTRAINT IF EXISTS servers_source_check;

ALTER TABLE public.servers
  ADD CONSTRAINT servers_source_check
  CHECK (source IN ('official', 'smithery', 'github', 'glama', 'pulsemcp', 'direct', 'vendor'));

-- Update global_stats to include vendor source count
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
      'pulsemcp',  COUNT(*) FILTER (WHERE source = 'pulsemcp'),
      'direct',    COUNT(*) FILTER (WHERE source = 'direct'),
      'vendor',    COUNT(*) FILTER (WHERE source = 'vendor')
    )
  ) FROM public.servers;
$$;
