-- Migration 016: Fix global_stats to count all discovered servers
-- The homepage stats were only counting `status = 'active'`, hiding
-- thousands of ingested servers sitting in `pending_review`.

CREATE OR REPLACE FUNCTION public.global_stats()
RETURNS JSON LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT json_build_object(
    'total_servers',       COUNT(*),
    'active_servers',      COUNT(*) FILTER (WHERE status = 'active'),
    'pending_servers',     COUNT(*) FILTER (WHERE status::text = 'pending_review'),
    'invokable_servers',   COUNT(*) FILTER (WHERE status = 'active' AND transport != 'stdio'),
    'local_servers',       COUNT(*) FILTER (WHERE status = 'active' AND transport = 'stdio'),
    'verified_servers',    COUNT(*) FILTER (WHERE verified = TRUE),
    'discovered_servers',  COUNT(*) FILTER (WHERE status IN ('active', 'pending_review')),
    'total_calls',         COALESCE(SUM(total_calls), 0),
    'calls_today',         COALESCE(SUM(calls_today), 0),
    'avg_trust_score',     ROUND(COALESCE(AVG(trust_score) FILTER (WHERE status IN ('active', 'pending_review')), 0)::NUMERIC, 1),
    'sources', json_build_object(
      'official',  COUNT(*) FILTER (WHERE source = 'official'),
      'smithery',  COUNT(*) FILTER (WHERE source = 'smithery'),
      'glama',     COUNT(*) FILTER (WHERE source = 'glama'),
      'pulsemcp',  COUNT(*) FILTER (WHERE source = 'direct'),
      'github',    COUNT(*) FILTER (WHERE source = 'github'),
      'direct',    COUNT(*) FILTER (WHERE source = 'direct')
    )
  ) FROM public.servers;
$$;

NOTIFY pgrst, 'reload schema';
