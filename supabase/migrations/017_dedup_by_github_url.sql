-- Migration 017: Deduplicate servers that share the same github_url
-- Keeps the row with the highest trust_score (best data quality).
-- Runs once to clean up cross-source duplicates already in the DB.

-- Step 1: Find duplicates — same github_url, different server rows
-- Step 2: For each group, keep the one with highest trust_score, delete the rest

DELETE FROM public.servers
WHERE id IN (
  SELECT id FROM (
    SELECT
      id,
      ROW_NUMBER() OVER (
        PARTITION BY LOWER(REPLACE(github_url, '.git', ''))
        ORDER BY trust_score DESC, created_at ASC
      ) AS rn
    FROM public.servers
    WHERE github_url IS NOT NULL
      AND github_url != ''
  ) ranked
  WHERE rn > 1
);

-- Report how many remain
DO $$
DECLARE
  cnt INTEGER;
BEGIN
  SELECT COUNT(*) INTO cnt FROM public.servers;
  RAISE NOTICE 'Dedup complete. % servers remain.', cnt;
END $$;
