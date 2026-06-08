-- ─────────────────────────────────────────────────────────────────────────────
-- 048_search_rrf_lane_gating.sql
--
-- Forward patch for databases where 047_unified_search.sql was already applied.
-- Fresh databases get the same logic from the fixed 047 migration.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE IF EXISTS public.server_search_docs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Public read server_search_docs" ON public.server_search_docs;
CREATE POLICY "Public read server_search_docs"
  ON public.server_search_docs FOR SELECT USING (true);

DROP POLICY IF EXISTS "Service write server_search_docs" ON public.server_search_docs;
CREATE POLICY "Service write server_search_docs"
  ON public.server_search_docs FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

DO $$
BEGIN
  IF to_regclass('public._047_backfill_done') IS NOT NULL THEN
    ALTER TABLE public._047_backfill_done ENABLE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS "Service only _047_backfill_done" ON public._047_backfill_done;
    CREATE POLICY "Service only _047_backfill_done"
      ON public._047_backfill_done FOR ALL
      USING (auth.role() = 'service_role')
      WITH CHECK (auth.role() = 'service_role');
  END IF;
END;
$$;

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
      END AS strict_tsq,
      CASE
        WHEN trim(coalesce(query_text, '')) = '' THEN NULL
        ELSE to_tsquery('english', regexp_replace(websearch_to_tsquery('english', trim(query_text))::text, ' & ', ' | ', 'g'))
      END AS loose_tsq
  ),
  matches AS (
    SELECT
      d.server_id,
      d.server_name,
      CASE
        WHEN q.strict_tsq IS NOT NULL AND d.search_vector @@ q.strict_tsq
          THEN ts_rank_cd(d.search_vector, q.strict_tsq, 33) * 1.5
        WHEN q.loose_tsq IS NOT NULL
          THEN ts_rank_cd(d.search_vector, q.loose_tsq, 33)
        ELSE 0.0::FLOAT8
      END AS fts_rank,
      CASE
        WHEN q.raw = '' THEN 0.0::FLOAT8
        ELSE COALESCE((
          SELECT MAX(word_similarity(w, d.server_name))
          FROM unnest(string_to_array(q.raw, ' ')) AS w
          WHERE length(w) > 2
        ), 0.0)
      END AS name_sim,
      CASE
        WHEN q.raw = '' THEN 0.0::FLOAT8
        ELSE COALESCE((
          SELECT MAX(word_similarity(w, d.tool_names))
          FROM unnest(string_to_array(q.raw, ' ')) AS w
          WHERE length(w) > 2
        ), 0.0)
      END AS tool_sim,
      CASE
        WHEN q.raw = '' THEN 0.0::FLOAT8
        ELSE similarity(d.search_text, q.raw)
      END AS text_sim
    FROM public.server_search_docs d
    CROSS JOIN q
    WHERE (include_stdio OR COALESCE(d.transport, 'unknown') != 'stdio')
      AND (
        q.raw = ''
        OR d.search_vector @@ q.strict_tsq
        OR d.search_vector @@ q.loose_tsq
        OR d.server_name % q.raw
        OR d.tool_names % q.raw
        OR d.search_text % q.raw
      )
    ORDER BY
      CASE WHEN q.strict_tsq IS NOT NULL AND d.search_vector @@ q.strict_tsq THEN 1 ELSE 0 END DESC,
      CASE WHEN q.loose_tsq IS NULL THEN 0.0::FLOAT8 ELSE ts_rank_cd(d.search_vector, q.loose_tsq, 33) END DESC,
      CASE WHEN q.raw = '' THEN 0.0::FLOAT8 ELSE similarity(d.server_name, q.raw) END DESC
    LIMIT GREATEST(result_limit * 3, 100)
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
      m.fts_rank,
      m.name_sim,
      m.tool_sim,
      m.text_sim,
      CASE WHEN m.fts_rank > 0 THEN
        row_number() OVER (
          ORDER BY CASE WHEN m.fts_rank > 0 THEN m.fts_rank END DESC NULLS LAST,
                   s.trust_score DESC
        )
      END AS fts_pos,
      CASE WHEN m.name_sim >= 0.55 THEN
        row_number() OVER (
          ORDER BY CASE WHEN m.name_sim >= 0.55 THEN m.name_sim END DESC NULLS LAST,
                   s.trust_score DESC
        )
      END AS name_pos,
      CASE WHEN m.tool_sim >= 0.55 THEN
        row_number() OVER (
          ORDER BY CASE WHEN m.tool_sim >= 0.55 THEN m.tool_sim END DESC NULLS LAST,
                   s.trust_score DESC
        )
      END AS tool_pos,
      CASE WHEN m.text_sim >= 0.12 THEN
        row_number() OVER (
          ORDER BY CASE WHEN m.text_sim >= 0.12 THEN m.text_sim END DESC NULLS LAST,
                   s.trust_score DESC
        )
      END AS text_pos,
      rel.invoke_count AS relay_invoke_count,
      boost.intent_invoke_count,
      boost.intent_success_rate,
      boost.intent_avg_latency_ms
    FROM matches m
    JOIN public.servers s ON s.id = m.server_id
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
  ranked AS (
    SELECT
      b.*,
      (
        (COALESCE(0.45 / (60 + b.fts_pos), 0)
         + COALESCE(0.30 / (60 + b.name_pos), 0)
         + COALESCE(0.20 / (60 + b.tool_pos), 0)
         + COALESCE(0.05 / (60 + b.text_pos), 0)
        ) * b.ranking_boost
        + LEAST(COALESCE(b.trust_score, 50), 100) / 50000.0
        + CASE WHEN b.is_canonical THEN 0.0015 ELSE 0 END
        + CASE
            WHEN COALESCE(b.intent_invoke_count, 0) > 0
            THEN LEAST(
              0.003,
              LEAST(COALESCE(b.intent_success_rate, 0), 1)
                * LN(COALESCE(b.intent_invoke_count, 0) + 1) / 250.0
            )
            ELSE 0
          END
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
  ORDER BY
    r.final_rank DESC,
    COALESCE(r.trust_score, 0) DESC,
    COALESCE(r.use_count, 0) DESC,
    r.relay_invoke_count DESC
  LIMIT result_limit;
$$;

GRANT EXECUTE ON FUNCTION public.search_servers(TEXT, INTEGER, BOOLEAN, TEXT)
  TO anon, authenticated, service_role;

COMMENT ON FUNCTION public.search_servers IS
  '048: Unified server_search_docs search with relevance-gated RRF lanes and capped metadata boosts.';

NOTIFY pgrst, 'reload schema';
