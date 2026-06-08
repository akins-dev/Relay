-- ─────────────────────────────────────────────────────────────────────────────
-- 050_short_generic_search_timeout_guard.sql
--
-- Tightens the bounded search RPC for very short generic intents such as
-- "send email". Migration 049 bounded the candidate lanes, but short loose
-- OR tsqueries like "send | email" can still be too broad on a live catalog.
--
-- This keeps the same search document table and indexes. No new DB bloat.
-- Changes:
--   1. Disable loose OR FTS for one/two-token queries.
--   2. Use only significant noun/provider tokens for trigram name/tool lanes.
--   3. Keep all tokens available for exact provider matching.
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
  WITH raw_words AS (
    SELECT DISTINCT lower(regexp_replace(w, '[^a-zA-Z0-9]+', '', 'g')) AS word
    FROM unnest(string_to_array(trim(coalesce(query_text, '')), ' ')) AS w
    WHERE length(regexp_replace(w, '[^a-zA-Z0-9]+', '', 'g')) > 2
  ),
  q AS (
    SELECT
      trim(coalesce(query_text, '')) AS raw,
      (SELECT count(*) FROM raw_words) AS word_count,
      CASE
        WHEN trim(coalesce(query_text, '')) = '' THEN NULL
        ELSE websearch_to_tsquery('english', trim(query_text))
      END AS strict_tsq,
      CASE
        WHEN trim(coalesce(query_text, '')) = '' THEN NULL
        WHEN (SELECT count(*) FROM raw_words) <= 2 THEN NULL
        ELSE to_tsquery('english', regexp_replace(websearch_to_tsquery('english', trim(query_text))::text, ' & ', ' | ', 'g'))
      END AS loose_tsq,
      GREATEST(result_limit, 1) AS lim
  ),
  words AS (
    SELECT word FROM raw_words
  ),
  significant_words AS (
    SELECT word
    FROM raw_words
    WHERE word NOT IN (
      'add', 'append', 'call', 'check', 'create', 'delete', 'fetch', 'find',
      'get', 'list', 'make', 'manage', 'post', 'query', 'read', 'run',
      'search', 'send', 'set', 'sync', 'update', 'use', 'write'
    )
  ),
  strict_fts AS (
    SELECT
      d.server_id,
      ts_rank_cd(d.search_vector, q.strict_tsq, 33) * 1.5 AS fts_rank,
      0.0::FLOAT8 AS name_sim,
      0.0::FLOAT8 AS tool_sim,
      0.0::FLOAT8 AS text_sim,
      row_number() OVER (ORDER BY ts_rank_cd(d.search_vector, q.strict_tsq, 33) DESC) AS lane_pos
    FROM public.server_search_docs d
    CROSS JOIN q
    WHERE q.strict_tsq IS NOT NULL
      AND (include_stdio OR COALESCE(d.transport, 'unknown') != 'stdio')
      AND d.search_vector @@ q.strict_tsq
    ORDER BY ts_rank_cd(d.search_vector, q.strict_tsq, 33) DESC
    LIMIT GREATEST(result_limit * 30, 120)
  ),
  loose_fts AS (
    SELECT
      d.server_id,
      ts_rank_cd(d.search_vector, q.loose_tsq, 33) AS fts_rank,
      0.0::FLOAT8 AS name_sim,
      0.0::FLOAT8 AS tool_sim,
      0.0::FLOAT8 AS text_sim,
      row_number() OVER (ORDER BY ts_rank_cd(d.search_vector, q.loose_tsq, 33) DESC) AS lane_pos
    FROM public.server_search_docs d
    CROSS JOIN q
    WHERE q.loose_tsq IS NOT NULL
      AND (include_stdio OR COALESCE(d.transport, 'unknown') != 'stdio')
      AND d.search_vector @@ q.loose_tsq
    ORDER BY ts_rank_cd(d.search_vector, q.loose_tsq, 33) DESC
    LIMIT GREATEST(result_limit * 20, 80)
  ),
  name_rows AS (
    SELECT
      d.server_id,
      0.0::FLOAT8 AS fts_rank,
      max(GREATEST(word_similarity(w.word, d.server_name), similarity(d.server_name, q.raw))) AS name_sim,
      0.0::FLOAT8 AS tool_sim,
      0.0::FLOAT8 AS text_sim,
      row_number() OVER (
        ORDER BY max(GREATEST(word_similarity(w.word, d.server_name), similarity(d.server_name, q.raw))) DESC
      ) AS lane_pos
    FROM public.server_search_docs d
    CROSS JOIN q
    JOIN significant_words w ON d.server_name % w.word OR d.server_name % q.raw
    WHERE (include_stdio OR COALESCE(d.transport, 'unknown') != 'stdio')
    GROUP BY d.server_id
    ORDER BY max(GREATEST(word_similarity(w.word, d.server_name), similarity(d.server_name, q.raw))) DESC
    LIMIT GREATEST(result_limit * 20, 80)
  ),
  tool_rows AS (
    SELECT
      d.server_id,
      0.0::FLOAT8 AS fts_rank,
      0.0::FLOAT8 AS name_sim,
      max(word_similarity(w.word, d.tool_names)) AS tool_sim,
      0.0::FLOAT8 AS text_sim,
      row_number() OVER (ORDER BY max(word_similarity(w.word, d.tool_names)) DESC) AS lane_pos
    FROM public.server_search_docs d
    JOIN significant_words w ON d.tool_names % w.word
    WHERE (include_stdio OR COALESCE(d.transport, 'unknown') != 'stdio')
    GROUP BY d.server_id
    ORDER BY max(word_similarity(w.word, d.tool_names)) DESC
    LIMIT GREATEST(result_limit * 20, 80)
  ),
  lane_rows AS (
    SELECT 'fts'::TEXT AS lane, * FROM strict_fts
    UNION ALL SELECT 'fts'::TEXT AS lane, * FROM loose_fts
    UNION ALL SELECT 'name'::TEXT AS lane, * FROM name_rows
    UNION ALL SELECT 'tool'::TEXT AS lane, * FROM tool_rows
  ),
  matches AS (
    SELECT
      d.server_id,
      d.server_name,
      max(l.fts_rank) AS fts_rank,
      max(l.name_sim) AS name_sim,
      max(l.tool_sim) AS tool_sim,
      max(l.text_sim) AS text_sim,
      min(l.lane_pos) FILTER (WHERE l.lane = 'fts' AND l.fts_rank > 0) AS fts_pos,
      min(l.lane_pos) FILTER (WHERE l.lane = 'name' AND l.name_sim >= 0.55) AS name_pos,
      min(l.lane_pos) FILTER (WHERE l.lane = 'tool' AND l.tool_sim >= 0.55) AS tool_pos,
      NULL::BIGINT AS text_pos,
      EXISTS (
        SELECT 1
        FROM words w
        WHERE lower(regexp_replace(d.server_name, '[^a-zA-Z0-9]+', '', 'g')) = w.word
      ) AS exact_provider_match
    FROM lane_rows l
    JOIN public.server_search_docs d ON d.server_id = l.server_id
    GROUP BY d.server_id, d.server_name
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
      m.fts_pos,
      m.name_pos,
      m.tool_pos,
      m.text_pos,
      m.exact_provider_match,
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
        + CASE WHEN b.exact_provider_match THEN 0.012 ELSE 0 END
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
  '050: Bounded unified search with short generic query timeout guard.';
