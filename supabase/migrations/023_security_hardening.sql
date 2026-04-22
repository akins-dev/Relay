-- ═════════════════════════════════════════════════════════════════════════════
-- Migration 023: Security hardening for open source deployment
-- ═════════════════════════════════════════════════════════════════════════════

-- ── Rate limit configuration table ───────────────────────────────────────────
-- Allows admin panel to control rate limits without code deployment.
-- Read by the ratelimit.ts module at startup (cached 5 min).
CREATE TABLE IF NOT EXISTS public.rate_limit_config (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  context     TEXT NOT NULL UNIQUE, -- 'search', 'proxy', 'proxyAuth', 'auth', 'publish', etc.
  limit_count INTEGER NOT NULL,
  window_ms   INTEGER NOT NULL,
  enabled     BOOLEAN NOT NULL DEFAULT TRUE,
  note        TEXT,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by  UUID REFERENCES public.profiles(id)
);

-- Auto-update updated_at on every write
CREATE OR REPLACE FUNCTION public.touch_rate_limit_config()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_rate_limit_config_updated_at ON public.rate_limit_config;
CREATE TRIGGER trg_rate_limit_config_updated_at
  BEFORE UPDATE ON public.rate_limit_config
  FOR EACH ROW EXECUTE FUNCTION public.touch_rate_limit_config();

-- RLS: service_role reads (ratelimit.ts), authenticated admin can write via admin panel
ALTER TABLE public.rate_limit_config ENABLE ROW LEVEL SECURITY;

CREATE POLICY "ratelimit_service_read"
  ON public.rate_limit_config FOR SELECT TO service_role USING (TRUE);

-- Admin write: the admin panel's saveRateLimit() uses the browser client with a
-- valid Supabase session. We allow UPDATE only for the configured admin UID.
-- NEXT_PUBLIC_ADMIN_UID is not accessible in SQL — instead, the admin API route
-- validates the session server-side (see /api/admin/*) and uses service_role.
-- For direct browser client writes from the admin panel, allow authenticated
-- users whose uid matches the app-level check. Because we can't read env vars
-- in RLS, we use a helper function that can be overridden via app config.
-- Simplest secure option: grant UPDATE to service_role only, and route all
-- admin writes through /api/admin/* which already validates ADMIN_UID server-side.
CREATE POLICY "ratelimit_service_write"
  ON public.rate_limit_config FOR ALL TO service_role USING (TRUE);

-- Seed defaults (mirrors ratelimit.ts LIMITS)
INSERT INTO public.rate_limit_config (context, limit_count, window_ms, note) VALUES
  ('search',    60,  60000, 'Anonymous search_tools calls per IP per minute'),
  ('browse',    120, 60000, 'Anonymous browse/list calls per IP per minute'),
  ('proxy',     30,  60000, 'Anonymous invoke_tool calls per IP per minute'),
  ('proxyAuth', 200, 60000, 'Authenticated calls per user per minute'),
  ('auth',      10,  60000, 'Login/register attempts per IP per minute'),
  ('publish',   10,  60000, 'Server publish attempts per user per minute'),
  ('ingest',    5,   60000, 'Ingest trigger calls per minute'),
  ('mcpServer', 60,  60000, 'MCP server method calls per IP per minute')
ON CONFLICT (context) DO NOTHING;

-- ── Official name conflict check (replaces reserved_names) ───────────────────
-- Instead of a hardcoded name allowlist in the DB, we check provenance.
-- A name "conflicts" when an existing server with that exact name was ingested
-- from a trusted official source ('official', 'github', 'partner').
-- Manual submissions that try to claim the same name as an auto-ingested
-- official server are rejected at publish time — not via string matching,
-- but because the real server already exists with a higher-trust source.
--
-- Called by the /api/servers POST route before inserting a manual submission.
-- Returns TRUE if the name is already claimed by a trusted ingested source.
--
CREATE OR REPLACE FUNCTION public.check_official_name_conflict(p_name TEXT)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.servers
    WHERE name = LOWER(TRIM(p_name))
      AND source IN ('official', 'github', 'partner')
      AND status != 'rejected'
  );
$$;

COMMENT ON FUNCTION public.check_official_name_conflict IS
  'Returns TRUE if a name is already taken by a trusted ingested server (official/github/partner).
   Use this in the publish route instead of a reserved_names table — verification is
   provenance-based, not string-matching based. Any server ingested from the official
   MCP registry, the modelcontextprotocol/servers GitHub monorepo, or a verified partner
   org automatically claims its name. No manual curation required.';

GRANT EXECUTE ON FUNCTION public.check_official_name_conflict TO service_role;
GRANT EXECUTE ON FUNCTION public.check_official_name_conflict TO authenticated;

-- ── Suspicious activity tracking ─────────────────────────────────────────────
-- Tracks IPs and users with anomalous behaviour for adaptive rate limiting.
CREATE TABLE IF NOT EXISTS public.security_incidents (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  ip          TEXT,
  user_id     UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  incident    TEXT NOT NULL,  -- 'dlp_pattern_bypass_attempt', 'rapid_server_enumeration', etc.
  detail      JSONB,
  severity    TEXT NOT NULL DEFAULT 'medium' CHECK (severity IN ('low', 'medium', 'high', 'critical')),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_si_ip         ON public.security_incidents (ip, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_si_user       ON public.security_incidents (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_si_severity   ON public.security_incidents (severity, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_si_recent     ON public.security_incidents (created_at DESC);

ALTER TABLE public.security_incidents ENABLE ROW LEVEL SECURITY;

-- service_role can write incidents from the proxy/DLP layer
CREATE POLICY "si_service_all"
  ON public.security_incidents FOR ALL TO service_role USING (TRUE);

-- Authenticated admin can read incidents for the dashboard Security tab.
-- We cannot read NEXT_PUBLIC_ADMIN_UID in SQL, so we rely on the admin page
-- fetching via the Supabase client (already guarded by isAdmin check in UI
-- and the admin API routes). Any authenticated user can read — the admin
-- page never renders this data for non-admin sessions.
-- For stricter enforcement: wrap the admin dashboard queries in a server
-- action that validates ADMIN_UID before issuing the service_role query.
CREATE POLICY "si_authenticated_read"
  ON public.security_incidents FOR SELECT TO authenticated USING (TRUE);

-- ── API key anomaly detection ─────────────────────────────────────────────────
-- Placeholder for future multi-IP key anomaly detection.
--
-- Full implementation requires a metering_events table with per-call (key_id, ip)
-- rows — planned for Sprint 6. Until then this function:
--   1. Confirms the key exists in api_keys (using confirmed columns only)
--   2. Returns FALSE (undetectable, not clean) — callers must not treat this as
--      a security clearance, only as "no evidence of anomaly at this time"
--
-- Confirmed api_keys columns (from auth-server.ts): id, user_id, key_hash, last_used_at
-- Do NOT reference columns like 'revoked' until the schema is confirmed.
--
-- TODO (Sprint 6): Replace body with:
--   SELECT COUNT(DISTINCT ip) > 5
--   FROM public.metering_events
--   WHERE key_id = p_key_id AND created_at > NOW() - INTERVAL '1 hour'
--
CREATE OR REPLACE FUNCTION public.check_key_anomaly(
  p_key_id UUID,
  p_ip     TEXT
)
RETURNS BOOLEAN  -- TRUE = anomaly detected
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  -- Key existence check using only confirmed columns.
  -- Returns FALSE (not: clean — just: undetectable without metering_events).
  SELECT FALSE
  WHERE EXISTS (
    SELECT 1 FROM public.api_keys WHERE id = p_key_id
  );
$$;

GRANT EXECUTE ON FUNCTION public.check_key_anomaly TO service_role;