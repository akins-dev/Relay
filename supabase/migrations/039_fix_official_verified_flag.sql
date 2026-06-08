-- ─────────────────────────────────────────────────────────────────────────────
-- 039_fix_official_verified_flag.sql
--
-- The official ingest fetcher was incorrectly setting verified = true for all
-- 'active' servers. The 'verified' flag is strictly for servers that have been
-- vouched for by a trusted third-party curator (like Smithery or mcp.directory).
-- Since the official registry is an open platform, no server should be marked
-- as verified purely because it comes from the official source.
--
-- This migration cleans up the polluted database state. It sets verified = false
-- for all servers originally sourced from 'official', UNLESS they have an
-- mcp_directory_id, which means they successfully passed through the enrichment
-- pipeline and were explicitly verified by mcp.directory.
-- ─────────────────────────────────────────────────────────────────────────────

BEGIN;

UPDATE public.servers
SET verified = false
WHERE source = 'official'
  AND verified = true
  AND mcp_directory_id IS NULL;

-- Also update the security scan audit trail or trust scores if needed?
-- The cron jobs will automatically recalculate the trust score during the next
-- pass, so we don't need to manually re-trigger compute_trust_score_v2 here.

COMMIT;

NOTIFY pgrst, 'reload schema';
