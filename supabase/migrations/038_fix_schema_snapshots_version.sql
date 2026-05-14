-- ─────────────────────────────────────────────────────────────────────────────
-- Fix: schema_snapshots.version NOT NULL constraint
--
-- The schema_snapshots trigger fires on every INSERT/UPDATE to servers.
-- It copies NEW.version into schema_snapshots.version, which has a NOT NULL
-- constraint from 001_initial_schema.sql. But many upstream sources (Smithery,
-- Glama, mcp.directory) do not provide a version — they store NULL.
-- This causes every upsert for those servers to fail with:
--   "null value in column "version" of relation "schema_snapshots" violates not-null constraint"
--
-- Fix: Allow NULL in schema_snapshots.version, and default to 'unknown' in
-- the trigger so existing queries that filter on version still work.
-- ─────────────────────────────────────────────────────────────────────────────

-- Step 1: Allow NULL on the column
ALTER TABLE public.schema_snapshots
  ALTER COLUMN version DROP NOT NULL;

-- Step 2: Default existing NULLs (none exist yet since the trigger blocked them)
-- No-op but safe to include
UPDATE public.schema_snapshots SET version = 'unknown' WHERE version IS NULL;

-- Step 3: Update the trigger to handle NULL version gracefully
CREATE OR REPLACE FUNCTION public.capture_schema_snapshot()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  IF TG_OP = 'INSERT' OR OLD.schema_hash IS DISTINCT FROM NEW.schema_hash THEN
    INSERT INTO public.schema_snapshots (server_id, schema_hash, tools, version)
    VALUES (NEW.id, NEW.schema_hash, NEW.tools, COALESCE(NEW.version, 'unknown'));
  END IF;
  RETURN NEW;
END;
$$;
