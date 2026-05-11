-- ─────────────────────────────────────────────────────────────────────────────
-- 035_search_v2.sql
--
-- S12: Collapse 3 DB roundtrips → 1 per search call.
--   Before: search_servers() + servers.in(ids) + get_intent_boosts() = 3 calls
--   After:  search_servers(p_intent_hash) = 1 call
--           Intent-specific boost data folded into second LATERAL join inside
--           the function body. The route handler needs no extra RPC calls.
--
-- S13 (SQL side): Update ranking_boost from linear to exponential half-life decay.
--   14-day half-life matches newServerRankingBoost() in security.ts.
--
-- S14: Add get_all_behavioral_reliability() for the uptime cron.
--   Before: fetches ALL ISM rows for N servers, aggregates in TypeScript = O(ISM rows)
--   After:  single SQL GROUP BY returning (server_name, invoke_count, success_count)
--           = O(N servers) network transfer, aggregation done in Postgres.
--
-- New columns added to search_servers():
--   tool_extraction_source TEXT   — needed by route (was triggering 2nd DB fetch)
--   intent_invoke_count    BIGINT — invocations for THIS specific intent_hash
--   intent_success_rate    FLOAT8 — success rate for THIS specific intent_hash (0–1)
--   intent_avg_latency_ms  FLOAT8 — avg latency for THIS specific intent_hash
--
-- Backward compatible: all new parameters have defaults, all new columns are
-- nullable. Existing callers without p_intent_hash still work correctly.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── 1. Recreate search_servers() with intent boost + tool_extraction_source ───

DROP FUNCTION IF EXISTS public.search_servers(TEXT, INTEGER, BOOLEAN);

CREATE OR REPLACE FUNCTION public.search_servers(
  query_text    TEXT,
  result_limit  INTEGER DEFAULT 10,
  include_stdio BOOLEAN DEFAULT FALSE,
  -- S12: new parameter — pass the intent hash so we can fold the boost LATERAL
  -- into a single function call. Defaults to '' (no boost) for backward compat.
  p_intent_hash TEXT    DEFAULT ''
)
RETURNS TABLE (
  id                     UUID,
  name                   TEXT,
  display_name           TEXT,
  description            TEXT,
  endpoint               TEXT,
  version                TEXT,
  github_url             TEXT,
  icon_url               TEXT,
  tags                   TEXT[],
  tools                  TEXT[],
  tool_schemas           JSONB,
  env_var_schema         JSONB,
  package_info           JSONB,
  tool_extraction_source TEXT,    -- S12: added — was causing 2nd DB fetch in route
  trust_score            NUMERIC,
  verified               BOOLEAN,
  is_canonical           BOOLEAN,
  source                 TEXT,
  scan_status            TEXT,
  cve_issues             JSONB,
  latency_ms             INTEGER,
  uptime_pct             NUMERIC,
  stars                  INTEGER,
  use_count              INTEGER,
  invoke_count           BIGINT,    -- total invocations across ALL intents
  calls_today            INTEGER,
  is_new                 BOOLEAN,
  transport              TEXT,
  proxy_available        BOOLEAN,
  auth_type              TEXT,
  auth_setup_url         TEXT,
  -- S12: new intent-specific boost columns (NULL when p_intent_hash = '' or no data)
  intent_invoke_count    BIGINT,
  intent_success_rate    FLOAT8,
  intent_avg_latency_ms  FLOAT8
)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  WITH base AS (
    SELECT
      s.*,
      (s.created_at > NOW() - INTERVAL '90 days')                       AS is_new,
      -- S13 (SQL): Exponential half-life decay — 14-day half-life.
      -- Matches newServerRankingBoost() in security.ts after the S13 patch.
      -- Old formula (linear): 1.0 + 0.4 * (1 - days/90)
      -- New formula (exponential): 1.0 + 0.4 * 0.5^(days/14)
      --   Day 0:  +40%  Day 14: +20%  Day 28: +10%  Day 90: ≈0%
      CASE
        WHEN s.created_at > NOW() - INTERVAL '90 days'
        THEN 1.0 + 0.4 * POWER(
          0.5,
          EXTRACT(EPOCH FROM (NOW() - s.created_at)) / (14.0 * 86400)
        )
        ELSE 1.0
      END                                                                AS ranking_boost,
      CASE
        WHEN query_text = '' THEN 0
        ELSE ts_rank(s.search_vector, plainto_tsquery('english', query_text))
      END                                                                AS text_rank,
      similarity(s.name, query_text)                                     AS name_sim,
      -- LATERAL 1: total relay invoke count across ALL intents (existing — for ranking)
      rel.invoke_count                                                   AS relay_invoke_count,
      -- LATERAL 2: S12 — intent-specific boost data for THIS search query.
      -- Returns NULL columns when p_intent_hash is empty (no intent provided).
      -- This eliminates the separate get_intent_boosts() RPC call in the route.
      boost.intent_invoke_count,
      boost.intent_success_rate,
      boost.intent_avg_latency_ms
    FROM public.servers s
    -- LATERAL 1: total invoke count (all intents) — used for ranking tiebreaker
    LEFT JOIN LATERAL (
      SELECT COALESCE(SUM(ism.invoke_count), 0) AS invoke_count
      FROM public.intent_server_mappings ism
      WHERE ism.server_name = s.name
    ) rel ON TRUE
    -- LATERAL 2: intent-specific success data — used for confidence scoring
    -- Skipped (returns NULL) when p_intent_hash is '' to avoid full-table scan.
    LEFT JOIN LATERAL (
      SELECT
        SUM(ism.invoke_count)::BIGINT                                      AS intent_invoke_count,
        CASE
          WHEN SUM(ism.invoke_count) > 0
          THEN SUM(ism.success_count)::FLOAT8 / SUM(ism.invoke_count)::FLOAT8
          ELSE NULL
        END                                                                AS intent_success_rate,
        AVG(ism.avg_latency_ms)                                            AS intent_avg_latency_ms
      FROM public.intent_server_mappings ism
      WHERE ism.server_name = s.name
        AND p_intent_hash != ''           -- skip entirely when no intent hash provided
        AND ism.intent_hash = p_intent_hash
    ) boost ON TRUE
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
  -- Compute the median trust_score of THIS result set for a relative threshold.
  category_counts AS (
    SELECT
      tags[1]      AS primary_tag,
      COUNT(*)     AS result_count
    FROM base
    GROUP BY tags[1]
  ),
  result_median AS (
    SELECT PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY trust_score) AS median_score
    FROM base
  )
  SELECT
    b.id, b.name, b.display_name, b.description, b.endpoint, b.version,
    b.github_url, b.icon_url, b.tags, b.tools, b.tool_schemas,
    b.env_var_schema, b.package_info,
    b.tool_extraction_source,           -- S12: new column, eliminates 2nd DB call
    b.trust_score, b.verified, b.is_canonical, b.source,
    b.scan_status, b.cve_issues, b.latency_ms, b.uptime_pct, b.stars,
    b.use_count,
    b.relay_invoke_count                AS invoke_count,
    b.calls_today, b.is_new, b.transport, b.proxy_available,
    b.auth_type, b.auth_setup_url,
    -- S12: intent-specific boost columns
    b.intent_invoke_count,
    b.intent_success_rate,
    b.intent_avg_latency_ms
  FROM base b
  LEFT JOIN category_counts cc ON cc.primary_tag = b.tags[1]
  CROSS JOIN result_median rm
  ORDER BY
    -- Tier 1: Smithery-curated canonical servers always rank first.
    b.is_canonical DESC,
    -- Tier 2: Semantic relevance × new-server ranking boost (now exponential decay).
    (b.text_rank + b.name_sim + 0.001) * b.ranking_boost DESC,
    -- Tier 3: Trust score with diversity soft-penalty.
    --   8% penalty for over-represented categories below result-set median.
    CASE
      WHEN cc.result_count > 2
       AND b.trust_score < rm.median_score
      THEN b.trust_score * 0.92
      ELSE b.trust_score
    END DESC,
    -- Tier 4: Smithery popularity as secondary tiebreaker (not a trust signal).
    COALESCE(b.use_count, 0) DESC,
    -- Tier 5: Relay measured invoke count as final tiebreaker.
    b.relay_invoke_count DESC
  LIMIT result_limit;
$$;

GRANT EXECUTE ON FUNCTION public.search_servers TO anon, authenticated, service_role;

COMMENT ON FUNCTION public.search_servers IS
  '035: Added p_intent_hash parameter and intent-specific boost LATERAL join. '
  'Returns tool_extraction_source (eliminates 2nd DB fetch in route). '
  'Intent boost columns (intent_invoke_count, intent_success_rate, intent_avg_latency_ms) '
  'are populated only when p_intent_hash is non-empty. '
  'Ranking boost updated to exponential half-life decay (14-day half-life, matches security.ts).';

-- ── 2. get_all_behavioral_reliability() — S14 ─────────────────────────────────
-- Used by the uptime cron to batch-fetch reliability for N servers in one call.
--
-- Before (uptime.ts):
--   .from("intent_server_mappings")
--   .select("server_name, invoke_count, success_count")
--   .in("server_name", serverNames)
--   → fetches ALL ISM rows matching server names across ALL intents.
--   Then TypeScript aggregates them. O(all ISM rows for these servers).
--
-- After:
--   .rpc("get_all_behavioral_reliability", { p_server_names: serverNames })
--   → SQL GROUP BY server_name aggregates in Postgres. O(servers) network transfer.
--   TypeScript receives pre-aggregated (server_name, invoke_count, success_count).

DROP FUNCTION IF EXISTS public.get_all_behavioral_reliability(TEXT[]);

CREATE OR REPLACE FUNCTION public.get_all_behavioral_reliability(
  p_server_names TEXT[]
)
RETURNS TABLE (
  server_name   TEXT,
  invoke_count  BIGINT,
  success_count BIGINT
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    ism.server_name,
    SUM(ism.invoke_count)::BIGINT   AS invoke_count,
    SUM(ism.success_count)::BIGINT  AS success_count
  FROM public.intent_server_mappings ism
  WHERE ism.server_name = ANY(p_server_names)
  GROUP BY ism.server_name;
$$;

GRANT EXECUTE ON FUNCTION public.get_all_behavioral_reliability TO service_role;

COMMENT ON FUNCTION public.get_all_behavioral_reliability IS
  'S14: Batch behavioral reliability aggregation for the uptime cron. '
  'Aggregates invoke_count and success_count across ALL intents per server via GROUP BY. '
  'Replaces the O(all ISM rows) TypeScript loop in uptime.ts with a single SQL call. '
  'Returns only servers that have at least one ISM row — absent servers get 0,0 defaults in TS.';

-- ── 3. Ensure composite index for the intent-boost LATERAL join ───────────────
-- The LATERAL 2 join filters on (server_name, intent_hash).
-- CREATE INDEX IF NOT EXISTS is idempotent — safe to re-run.
-- Note: CONCURRENTLY is not used here because Supabase migrations run inside a
-- transaction block, and CONCURRENTLY is forbidden inside transactions.
-- A brief table lock during migration is acceptable; use CONCURRENTLY only for
-- ad-hoc index creation on a live production table outside of a migration.
CREATE INDEX IF NOT EXISTS idx_ism_server_intent
  ON public.intent_server_mappings (server_name, intent_hash);

NOTIFY pgrst, 'reload schema';
