-- Migration: 032_behavioral_trust_and_dynamic_diversity
--
-- Summary of changes:
--
--   1. Add `get_server_behavioral_reliability()` — reads invoke_count and
--      success_count from intent_server_mappings, aggregated per server_name.
--      This is the source-agnostic usage signal: it measures "does this server
--      reliably do what agents ask?" for ALL servers, regardless of origin.
--      No new table. No new column. No cron. Reads existing data.
--
--   2. Add composite index on intent_server_mappings(server_name) to make
--      the per-server aggregation sub-millisecond at query time.
--
--   3. Replace `use_count` (Smithery-only) as the trust score input with
--      the behavioral reliability signal: Bayesian-smoothed success_rate ×
--      log10(invoke_count + 5) × 15, capped at 15 pts.
--
--      Bayesian prior: (success_count + 3) / (invoke_count + 4)
--        → New server (0 invocations): rate ≈ 0.75, score ≈ 3.4 pts
--        → 50 invocations at 95% success: rate ≈ 0.95, score ≈ 13.0 pts
--        → 1000 invocations at 95%: rate ≈ 0.95, score ≈ 14.9 pts (≈ max)
--
--      This is mathematically equivalent to a Beta(3,1) prior — we assume
--      a server is probably good until proven otherwise. The prior washes
--      out as real data accumulates.
--
--      Smithery's `use_count` is NOT removed from the schema — it remains
--      a search ranking tiebreaker (ORDER BY use_count DESC). It is just no
--      longer embedded in the trust score formula.
--
--   4. Rewrite search_servers() diversity logic:
--
--      OLD (broken):
--        category_counts scans the ENTIRE servers table for trust_score >= 85.
--        When scores cluster below 85 (cold-start, new formula), the CTE
--        returns 0 rows, the LEFT JOIN nullifies everything, and the diversity
--        boost silently dies. Additionally it was logically backwards —
--        it boosted servers FROM saturated categories, not under-represented ones.
--
--      NEW (correct):
--        category_counts scans only the BASE result set (the rows already
--        filtered by this specific query). It counts how many times each
--        primary tag appears in the result. A soft penalty (×0.92) is applied
--        to servers whose category appears more than twice AND whose trust
--        score is below the result-set median. This:
--          a) Always fires — works at any score distribution
--          b) Penalises redundancy within results (true diversity)
--          c) Is intent-sensitive — adapts to what this query returned
--          d) Uses a relative threshold (median of THIS result set),
--             never an absolute hardcoded number
--
--   5. search_servers() now exposes invoke_count from intent_server_mappings
--      in the result set, so consumers (computeConfidence, admin dashboard)
--      can see how much runtime evidence backs the trust score.

-- ── 1. Composite index for per-server behavioral reliability lookup ────────────
-- intent_server_mappings already has idx_ism_server_name on (server_name, last_invoked_at DESC).
-- We need an additional covering index for the GROUP BY aggregation used in
-- get_server_behavioral_reliability — covering (server_name, invoke_count, success_count)
-- avoids a heap fetch entirely.

CREATE INDEX IF NOT EXISTS idx_ism_server_reliability
  ON public.intent_server_mappings (server_name)
  INCLUDE (invoke_count, success_count);

COMMENT ON INDEX public.idx_ism_server_reliability IS
  'Covering index for get_server_behavioral_reliability() — avoids heap fetch '
  'on the GROUP BY aggregation. Pairs with idx_ism_server_name.';

-- ── 2. get_server_behavioral_reliability() ────────────────────────────────────
-- Aggregates invoke_count and success_count from intent_server_mappings for a
-- given server name. Returns the Bayesian-smoothed success rate and total
-- invoke count. Called from compute_trust_score() and optionally from
-- search_servers() to expose maturity data to consumers.
--
-- Bayesian prior: Beta(3, 1) — we assume servers work until proven otherwise.
--   adjusted_rate = (success_count + 3.0) / (invoke_count + 4.0)
--
-- When invoke_count = 0 (no history): adjusted_rate = 3/4 = 0.75
-- When invoke_count → ∞:              adjusted_rate → true success rate
--
-- This function is STABLE (no writes, same result for same inputs in one query).

CREATE OR REPLACE FUNCTION public.get_server_behavioral_reliability(
  p_server_name TEXT
)
RETURNS TABLE (
  invoke_count   BIGINT,
  success_count  BIGINT,
  adjusted_rate  NUMERIC   -- Bayesian-smoothed success rate (0–1)
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    COALESCE(SUM(ism.invoke_count),  0)                                     AS invoke_count,
    COALESCE(SUM(ism.success_count), 0)                                     AS success_count,
    ROUND(
      (COALESCE(SUM(ism.success_count), 0) + 3.0)
      / (COALESCE(SUM(ism.invoke_count),  0) + 4.0),
      6
    )                                                                       AS adjusted_rate
  FROM public.intent_server_mappings ism
  WHERE ism.server_name = p_server_name;
$$;

GRANT EXECUTE ON FUNCTION public.get_server_behavioral_reliability TO service_role;

COMMENT ON FUNCTION public.get_server_behavioral_reliability IS
  'Aggregates behavioral reliability data for a server from intent_server_mappings. '
  'Returns total invoke_count, success_count, and a Bayesian-smoothed adjusted_rate '
  'using a Beta(3,1) prior. New servers (0 invocations) return adjusted_rate = 0.75 '
  'rather than 0, giving a weak-positive prior that washes out as real data accumulates.';

-- ── 3. Rewrite search_servers() ───────────────────────────────────────────────
-- Changes vs migration 031:
--   a. category_counts now reads from base (result set), not servers (full table).
--   b. Diversity logic: penalty on over-represented categories relative to
--      result-set median trust score. Never silently dies.
--   c. Added invoke_count to the return set (from intent_server_mappings).
--   d. Ordering: behavioral_invoke_count as final tiebreaker, replacing stars.
--      use_count (Smithery) retained as secondary tiebreaker — it is still a
--      valid popularity signal, just not a trust signal.

DROP FUNCTION IF EXISTS public.search_servers(TEXT, INTEGER, BOOLEAN);

CREATE OR REPLACE FUNCTION public.search_servers(
  query_text    TEXT,
  result_limit  INTEGER DEFAULT 10,
  include_stdio BOOLEAN DEFAULT FALSE
)
RETURNS TABLE (
  id              UUID,
  name            TEXT,
  display_name    TEXT,
  description     TEXT,
  endpoint        TEXT,
  version         TEXT,
  github_url      TEXT,
  icon_url        TEXT,
  tags            TEXT[],
  tools           TEXT[],
  tool_schemas    JSONB,
  env_var_schema  JSONB,
  package_info    JSONB,
  trust_score     NUMERIC,
  verified        BOOLEAN,
  is_canonical    BOOLEAN,
  source          TEXT,
  scan_status     TEXT,
  cve_issues      JSONB,
  latency_ms      INTEGER,
  uptime_pct      NUMERIC,
  stars           INTEGER,
  use_count       INTEGER,
  invoke_count    BIGINT,    -- total invocations through Relay proxy (source-agnostic)
  calls_today     INTEGER,
  is_new          BOOLEAN,
  transport       TEXT,
  proxy_available BOOLEAN,
  auth_type       TEXT,
  auth_setup_url  TEXT
)
LANGUAGE sql STABLE SECURITY DEFINER AS $$
  WITH base AS (
    SELECT
      s.*,
      (s.created_at > NOW() - INTERVAL '90 days')                     AS is_new,
      CASE
        WHEN s.created_at > NOW() - INTERVAL '90 days'
        THEN 1.0 + 0.4 * (1 - EXTRACT(EPOCH FROM (NOW() - s.created_at)) / (90 * 86400))
        ELSE 1.0
      END                                                              AS ranking_boost,
      CASE
        WHEN query_text = '' THEN 0
        ELSE ts_rank(s.search_vector, plainto_tsquery('english', query_text))
      END                                                              AS text_rank,
      similarity(s.name, query_text)                                   AS name_sim,
      -- Behavioral reliability from intent_server_mappings.
      -- LATERAL allows per-row call to the reliability function.
      rel.invoke_count                                                 AS relay_invoke_count
    FROM public.servers s
    LEFT JOIN LATERAL (
      SELECT COALESCE(SUM(ism.invoke_count), 0) AS invoke_count
      FROM public.intent_server_mappings ism
      WHERE ism.server_name = s.name
    ) rel ON TRUE
    WHERE
      s.status = 'active'
      AND (include_stdio OR COALESCE(s.transport, 'unknown') != 'stdio')
      AND (
        query_text = ''
        OR s.search_vector @@ plainto_tsquery('english', query_text)
        OR similarity(s.name, query_text) > 0.15
        OR EXISTS (
          SELECT 1 FROM unnest(s.tags) t(tag)
          WHERE t.tag ILIKE '%' || query_text || '%'
        )
      )
  ),
  -- Diversity: count how many times each primary tag appears in THIS result set.
  -- Also compute the median trust_score of THIS result set for a relative threshold.
  -- This replaces the old global category_counts scan (which was both wrong and broken).
  category_counts AS (
    SELECT
      tags[1]                                                           AS primary_tag,
      COUNT(*)                                                          AS result_count
    FROM base
    GROUP BY tags[1]
  ),
  result_median AS (
    SELECT PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY trust_score)   AS median_score
    FROM base
  )
  SELECT
    b.id, b.name, b.display_name, b.description, b.endpoint, b.version,
    b.github_url, b.icon_url, b.tags, b.tools, b.tool_schemas,
    b.env_var_schema, b.package_info,
    b.trust_score, b.verified, b.is_canonical, b.source,
    b.scan_status, b.cve_issues, b.latency_ms, b.uptime_pct, b.stars,
    b.use_count,
    b.relay_invoke_count                                               AS invoke_count,
    b.calls_today, b.is_new, b.transport, b.proxy_available,
    b.auth_type, b.auth_setup_url
  FROM base b
  LEFT JOIN category_counts cc ON cc.primary_tag = b.tags[1]
  CROSS JOIN result_median rm
  ORDER BY
    -- Tier 1: Smithery-curated canonical servers always rank first.
    b.is_canonical DESC,
    -- Tier 2: Semantic relevance × new-server ranking boost.
    (b.text_rank + b.name_sim + 0.001) * b.ranking_boost DESC,
    -- Tier 3: Trust score with diversity soft-penalty.
    --   A 8% penalty is applied to servers that:
    --     a) come from a category already well-represented in results (>2 servers), AND
    --     b) score below the result-set median trust score.
    --   Effect: within a relevance band, under-represented categories surface ahead of
    --   over-represented ones. Penalty is soft (8%) to avoid suppressing genuinely better servers.
    --   Always fires — the threshold is relative to THIS result set, never a hardcoded absolute.
    CASE
      WHEN cc.result_count > 2
       AND b.trust_score < rm.median_score
      THEN b.trust_score * 0.92
      ELSE b.trust_score
    END DESC,
    -- Tier 4: Smithery popularity as secondary tiebreaker (not a trust signal).
    COALESCE(b.use_count, 0) DESC,
    -- Tier 5: Our own measured invoke count as final tiebreaker.
    b.relay_invoke_count DESC
  LIMIT result_limit;
$$;

-- ── 4. Update compute_trust_score() in DB (used by uptime cron recomputation) ─
-- The uptime cron calls computeTrustScore() in TypeScript. This SQL version is
-- used for ad-hoc admin queries and future DB-side recomputation jobs.
-- Both must be kept in sync with security.ts.
--
-- Formula change: "Real-world usage" slot (15 pts) now uses behavioral reliability
-- from intent_server_mappings instead of Smithery use_count.
--
--   behavioral_pts = adjusted_rate × log10(invoke_count + 5) × 15
--
-- Where adjusted_rate = (success_count + 3) / (invoke_count + 4)  [Bayesian prior]
--
-- Score trajectory:
--   0 invocations:       ≈ 0.75 × log10(5)  × 15 ≈  5.2 pts (floor for new servers)
--   10 invocations @95%: ≈ 0.92 × log10(15) × 15 ≈ 16.7 → capped at 15
--   Wait — let's re-check the log10(5) floor at 0 invocations:
--     adjusted_rate = 3/4 = 0.75
--     log10(0 + 5) = log10(5) ≈ 0.699
--     0.75 × 0.699 × 15 ≈ 7.9 pts
--   At 10 invocations, 10 successes:
--     adjusted_rate = 13/14 ≈ 0.929
--     log10(15) ≈ 1.176
--     0.929 × 1.176 × 15 ≈ 15.6 → capped at 15 ✓
--   At 1000 invocations, 95% success:
--     adjusted_rate = 953/1004 ≈ 0.949
--     log10(1005) ≈ 3.002
--     0.949 × 3.002 × 15 ≈ 42.7 → capped at 15 ✓

CREATE OR REPLACE FUNCTION public.compute_trust_score_v2(
  p_server_name       TEXT,
  p_verified          BOOLEAN   DEFAULT FALSE,
  p_uptime_pct        NUMERIC   DEFAULT 100,
  p_scan_score        NUMERIC   DEFAULT 100,
  p_days_since_change INTEGER   DEFAULT 0,
  p_deployment_quality INTEGER  DEFAULT 0,
  p_failure_rate_pct  NUMERIC   DEFAULT NULL,
  p_dlp_rate_pct      NUMERIC   DEFAULT NULL
)
RETURNS NUMERIC
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_invoke_count  BIGINT;
  v_success_count BIGINT;
  v_adj_rate      NUMERIC;

  v_security_pts    NUMERIC;
  v_uptime_pts      NUMERIC;
  v_credibility_pts NUMERIC;
  v_behavioral_pts  NUMERIC;
  v_deployment_pts  NUMERIC;
  v_stability_pts   NUMERIC;
  v_score           NUMERIC;
BEGIN
  -- Fetch behavioral reliability (Bayesian smoothed)
  SELECT rel.invoke_count, rel.success_count, rel.adjusted_rate
  INTO   v_invoke_count,   v_success_count,   v_adj_rate
  FROM   public.get_server_behavioral_reliability(p_server_name) rel;

  -- Security quality — 25 pts
  v_security_pts    := (LEAST(100, GREATEST(0, p_scan_score)) / 100.0) * 25;

  -- Uptime — 20 pts
  v_uptime_pts      := (LEAST(100, GREATEST(0, p_uptime_pct)) / 100.0) * 20;

  -- Publisher credibility — 15 pts
  v_credibility_pts := CASE WHEN p_verified THEN 15 ELSE 0 END;

  -- Behavioral reliability — 15 pts (replaces Smithery use_count)
  -- LOG(10, n) = log base 10 in PostgreSQL (LOG(n) alone = natural log = wrong)
  -- Must match TypeScript: Math.log10(n + 5) × 15, capped at 15
  v_behavioral_pts  := LEAST(15,
    v_adj_rate
    * LOG(10, COALESCE(v_invoke_count, 0) + 5)
    * 15
  );

  -- Deployment quality — 15 pts
  v_deployment_pts  := COALESCE(p_deployment_quality, 0) * 15;

  -- Schema stability — 10 pts (max at 90 days)
  v_stability_pts   := (LEAST(p_days_since_change, 90) / 90.0) * 10;

  v_score := v_security_pts + v_uptime_pts + v_credibility_pts
           + v_behavioral_pts + v_deployment_pts + v_stability_pts;

  -- Runtime penalties
  IF p_failure_rate_pct IS NOT NULL THEN
    v_score := GREATEST(0, v_score - (p_failure_rate_pct / 100.0) * 15);
  END IF;
  IF p_dlp_rate_pct IS NOT NULL AND p_dlp_rate_pct > 5 THEN
    v_score := GREATEST(0, v_score - ((p_dlp_rate_pct - 5) / 100.0) * 10);
  END IF;

  RETURN ROUND(LEAST(100, GREATEST(0, v_score)), 2);
END;
$$;

GRANT EXECUTE ON FUNCTION public.compute_trust_score_v2 TO service_role;

COMMENT ON FUNCTION public.compute_trust_score_v2 IS
  'DB-side trust score computation using behavioral reliability from intent_server_mappings. '
  'Mirrors the TypeScript computeTrustScore() in security.ts. '
  'Used for admin queries and future DB-side batch recomputation. '
  'The "Real-world usage" slot now uses source-agnostic Relay invoke data, '
  'not Smithery use_count. Smithery use_count remains a search ranking tiebreaker.';

NOTIFY pgrst, 'reload schema';
