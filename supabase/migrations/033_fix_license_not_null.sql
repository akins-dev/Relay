-- Migration: 033_fix_license_not_null
--
-- Problem:
--   The `servers.license` column was declared:
--     license TEXT NOT NULL DEFAULT 'MIT'
--
--   PostgreSQL's DEFAULT only fires when the column is **omitted** from an
--   INSERT/UPSERT. The ingest pipeline passes `license = NULL` explicitly
--   (because official, Smithery, and mcp_directory sources carry no license data),
--   which overrides the column default and trips the NOT NULL constraint.
--   This caused `code=23502` errors for every server from those sources:
--
--     "value in column "license" of relation "servers" violates not-null constraint"
--
--   The 'MIT' default was also semantically incorrect: an unlicensed server is
--   not automatically MIT — it is unlicensed/unknown.
--
-- Fix:
--   1. Backfill any existing NULL rows with 'unknown' (defensive — should be zero
--      due to the historical DEFAULT, but covers any race conditions).
--   2. Change the column DEFAULT from 'MIT' to 'unknown'.
--      The NOT NULL constraint is preserved — 'unknown' is the correct sentinel
--      for "license not declared by upstream". The ingest pipeline (pipeline.ts)
--      now writes `s.license ?? 'unknown'` instead of `s.license ?? null`.
--   3. The Glama enrichment pass already patches `license` when Glama provides
--      a real SPDX identifier — the pipeline guard was widened to also overwrite
--      the 'unknown' sentinel so real data is not blocked.
--
-- No schema addictions, no new indexes. Pure data correctness fix.

-- 1. Backfill NULLs (defensive — guards against any rows inserted before migration)
UPDATE public.servers
SET license = 'unknown'
WHERE license IS NULL;

-- 2. Correct the column default
ALTER TABLE public.servers
  ALTER COLUMN license SET DEFAULT 'unknown';

NOTIFY pgrst, 'reload schema';
