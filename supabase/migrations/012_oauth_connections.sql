-- ─────────────────────────────────────────────────────────────────────────────
-- openMCP — Migration 012: Per-server OAuth connections
-- ─────────────────────────────────────────────────────────────────────────────
-- Adds OAuth metadata to servers and stores per-user OAuth tokens in the vault.
-- The proxy reads the token from vault and injects it as Authorization header.
-- This closes the multi-tenant OAuth gap for the 8.5% of servers that use it.

-- ── OAuth metadata on servers ─────────────────────────────────────────────────
ALTER TABLE public.servers
  DROP CONSTRAINT IF EXISTS servers_auth_type_check;

ALTER TABLE public.servers
  ADD COLUMN IF NOT EXISTS oauth_authorization_url TEXT, -- e.g. https://github.com/login/oauth/authorize
  ADD COLUMN IF NOT EXISTS oauth_token_url          TEXT, -- e.g. https://github.com/login/oauth/access_token
  ADD COLUMN IF NOT EXISTS oauth_scopes             TEXT, -- space-separated, e.g. "repo read:user"
  ADD COLUMN IF NOT EXISTS oauth_client_id          TEXT; -- openMCP's registered client_id for this service
  -- oauth_client_secret lives in Vercel env, never in DB

ALTER TABLE public.servers
  ADD CONSTRAINT servers_auth_type_check
  CHECK (auth_type IN (
    'none',
    'managed',
    'key_param',
    'agentsecrets',
    'oauth'
  ));

UPDATE public.servers
SET auth_type = 'oauth'
WHERE oauth_authorization_url IS NOT NULL;

-- ── User OAuth connections registry ──────────────────────────────────────────
-- Tracks which users have connected which OAuth services.
-- The actual token lives in vault.secrets via vault_id.
CREATE TABLE IF NOT EXISTS public.user_oauth_connections (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id       UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  server_name   TEXT NOT NULL,
  -- Token metadata (no actual tokens here — those are in vault)
  vault_id      UUID NOT NULL,     -- points into vault.secrets (access token)
  refresh_vault_id UUID,           -- points into vault.secrets (refresh token, if any)
  scope         TEXT,              -- scopes granted by the user
  expires_at    TIMESTAMPTZ,       -- when the access token expires
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(user_id, server_name)
);

ALTER TABLE public.user_oauth_connections ENABLE ROW LEVEL SECURITY;

-- Users can see and delete their own connections
CREATE POLICY "oauth_own_read"
  ON public.user_oauth_connections FOR SELECT TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY "oauth_own_delete"
  ON public.user_oauth_connections FOR DELETE TO authenticated
  USING (user_id = auth.uid());

CREATE INDEX IF NOT EXISTS idx_oauth_user_server ON public.user_oauth_connections(user_id, server_name);

-- ── OAuth state table — CSRF protection ──────────────────────────────────────
-- Each OAuth flow generates a random state param stored here for 10 minutes.
-- Callback validates state before exchanging code for token.
CREATE TABLE IF NOT EXISTS public.oauth_states (
  state       TEXT PRIMARY KEY,         -- random 32-byte hex value
  user_id     UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  server_name TEXT NOT NULL,
  redirect_to TEXT,                     -- where to send the user after success
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at  TIMESTAMPTZ NOT NULL DEFAULT NOW() + INTERVAL '10 minutes'
);

ALTER TABLE public.oauth_states ENABLE ROW LEVEL SECURITY;

-- Auto-clean expired states
CREATE INDEX IF NOT EXISTS idx_oauth_states_expires ON public.oauth_states(expires_at);

-- ── RPC: store OAuth tokens in vault ─────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.store_oauth_connection(
  p_user_id        UUID,
  p_server_name    TEXT,
  p_access_token   TEXT,
  p_refresh_token  TEXT  DEFAULT NULL,
  p_scope          TEXT  DEFAULT NULL,
  p_expires_at     TIMESTAMPTZ DEFAULT NULL
)
RETURNS BOOLEAN
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, vault
AS $$
DECLARE
  v_access_vault_id  UUID;
  v_refresh_vault_id UUID;
  v_access_key       TEXT;
  v_refresh_key      TEXT;
  v_old_access_id    UUID;
  v_old_refresh_id   UUID;
BEGIN
  v_access_key  := 'oauth:access:'  || p_user_id::TEXT || ':' || p_server_name;
  v_refresh_key := 'oauth:refresh:' || p_user_id::TEXT || ':' || p_server_name;

  -- Delete old tokens if reconnecting
  SELECT vault_id, refresh_vault_id
  INTO v_old_access_id, v_old_refresh_id
  FROM public.user_oauth_connections
  WHERE user_id = p_user_id AND server_name = p_server_name;

  DELETE FROM public.user_oauth_connections
  WHERE user_id = p_user_id AND server_name = p_server_name;

  IF v_old_access_id IS NOT NULL THEN
    DELETE FROM vault.secrets WHERE id = v_old_access_id;
  END IF;

  IF v_old_refresh_id IS NOT NULL THEN
    DELETE FROM vault.secrets WHERE id = v_old_refresh_id;
  END IF;

  -- Store access token in vault
  SELECT vault.create_secret(p_access_token, v_access_key, 'OAuth access token')
  INTO v_access_vault_id;

  -- Store refresh token if provided
  IF p_refresh_token IS NOT NULL THEN
    SELECT vault.create_secret(p_refresh_token, v_refresh_key, 'OAuth refresh token')
    INTO v_refresh_vault_id;
  END IF;

  -- Register connection
  INSERT INTO public.user_oauth_connections
    (user_id, server_name, vault_id, refresh_vault_id, scope, expires_at)
  VALUES
    (p_user_id, p_server_name, v_access_vault_id, v_refresh_vault_id, p_scope, p_expires_at);

  RETURN TRUE;
EXCEPTION WHEN OTHERS THEN
  RETURN FALSE;
END;
$$;

-- RPC: get OAuth access token for proxy injection
CREATE OR REPLACE FUNCTION public.get_oauth_token(
  p_user_id     UUID,
  p_server_name TEXT
)
RETURNS TEXT
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, vault
AS $$
DECLARE
  v_vault_id UUID;
  v_token    TEXT;
  v_expires  TIMESTAMPTZ;
BEGIN
  SELECT vault_id, expires_at INTO v_vault_id, v_expires
  FROM public.user_oauth_connections
  WHERE user_id = p_user_id AND server_name = p_server_name;

  IF v_vault_id IS NULL THEN RETURN NULL; END IF;
  -- If token has expired return NULL — proxy will return 401 prompting reconnect
  IF v_expires IS NOT NULL AND v_expires < NOW() THEN RETURN NULL; END IF;

  SELECT decrypted_secret INTO v_token
  FROM vault.decrypted_secrets WHERE id = v_vault_id;

  RETURN v_token;
END;
$$;

-- RPC: list user's OAuth connections (no tokens)
CREATE OR REPLACE FUNCTION public.list_oauth_connections(p_user_id UUID)
RETURNS TABLE (
  server_name TEXT, scope TEXT, expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ, updated_at TIMESTAMPTZ
)
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  SELECT server_name, scope, expires_at, created_at, updated_at
  FROM public.user_oauth_connections
  WHERE user_id = p_user_id ORDER BY server_name;
$$;

-- RPC: delete an OAuth connection
CREATE OR REPLACE FUNCTION public.delete_oauth_connection(
  p_user_id UUID, p_server_name TEXT
)
RETURNS BOOLEAN
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, vault AS $$
DECLARE v_access UUID; v_refresh UUID;
BEGIN
  SELECT vault_id, refresh_vault_id INTO v_access, v_refresh
  FROM public.user_oauth_connections
  WHERE user_id = p_user_id AND server_name = p_server_name;
  IF v_access IS NULL THEN RETURN FALSE; END IF;
  DELETE FROM vault.secrets WHERE id = v_access;
  IF v_refresh IS NOT NULL THEN DELETE FROM vault.secrets WHERE id = v_refresh; END IF;
  DELETE FROM public.user_oauth_connections WHERE user_id = p_user_id AND server_name = p_server_name;
  RETURN TRUE;
END;
$$;

-- Grant to service_role only — never anon or authenticated directly
REVOKE ALL ON FUNCTION public.store_oauth_connection  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.get_oauth_token         FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.list_oauth_connections  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.delete_oauth_connection FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.store_oauth_connection  TO service_role;
GRANT EXECUTE ON FUNCTION public.get_oauth_token         TO service_role;
GRANT EXECUTE ON FUNCTION public.list_oauth_connections  TO service_role;
GRANT EXECUTE ON FUNCTION public.delete_oauth_connection TO service_role;

-- ── Verification ──────────────────────────────────────────────────────────────
-- After migration, verify vault is accessible:
--   SELECT vault.create_secret('test', 'oauth-test', 'test') AS id;
--   SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'oauth-test';
--   DELETE FROM vault.secrets WHERE name = 'oauth-test';
