-- ─────────────────────────────────────────────────────────────────────────────
-- MCP Registry — Initial Schema
-- ─────────────────────────────────────────────────────────────────────────────

-- ── Extensions ────────────────────────────────────────────────────────────────
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pg_trgm"; -- L8: fuzzy name matching for typosquatting

-- ── Types ─────────────────────────────────────────────────────────────────────
CREATE TYPE server_status AS ENUM ('pending', 'active', 'rejected', 'suspended');
CREATE TYPE scan_status   AS ENUM ('pending', 'passed', 'failed');

-- ── Profiles ──────────────────────────────────────────────────────────────────
-- Extends auth.users — created automatically on signup via trigger
CREATE TABLE public.profiles (
  id              UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  username        TEXT UNIQUE NOT NULL,
  github_username TEXT,
  avatar_url      TEXT,
  bio             TEXT,
  website         TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── Servers ───────────────────────────────────────────────────────────────────
CREATE TABLE public.servers (
  id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name             TEXT UNIQUE NOT NULL,
  display_name     TEXT NOT NULL,
  description      TEXT NOT NULL,
  long_description TEXT,
  author_id        UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  version          TEXT NOT NULL DEFAULT '1.0.0',
  endpoint         TEXT NOT NULL,
  homepage_url     TEXT,
  github_url       TEXT,
  license          TEXT NOT NULL DEFAULT 'MIT',
  tags             TEXT[]  NOT NULL DEFAULT '{}',
  tools            TEXT[]  NOT NULL DEFAULT '{}',
  status           server_status NOT NULL DEFAULT 'pending',
  verified         BOOLEAN NOT NULL DEFAULT FALSE,
  stars            INTEGER NOT NULL DEFAULT 0,
  total_calls      BIGINT  NOT NULL DEFAULT 0,
  calls_today      INTEGER NOT NULL DEFAULT 0,
  latency_ms       INTEGER,
  uptime_pct       NUMERIC(5,2) NOT NULL DEFAULT 100.00,
  trust_score      NUMERIC(5,2) NOT NULL DEFAULT 50.00,
  schema_hash      TEXT,
  last_scanned_at  TIMESTAMPTZ,
  scan_status      scan_status NOT NULL DEFAULT 'pending',
  scan_issues      JSONB NOT NULL DEFAULT '[]',

  -- L8: generated column for typosquatting similarity checks
  name_normalized  TEXT GENERATED ALWAYS AS (
    regexp_replace(lower(name), '[^a-z0-9]', '', 'g')
  ) STORED,

  -- Full-text search vector (L1 discoverability + search quality)
  search_vector    TSVECTOR GENERATED ALWAYS AS (
    setweight(to_tsvector('english', coalesce(name, '')), 'A') ||
    setweight(to_tsvector('english', coalesce(display_name, '')), 'A') ||
    setweight(to_tsvector('english', coalesce(description, '')), 'B') ||
    setweight(to_tsvector('english', coalesce(long_description, '')), 'C') ||
    setweight(to_tsvector('english', array_to_string(tags, ' ')), 'A') ||
    setweight(to_tsvector('english', array_to_string(tools, ' ')), 'B')
  ) STORED,

  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── Server Stars ──────────────────────────────────────────────────────────────
CREATE TABLE public.server_stars (
  user_id    UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  server_id  UUID NOT NULL REFERENCES public.servers(id)  ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, server_id)
);

-- ── API Keys ──────────────────────────────────────────────────────────────────
-- Hash stored, raw key shown once on creation and never again
CREATE TABLE public.api_keys (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id      UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  key_hash     TEXT NOT NULL,
  key_prefix   TEXT NOT NULL, -- first 16 chars, shown in UI
  name         TEXT NOT NULL,
  last_used_at TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── Scan Results ──────────────────────────────────────────────────────────────
CREATE TABLE public.scan_results (
  id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  server_id  UUID NOT NULL REFERENCES public.servers(id) ON DELETE CASCADE,
  scan_type  TEXT NOT NULL, -- 'static' | 'drift' | 'uptime'
  passed     BOOLEAN NOT NULL,
  score      INTEGER NOT NULL DEFAULT 100,
  issues     JSONB NOT NULL DEFAULT '[]',
  details    TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── Schema Snapshots (L3 — rug-pull detection) ────────────────────────────────
CREATE TABLE public.schema_snapshots (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  server_id    UUID NOT NULL REFERENCES public.servers(id) ON DELETE CASCADE,
  schema_hash  TEXT NOT NULL,
  tools        TEXT[] NOT NULL,
  version      TEXT NOT NULL,
  captured_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── Audit Log ─────────────────────────────────────────────────────────────────
-- Append-only. Never UPDATE or DELETE rows here.
CREATE TABLE public.audit_log (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  server_id     UUID REFERENCES public.servers(id) ON DELETE SET NULL,
  user_id       UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  action        TEXT NOT NULL,
  tool_name     TEXT,
  request_size  INTEGER,
  response_size INTEGER,
  latency_ms    INTEGER,
  status_code   INTEGER,
  dlp_triggered BOOLEAN NOT NULL DEFAULT FALSE,
  dlp_issues    TEXT[],
  ip            INET,
  user_agent    TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─────────────────────────────────────────────────────────────────────────────
-- INDEXES
-- ─────────────────────────────────────────────────────────────────────────────
CREATE INDEX idx_servers_status   ON public.servers(status);
CREATE INDEX idx_servers_trust    ON public.servers(trust_score DESC);
CREATE INDEX idx_servers_stars    ON public.servers(stars DESC);
CREATE INDEX idx_servers_tags     ON public.servers USING GIN(tags);
CREATE INDEX idx_servers_tools    ON public.servers USING GIN(tools);
CREATE INDEX idx_servers_fts      ON public.servers USING GIN(search_vector);

-- L8: trigram indexes for typosquatting detection
CREATE INDEX idx_servers_name_trgm ON public.servers USING GIN(name gin_trgm_ops);
CREATE INDEX idx_servers_norm_trgm ON public.servers USING GIN(name_normalized gin_trgm_ops);

CREATE INDEX idx_audit_server  ON public.audit_log(server_id, created_at DESC);
CREATE INDEX idx_audit_created ON public.audit_log(created_at DESC);
CREATE INDEX idx_scan_server   ON public.scan_results(server_id, created_at DESC);
CREATE INDEX idx_snap_server   ON public.schema_snapshots(server_id, captured_at DESC);

-- ─────────────────────────────────────────────────────────────────────────────
-- L6: ROW LEVEL SECURITY
-- All tables locked down — access enforced at DB level, not just app level
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.profiles       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.servers        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.server_stars   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.api_keys       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.scan_results   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_log      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.schema_snapshots ENABLE ROW LEVEL SECURITY;

-- Profiles
CREATE POLICY "profiles_public_read"
  ON public.profiles FOR SELECT USING (TRUE);

CREATE POLICY "profiles_own_write"
  ON public.profiles FOR ALL TO authenticated
  USING (auth.uid() = id) WITH CHECK (auth.uid() = id);

-- Servers: anyone reads active, authors read/write their own
CREATE POLICY "servers_public_read_active"
  ON public.servers FOR SELECT
  USING (status = 'active');

CREATE POLICY "servers_author_read_own"
  ON public.servers FOR SELECT TO authenticated
  USING (author_id = auth.uid());

CREATE POLICY "servers_author_insert"
  ON public.servers FOR INSERT TO authenticated
  WITH CHECK (author_id = auth.uid());

CREATE POLICY "servers_author_update"
  ON public.servers FOR UPDATE TO authenticated
  USING (author_id = auth.uid()) WITH CHECK (author_id = auth.uid());

-- Stars
CREATE POLICY "stars_public_read"
  ON public.server_stars FOR SELECT USING (TRUE);

CREATE POLICY "stars_own_write"
  ON public.server_stars FOR ALL TO authenticated
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

-- API Keys: users see only their own
CREATE POLICY "api_keys_own_only"
  ON public.api_keys FOR ALL TO authenticated
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

-- Scan results: public reads for active servers, authors read their own
CREATE POLICY "scans_public_read"
  ON public.scan_results FOR SELECT
  USING (
    server_id IN (SELECT id FROM public.servers WHERE status = 'active')
  );

CREATE POLICY "scans_author_read"
  ON public.scan_results FOR SELECT TO authenticated
  USING (
    server_id IN (SELECT id FROM public.servers WHERE author_id = auth.uid())
  );

-- Audit log: authors read their own server logs only
CREATE POLICY "audit_author_read"
  ON public.audit_log FOR SELECT TO authenticated
  USING (
    server_id IN (SELECT id FROM public.servers WHERE author_id = auth.uid())
  );

-- Schema snapshots: authors read their own
CREATE POLICY "snapshots_author_read"
  ON public.schema_snapshots FOR SELECT TO authenticated
  USING (
    server_id IN (SELECT id FROM public.servers WHERE author_id = auth.uid())
  );

-- ─────────────────────────────────────────────────────────────────────────────
-- TRIGGERS
-- ─────────────────────────────────────────────────────────────────────────────

-- Auto-create profile on signup
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.profiles (id, username, avatar_url)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'username', split_part(NEW.email, '@', 1)),
    NEW.raw_user_meta_data->>'avatar_url'
  );
  RETURN NEW;
END;
$$;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- Auto-update updated_at
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$;

CREATE TRIGGER servers_updated_at
  BEFORE UPDATE ON public.servers
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER profiles_updated_at
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- L3: Capture schema snapshot whenever tools or version changes
CREATE OR REPLACE FUNCTION public.capture_schema_snapshot()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  IF TG_OP = 'INSERT' OR OLD.schema_hash IS DISTINCT FROM NEW.schema_hash THEN
    INSERT INTO public.schema_snapshots (server_id, schema_hash, tools, version)
    VALUES (NEW.id, NEW.schema_hash, NEW.tools, NEW.version);
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER servers_schema_snapshot
  AFTER INSERT OR UPDATE ON public.servers
  FOR EACH ROW EXECUTE FUNCTION public.capture_schema_snapshot();

-- ─────────────────────────────────────────────────────────────────────────────
-- RPC FUNCTIONS
-- ─────────────────────────────────────────────────────────────────────────────

-- Global stats for home page
CREATE OR REPLACE FUNCTION public.global_stats()
RETURNS JSON LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT json_build_object(
    'total_servers',    COUNT(*),
    'active_servers',   COUNT(*) FILTER (WHERE status = 'active'),
    'verified_servers', COUNT(*) FILTER (WHERE verified = TRUE),
    'total_calls',      COALESCE(SUM(total_calls), 0),
    'calls_today',      COALESCE(SUM(calls_today), 0),
    'avg_trust_score',  ROUND(COALESCE(AVG(trust_score), 0)::NUMERIC, 1)
  ) FROM public.servers;
$$;

-- Full-text + tag + tool search with trust-score ranking
CREATE OR REPLACE FUNCTION public.search_servers(
  query_text TEXT,
  result_limit INT DEFAULT 10
)
RETURNS SETOF public.servers LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT *
  FROM public.servers
  WHERE status = 'active'
    AND (
      search_vector @@ plainto_tsquery('english', query_text)
      OR name        ILIKE '%' || query_text || '%'
      OR query_text  = ANY(tags)
      OR query_text  = ANY(tools)
    )
  ORDER BY
    ts_rank(search_vector, plainto_tsquery('english', query_text)) DESC,
    trust_score DESC,
    stars DESC
  LIMIT result_limit;
$$;

-- L8: Typosquatting check — returns servers with similar names
CREATE OR REPLACE FUNCTION public.find_similar_names(candidate TEXT)
RETURNS TABLE(name TEXT, similarity REAL) LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT
    s.name,
    similarity(
      regexp_replace(lower(candidate), '[^a-z0-9]', '', 'g'),
      s.name_normalized
    ) AS similarity
  FROM public.servers s
  WHERE s.status = 'active'
    AND similarity(
      regexp_replace(lower(candidate), '[^a-z0-9]', '', 'g'),
      s.name_normalized
    ) > 0.6
  ORDER BY similarity DESC
  LIMIT 5;
$$;

-- Atomic counters (avoids race conditions)
CREATE OR REPLACE FUNCTION public.increment_stars(server_id UUID)
RETURNS void LANGUAGE sql SECURITY DEFINER AS $$
  UPDATE public.servers SET stars = stars + 1 WHERE id = server_id;
$$;

CREATE OR REPLACE FUNCTION public.decrement_stars(server_id UUID)
RETURNS void LANGUAGE sql SECURITY DEFINER AS $$
  UPDATE public.servers SET stars = GREATEST(0, stars - 1) WHERE id = server_id;
$$;

CREATE OR REPLACE FUNCTION public.increment_calls(server_id UUID)
RETURNS void LANGUAGE sql SECURITY DEFINER AS $$
  UPDATE public.servers
  SET total_calls = total_calls + 1, calls_today = calls_today + 1
  WHERE id = server_id;
$$;

-- L8: Tool name collision view (namespace hijacking detection)
-- Used by admin to spot servers with identical tool names
CREATE OR REPLACE VIEW public.tool_name_collisions AS
SELECT
  s1.name AS server_a,
  s2.name AS server_b,
  tool    AS conflicting_tool,
  s1.verified AS a_verified,
  s2.verified AS b_verified
FROM public.servers s1,
     public.servers s2,
     unnest(s1.tools) AS tool
WHERE s1.id < s2.id
  AND s1.status = 'active'
  AND s2.status = 'active'
  AND tool = ANY(s2.tools);
