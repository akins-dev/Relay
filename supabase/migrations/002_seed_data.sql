-- ─────────────────────────────────────────────────────────────────────────────
-- Retired Seed Migration
--
-- Historical demo server rows were removed once ingest became the canonical
-- source of registry truth. This migration is intentionally kept as a no-op so
-- existing migration order remains stable for fresh environments.
-- ─────────────────────────────────────────────────────────────────────────────
DO $$
BEGIN
  RAISE NOTICE '002_seed_data.sql is retired. No demo servers inserted.';
END $$;
