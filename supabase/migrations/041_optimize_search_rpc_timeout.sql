-- ─────────────────────────────────────────────────────────────────────────────
-- 041_optimize_search_rpc_timeout.sql
--
-- Goal: keep tool-level intent search inside Supabase statement timeouts on
-- production catalogs with thousands of servers and many more tool rows.
--
-- The previous 040 RPC used similarity(st.search_text, query) in candidate
-- filtering and ranking. That can force expensive trigram scoring over large
-- text documents. This version keeps the same public search_servers contract
-- but uses indexed FTS and the pg_trgm `%` operator for broad tool text
-- matching, while reserving similarity scoring for short tool names.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.search_servers(
  query_text    TEXT,
  result_limit  INTEGER DEFAULT 10,
  include_stdio BOOLEAN DEFAULT TRUE,
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
  tool_extraction_source TEXT,
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
  invoke_count           BIGINT,
  calls_today            INTEGER,
  is_new                 BOOLEAN,
  transport              TEXT,
  proxy_available        BOOLEAN,
  auth_type              TEXT,
  auth_setup_url         TEXT,
  intent_invoke_count    BIGINT,
  intent_success_rate    FLOAT8,
  intent_avg_latency_ms  FLOAT8
)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  WITH q AS (
    SELECT
      trim(coalesce(query_text, '')) AS raw,
      CASE
        WHEN trim(coalesce(query_text, '')) = '' THEN NULL
        ELSE websearch_to_tsquery('english', trim(query_text))
      END AS tsq
  ),
  server_candidates AS (
    SELECT
      s.id,
      s.name,
      ts_rank_cd(s.search_vector, q.tsq, 32) AS server_rank,
      similarity(s.name, q.raw)              AS name_sim,
      row_number() OVER (
        ORDER BY
          ts_rank_cd(s.search_vector, q.tsq, 32) DESC,
          similarity(s.name, q.raw) DESC,
          s.trust_score DESC
      ) AS server_pos
    FROM public.servers s
    CROSS JOIN q
    WHERE
      s.status = 'active'
      AND (include_stdio OR COALESCE(s.transport, 'unknown') != 'stdio')
      AND (
        q.raw = ''
        OR s.search_vector @@ q.tsq
        OR similarity(s.name, q.raw) > 0.15
        OR similarity(coalesce(s.display_name, ''), q.raw) > 0.18
        OR EXISTS (
          SELECT 1 FROM unnest(s.tags) t(tag)
          WHERE t.tag ILIKE '%' || q.raw || '%'
        )
      )
    LIMIT GREATEST(result_limit * 20, 100)
  ),
  tool_candidates AS (
    SELECT
      st.server_name,
      max(ts_rank_cd(st.search_vector, q.tsq, 32)) AS tool_rank,
      max(similarity(st.tool_name, q.raw))
        + CASE WHEN bool_or(st.search_text % q.raw) THEN 0.05 ELSE 0 END AS tool_sim,
      row_number() OVER (
        ORDER BY
          max(ts_rank_cd(st.search_vector, q.tsq, 32)) DESC,
          max(similarity(st.tool_name, q.raw)) DESC
      ) AS tool_pos
    FROM public.server_tools st
    JOIN public.servers s ON s.id = st.server_id
    CROSS JOIN q
    WHERE
      s.status = 'active'
      AND (include_stdio OR COALESCE(s.transport, 'unknown') != 'stdio')
      AND (
        q.raw = ''
        OR st.search_vector @@ q.tsq
        OR similarity(st.tool_name, q.raw) > 0.12
        OR st.search_text % q.raw
      )
    GROUP BY st.server_name
    LIMIT GREATEST(result_limit * 40, 200)
  ),
  combined_names AS (
    SELECT name AS server_name FROM server_candidates
    UNION
    SELECT server_name FROM tool_candidates
  ),
  base AS (
    SELECT
      s.*,
      (s.created_at > NOW() - INTERVAL '90 days') AS is_new,
      CASE
        WHEN s.created_at > NOW() - INTERVAL '90 days'
        THEN 1.0 + 0.4 * POWER(0.5, EXTRACT(EPOCH FROM (NOW() - s.created_at)) / (14.0 * 86400))
        ELSE 1.0
      END AS ranking_boost,
      COALESCE(sc.server_rank, 0) AS server_rank,
      COALESCE(sc.name_sim, 0) AS name_sim,
      COALESCE(tc.tool_rank, 0) AS tool_rank,
      COALESCE(tc.tool_sim, 0) AS tool_sim,
      sc.server_pos,
      tc.tool_pos,
      (
        COALESCE(1.0 / (60 + sc.server_pos), 0) +
        1.35 * COALESCE(1.0 / (60 + tc.tool_pos), 0)
      ) AS rrf_score,
      rel.invoke_count AS relay_invoke_count,
      boost.intent_invoke_count,
      boost.intent_success_rate,
      boost.intent_avg_latency_ms
    FROM combined_names cn
    JOIN public.servers s ON s.name = cn.server_name
    LEFT JOIN server_candidates sc ON sc.name = s.name
    LEFT JOIN tool_candidates tc ON tc.server_name = s.name
    LEFT JOIN LATERAL (
      SELECT COALESCE(SUM(ism.invoke_count), 0)::BIGINT AS invoke_count
      FROM public.intent_server_mappings ism
      WHERE ism.server_name = s.name
    ) rel ON TRUE
    LEFT JOIN LATERAL (
      SELECT
        SUM(ism.invoke_count)::BIGINT AS intent_invoke_count,
        CASE
          WHEN SUM(ism.invoke_count) > 0
          THEN SUM(ism.success_count)::FLOAT8 / SUM(ism.invoke_count)::FLOAT8
          ELSE NULL
        END AS intent_success_rate,
        AVG(ism.avg_latency_ms) AS intent_avg_latency_ms
      FROM public.intent_server_mappings ism
      WHERE ism.server_name = s.name
        AND p_intent_hash != ''
        AND ism.intent_hash = p_intent_hash
    ) boost ON TRUE
  ),
  category_counts AS (
    SELECT tags[1] AS primary_tag, COUNT(*) AS result_count
    FROM base
    GROUP BY tags[1]
  ),
  result_median AS (
    SELECT PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY trust_score) AS median_score
    FROM base
  ),
  ranked AS (
    SELECT
      b.*,
      (
        b.rrf_score * b.ranking_boost
        + LEAST(COALESCE(b.trust_score, 50), 100) / 10000.0
        + CASE WHEN b.is_canonical THEN 0.003 ELSE 0 END
        + CASE
            WHEN COALESCE(b.intent_invoke_count, 0) > 0
            THEN LEAST(COALESCE(b.intent_success_rate, 0), 1) * LN(COALESCE(b.intent_invoke_count, 0) + 1) / 100.0
            ELSE 0
          END
        + GREATEST(b.name_sim, b.tool_sim) / 100.0
      ) AS final_rank
    FROM base b
  )
  SELECT
    r.id, r.name, r.display_name, r.description, r.endpoint, r.version,
    r.github_url, r.icon_url, r.tags, r.tools, r.tool_schemas,
    r.env_var_schema, r.package_info, r.tool_extraction_source,
    r.trust_score, r.verified, r.is_canonical, r.source,
    r.scan_status, r.cve_issues, r.latency_ms, r.uptime_pct, r.stars,
    r.use_count, r.relay_invoke_count AS invoke_count,
    r.calls_today, r.is_new, r.transport, r.proxy_available,
    r.auth_type, r.auth_setup_url,
    r.intent_invoke_count, r.intent_success_rate, r.intent_avg_latency_ms
  FROM ranked r
  LEFT JOIN category_counts cc ON cc.primary_tag = r.tags[1]
  CROSS JOIN result_median rm
  ORDER BY
    r.final_rank DESC,
    CASE
      WHEN cc.result_count > 2 AND r.trust_score < rm.median_score
      THEN r.trust_score * 0.92
      ELSE r.trust_score
    END DESC,
    COALESCE(r.use_count, 0) DESC,
    r.relay_invoke_count DESC
  LIMIT result_limit;
$$;

GRANT EXECUTE ON FUNCTION public.search_servers(TEXT, INTEGER, BOOLEAN, TEXT)
  TO anon, authenticated, service_role;

COMMENT ON FUNCTION public.search_servers IS
  '041: Tool-level intent search optimized to avoid broad similarity scoring over large tool documents.';

NOTIFY pgrst, 'reload schema';
