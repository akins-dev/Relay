-- ─────────────────────────────────────────────────────────────────────────────
-- relay — Migration 003: Source provenance + CVE scanning fields
-- ─────────────────────────────────────────────────────────────────────────────

-- Add source provenance field
ALTER TABLE public.servers
  ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'direct'
    CHECK (source IN ('official', 'smithery', 'github', 'direct'));

-- Add external ID fields for deduplication across registries
ALTER TABLE public.servers
  ADD COLUMN IF NOT EXISTS smithery_id   TEXT,
  ADD COLUMN IF NOT EXISTS official_id   TEXT;

-- Add CVE scan results
ALTER TABLE public.servers
  ADD COLUMN IF NOT EXISTS cve_issues    JSONB NOT NULL DEFAULT '[]',
  ADD COLUMN IF NOT EXISTS cve_scan_at   TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS shell_issues  JSONB NOT NULL DEFAULT '[]';

-- Add ingest tracking table
CREATE TABLE IF NOT EXISTS public.ingest_runs (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  source      TEXT NOT NULL,
  started_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  finished_at TIMESTAMPTZ,
  servers_found    INTEGER NOT NULL DEFAULT 0,
  servers_added    INTEGER NOT NULL DEFAULT 0,
  servers_updated  INTEGER NOT NULL DEFAULT 0,
  servers_rejected INTEGER NOT NULL DEFAULT 0,
  error       TEXT
);

-- Index for source filtering
CREATE INDEX IF NOT EXISTS idx_servers_source ON public.servers(source);

-- RLS for ingest_runs (service role only — no direct user access)
ALTER TABLE public.ingest_runs ENABLE ROW LEVEL SECURITY;
-- No policies needed — only service client reads/writes this table

-- Update global_stats to include source breakdown
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
      'github',    COUNT(*) FILTER (WHERE source = 'github'),
      'direct',    COUNT(*) FILTER (WHERE source = 'direct')
    )
  ) FROM public.servers;
$$;
