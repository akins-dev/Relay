-- ═══════════════════════════════════════════════════════════════════════════════
-- openMCP — Migration 011: Vault-based credential storage
-- ═══════════════════════════════════════════════════════════════════════════════
--
-- ⚠️  CRITICAL — READ BEFORE RUNNING ⚠️
-- ─────────────────────────────────────
-- Before running this migration, confirm your Supabase project is NOT configured
-- to log data statements that include SQL values:
--
--   Verify from SQL Editor with:
--
--     SELECT name, setting
--     FROM pg_settings
--     WHERE name IN ('log_statement', 'pgaudit.log', 'pgaudit.log_parameter');
--
--   Safe baseline for openMCP:
--     log_statement = 'ddl' or 'none'
--     pgaudit.log = 'none'
--     pgaudit.log_parameter = 'off'
--
--   WHY: When your application stores a secret or OAuth token, the SQL statement
--   can contain the plaintext value. If statement logging captures data
--   statements, those secrets can land in Supabase logs unencrypted.
--   That defeats the whole purpose of vault-backed storage.
--
--   IMPORTANT: This is an ongoing platform configuration requirement, not a
--   one-time migration setting. The risk continues after this migration when
--   real users store secrets through store_user_secret() and store_oauth_connection().
--
--   Supabase hosted projects usually default to DDL-only logging, which is
--   acceptable here. Verify your actual project setting before proceeding.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── Enable Vault extension ────────────────────────────────────────────────────
-- Vault is enabled by default on Supabase hosted. This is a no-op if already on.
-- On local: CREATE EXTENSION IF NOT EXISTS supabase_vault CASCADE;

-- ── User secrets registry table ──────────────────────────────────────────────
-- Tracks WHICH secrets a user has stored and for WHICH server.
-- The actual secret value lives in vault.secrets — not here.
-- This table contains only metadata + the vault secret ID (a UUID pointer).
CREATE TABLE IF NOT EXISTS public.user_secrets (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id       UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  server_name   TEXT,             -- NULL = applies to any server (global secret)
  secret_name   TEXT NOT NULL,    -- e.g. 'STRIPE_API_KEY', 'GITHUB_TOKEN'
  vault_id      UUID NOT NULL,    -- pointer into vault.secrets — never store secret here
  description   TEXT,             -- human-readable note
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- A user can only have one secret per (server_name, secret_name) combination
  UNIQUE(user_id, server_name, secret_name)
);

CREATE INDEX IF NOT EXISTS idx_user_secrets_user_server
  ON public.user_secrets(user_id, server_name);

-- RLS — users manage only their own secrets
ALTER TABLE public.user_secrets ENABLE ROW LEVEL SECURITY;

CREATE POLICY "user_secrets_own_only"
  ON public.user_secrets FOR ALL TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- ── Vault RPC functions ───────────────────────────────────────────────────────
-- All vault operations go through service_role only (bypasses RLS).
-- Never expose vault operations to anon or authenticated roles directly.
-- These are called from our Next.js server using the service role key.

-- Store a secret for a user
-- Returns the vault_id (UUID) which is stored in user_secrets.vault_id
CREATE OR REPLACE FUNCTION public.store_user_secret(
  p_user_id     UUID,
  p_server_name TEXT,     -- NULL for global secrets
  p_secret_name TEXT,
  p_secret_value TEXT,    -- the actual API key / token
  p_description TEXT DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER  -- runs as postgres, not the calling user
SET search_path = public, vault
AS $$
DECLARE
  v_vault_id    UUID;
  v_secret_key  TEXT;
  v_old_vault_id UUID;
BEGIN
  -- Build a unique key for this secret in the vault
  v_secret_key := 'openmcp:' || p_user_id::TEXT || ':' || COALESCE(p_server_name, '_global') || ':' || p_secret_name;

  -- Check if secret already exists (update case)
  SELECT vault_id INTO v_old_vault_id
  FROM public.user_secrets
  WHERE user_id = p_user_id
    AND (server_name = p_server_name OR (server_name IS NULL AND p_server_name IS NULL))
    AND secret_name = p_secret_name;

  IF v_old_vault_id IS NOT NULL THEN
    -- Update existing vault secret
    UPDATE vault.secrets
    SET secret = p_secret_value,
        updated_at = NOW()
    WHERE id = v_old_vault_id;

    -- Update metadata
    UPDATE public.user_secrets
    SET description = COALESCE(p_description, description),
        updated_at = NOW()
    WHERE vault_id = v_old_vault_id;

    RETURN v_old_vault_id;
  ELSE
    -- Insert new vault secret
    -- NOTE: vault.create_secret encrypts the value — never stored plaintext
    SELECT vault.create_secret(p_secret_value, v_secret_key, COALESCE(p_description, ''))
    INTO v_vault_id;

    -- Register in our metadata table
    INSERT INTO public.user_secrets (user_id, server_name, secret_name, vault_id, description)
    VALUES (p_user_id, p_server_name, p_secret_name, v_vault_id, p_description);

    RETURN v_vault_id;
  END IF;
END;
$$;

-- Retrieve a decrypted secret value for a user
-- Called by the proxy at runtime — service role only
-- Returns NULL if not found (proxy then returns structured 401)
CREATE OR REPLACE FUNCTION public.get_user_secret(
  p_user_id     UUID,
  p_server_name TEXT,
  p_secret_name TEXT
)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, vault
AS $$
DECLARE
  v_vault_id UUID;
  v_secret   TEXT;
BEGIN
  -- Look up vault ID: try server-specific first, then global fallback
  SELECT us.vault_id INTO v_vault_id
  FROM public.user_secrets us
  WHERE us.user_id = p_user_id
    AND us.secret_name = p_secret_name
    AND (
      us.server_name = p_server_name      -- exact server match
      OR us.server_name IS NULL           -- global fallback
    )
  ORDER BY
    (us.server_name IS NOT NULL) DESC     -- server-specific takes priority over global
  LIMIT 1;

  IF v_vault_id IS NULL THEN
    RETURN NULL;  -- proxy returns structured 401
  END IF;

  -- Decrypt from vault — pgsodium handles this, key never leaves the database
  SELECT decrypted_secret INTO v_secret
  FROM vault.decrypted_secrets
  WHERE id = v_vault_id;

  RETURN v_secret;
END;
$$;

-- List a user's stored secrets (metadata only — never returns values)
CREATE OR REPLACE FUNCTION public.list_user_secrets(
  p_user_id UUID
)
RETURNS TABLE (
  id           UUID,
  server_name  TEXT,
  secret_name  TEXT,
  description  TEXT,
  created_at   TIMESTAMPTZ,
  updated_at   TIMESTAMPTZ
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT id, server_name, secret_name, description, created_at, updated_at
  FROM public.user_secrets
  WHERE user_id = p_user_id
  ORDER BY server_name NULLS LAST, secret_name;
$$;

-- Delete a secret (removes from both our registry and vault)
CREATE OR REPLACE FUNCTION public.delete_user_secret(
  p_user_id  UUID,
  p_secret_id UUID
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, vault
AS $$
DECLARE
  v_vault_id UUID;
BEGIN
  -- Get vault ID and verify ownership
  SELECT vault_id INTO v_vault_id
  FROM public.user_secrets
  WHERE id = p_secret_id AND user_id = p_user_id;

  IF v_vault_id IS NULL THEN
    RETURN FALSE;
  END IF;

  -- Delete from vault
  DELETE FROM vault.secrets WHERE id = v_vault_id;

  -- Delete from registry
  DELETE FROM public.user_secrets WHERE id = p_secret_id;

  RETURN TRUE;
END;
$$;

-- ── Grant execute to service_role only ────────────────────────────────────────
-- These functions are NEVER callable by anon or authenticated roles directly.
-- They can only be called from our Next.js server using the service role key.
REVOKE ALL ON FUNCTION public.store_user_secret FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.get_user_secret   FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.list_user_secrets  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.delete_user_secret FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.store_user_secret TO service_role;
GRANT EXECUTE ON FUNCTION public.get_user_secret   TO service_role;
GRANT EXECUTE ON FUNCTION public.list_user_secrets  TO service_role;
GRANT EXECUTE ON FUNCTION public.delete_user_secret TO service_role;

-- ── Credential required metadata ─────────────────────────────────────────────
-- Ingest stores which secrets each server needs.
-- Used by the proxy to return a helpful 401 with setup instructions.
CREATE TABLE IF NOT EXISTS public.server_credential_hints (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  server_name  TEXT NOT NULL REFERENCES public.servers(name) ON DELETE CASCADE,
  secret_name  TEXT NOT NULL,           -- suggested name, e.g. 'STRIPE_API_KEY'
  required     BOOLEAN NOT NULL DEFAULT TRUE,
  description  TEXT NOT NULL,           -- "Your Stripe secret key from dashboard.stripe.com"
  obtain_url   TEXT,                    -- "https://dashboard.stripe.com/apikeys"
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(server_name, secret_name)
);

-- Public read — agents need this to tell users what to configure
ALTER TABLE public.server_credential_hints ENABLE ROW LEVEL SECURITY;
CREATE POLICY "hints_public_read" ON public.server_credential_hints FOR SELECT TO anon, authenticated USING (TRUE);

-- ── Verification: confirm vault is working ────────────────────────────────────
-- Run this query after migration to verify vault is operational.
-- Use only fake test values here:
--
--   SELECT vault.create_secret('test-value', 'test-key', 'Migration verification test') AS vault_id;
--   SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'test-key';
--   -- Should return 'test-value'
--   DELETE FROM vault.secrets WHERE name = 'test-key';
--
-- If this works: vault is operational.
-- If you get permission errors: check that pgsodium root key is configured.
