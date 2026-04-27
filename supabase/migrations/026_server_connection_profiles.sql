-- Migration 027: Server Connection Profiles (Option B Side Table)
--
-- Design rationale:
-- The servers table stays lean for FTS + listing queries.
-- Deep connection/install data lives here — rich JSONB blobs from
-- upstream registries stored verbatim alongside normalised fields.
--
-- Each server can have ONE profile per source (official, smithery, glama, etc.)
-- so we can cross-reference upstream data without duplication.
--
-- Also adds:
--   title              to servers (from official OpenAPI: human-readable display name)
--   homepage_url       to servers (from official OpenAPI: websiteUrl)
--   description_quality to servers (indicates source: upstream / readme_parsed / auto_generated)

-- ── 1. Server connection profiles side table ────────────────────────────────

CREATE TABLE IF NOT EXISTS public.server_connection_profiles (
  id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  server_id        UUID NOT NULL REFERENCES public.servers(id) ON DELETE CASCADE,
  source           TEXT NOT NULL DEFAULT 'official',
  source_id        TEXT,                          -- upstream canonical ID (e.g. "io.github.user/weather")
  raw_upstream_json JSONB,                        -- full upstream response stored verbatim
  remotes          JSONB,                         -- official: RemoteTransport[] (url, headers, variables)
  packages         JSONB,                         -- official: Package[] (registryType, identifier, envVars, etc.)
  icons            JSONB,                         -- official: Icon[] (src, mimeType, sizes, theme)
  official_meta    JSONB,                         -- official: { status, publishedAt, updatedAt, isLatest }
  publisher_meta   JSONB,                         -- official: publisher-provided metadata
  title            TEXT,                          -- human-readable display name
  website_url      TEXT,                          -- homepage / documentation URL
  synced_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- One profile per server per source
  CONSTRAINT uq_server_source UNIQUE (server_id, source)
);

CREATE INDEX IF NOT EXISTS idx_scp_server_id ON public.server_connection_profiles(server_id);
CREATE INDEX IF NOT EXISTS idx_scp_source    ON public.server_connection_profiles(source);
CREATE INDEX IF NOT EXISTS idx_scp_source_id ON public.server_connection_profiles(source_id);

COMMENT ON TABLE  public.server_connection_profiles IS
  'Option B: rich connection/install metadata from upstream registries, kept separate from the lean servers table.';

-- ── 2. Add new columns to servers table ─────────────────────────────────────

-- title: from official OpenAPI spec — high-value for search
ALTER TABLE public.servers ADD COLUMN IF NOT EXISTS title TEXT;

-- homepage_url: from official OpenAPI spec (websiteUrl)
ALTER TABLE public.servers ADD COLUMN IF NOT EXISTS homepage_url TEXT;

-- description_quality: indicates how the description was obtained
ALTER TABLE public.servers ADD COLUMN IF NOT EXISTS description_quality TEXT
  DEFAULT 'upstream'
  CHECK (description_quality IN ('upstream', 'readme_parsed', 'auto_generated', 'manual'));

-- source_id: canonical ID from the upstream registry
ALTER TABLE public.servers ADD COLUMN IF NOT EXISTS source_id TEXT;

-- ── 3. Extend search_vector to include new fields ───────────────────────────

-- Drop and recreate the search vector update function to include title, homepage, transport
CREATE OR REPLACE FUNCTION public.update_search_vector()
RETURNS TRIGGER AS $$
BEGIN
  NEW.search_vector :=
    setweight(to_tsvector('english', coalesce(NEW.name, '')), 'A') ||
    setweight(to_tsvector('english', coalesce(NEW.display_name, '')), 'A') ||
    setweight(to_tsvector('english', coalesce(NEW.title, '')), 'A') ||
    setweight(to_tsvector('english', coalesce(NEW.description, '')), 'B') ||
    setweight(to_tsvector('english', coalesce(NEW.homepage_url, '')), 'C') ||
    setweight(to_tsvector('english', coalesce(NEW.github_url, '')), 'C') ||
    setweight(to_tsvector('english', coalesce(NEW.transport, '')), 'C') ||
    setweight(to_tsvector('english', coalesce(array_to_string(NEW.tags, ' '), '')), 'C') ||
    setweight(to_tsvector('english', coalesce(array_to_string(NEW.tools, ' '), '')), 'B');
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Backfill search vector for existing rows to pick up new fields
UPDATE public.servers SET search_vector =
  setweight(to_tsvector('english', coalesce(name, '')), 'A') ||
  setweight(to_tsvector('english', coalesce(display_name, '')), 'A') ||
  setweight(to_tsvector('english', coalesce(title, '')), 'A') ||
  setweight(to_tsvector('english', coalesce(description, '')), 'B') ||
  setweight(to_tsvector('english', coalesce(homepage_url, '')), 'C') ||
  setweight(to_tsvector('english', coalesce(github_url, '')), 'C') ||
  setweight(to_tsvector('english', coalesce(transport, '')), 'C') ||
  setweight(to_tsvector('english', coalesce(array_to_string(tags, ' '), '')), 'C') ||
  setweight(to_tsvector('english', coalesce(array_to_string(tools, ' '), '')), 'B');

-- ── 4. Enable RLS on the new table ──────────────────────────────────────────

ALTER TABLE public.server_connection_profiles ENABLE ROW LEVEL SECURITY;

-- Public read access (mirrors servers table policy)
CREATE POLICY "Public read profiles" ON public.server_connection_profiles
  FOR SELECT USING (true);

-- Service role write access (ingest pipeline)
CREATE POLICY "Service write profiles" ON public.server_connection_profiles
  FOR ALL USING (auth.role() = 'service_role');

-- ── 5. Notify PostgREST to reload schema ────────────────────────────────────

NOTIFY pgrst, 'reload schema';
