-- ─────────────────────────────────────────────────────────────────────────────
-- 047_unified_search.sql
--
-- Consolidates the multi-pass, high-overhead search queries into a single-pass
-- search over a materialized search document table 'server_search_docs'.
--
-- This eliminates the 3 unbounded CTE scans over 'server_tools' and replaces
-- them with 1 GIN-indexed scan.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── 1. Create the unified search doc table ────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.server_search_docs (
  server_id       UUID PRIMARY KEY REFERENCES public.servers(id) ON DELETE CASCADE,
  server_name     TEXT NOT NULL UNIQUE,
  -- Pre-computed search fields
  search_vector   TSVECTOR NOT NULL,         -- Combined server + ALL tool vectors
  search_text     TEXT NOT NULL DEFAULT '',  -- Compact trigram target
  tool_names      TEXT NOT NULL DEFAULT '',  -- Space-separated tool names for trigram
  tool_count      INTEGER NOT NULL DEFAULT 0,
  -- Cached ranking signals (refreshed at ingest / sync)
  trust_score     NUMERIC,
  is_canonical    BOOLEAN DEFAULT FALSE,
  has_endpoint    BOOLEAN DEFAULT FALSE,
  has_rich_schemas BOOLEAN DEFAULT FALSE,
  source          TEXT,
  transport       TEXT,
  created_at      TIMESTAMPTZ NOT NULL
);

ALTER TABLE public.server_search_docs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Public read server_search_docs" ON public.server_search_docs;
CREATE POLICY "Public read server_search_docs"
  ON public.server_search_docs FOR SELECT USING (true);

DROP POLICY IF EXISTS "Service write server_search_docs" ON public.server_search_docs;
CREATE POLICY "Service write server_search_docs"
  ON public.server_search_docs FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

-- ── 2. Create GIN Indexes for single-pass scan ──────────────────────────────

CREATE INDEX IF NOT EXISTS idx_server_search_docs_vector
  ON public.server_search_docs USING GIN(search_vector);

CREATE INDEX IF NOT EXISTS idx_server_search_docs_name_trgm
  ON public.server_search_docs USING GIN(server_name gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_server_search_docs_tool_names_trgm
  ON public.server_search_docs USING GIN(tool_names gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_server_search_docs_text_trgm
  ON public.server_search_docs USING GIN(search_text gin_trgm_ops);


-- ── 3. Create Sync function to build materialized docs ───────────────────────

CREATE OR REPLACE FUNCTION public.sync_server_search_doc(p_server_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  s public.servers%ROWTYPE;
  v_tool_names TEXT := '';
  v_all_tool_descriptions TEXT := '';
  v_schema_summaries TEXT := '';
  v_tool_count INTEGER := 0;
  v_has_rich_schemas BOOLEAN := FALSE;
  v_search_vector TSVECTOR;
  v_search_text TEXT;
  t JSONB;
  v_tool_name TEXT;
  v_tool_desc TEXT;
  v_schema_text TEXT;
  v_tool_name_arr TEXT[] := '{}'::TEXT[];
BEGIN
  -- Fetch the server
  SELECT * INTO s FROM public.servers WHERE id = p_server_id;
  IF NOT FOUND OR s.status <> 'active' THEN
    DELETE FROM public.server_search_docs WHERE server_id = p_server_id;
    RETURN;
  END IF;

  -- Gather tool names and text summaries
  IF jsonb_typeof(s.tool_schemas) = 'array' AND jsonb_array_length(s.tool_schemas) > 0 THEN
    FOR t IN SELECT value FROM jsonb_array_elements(s.tool_schemas)
    LOOP
      v_tool_name := NULLIF(trim(coalesce(t->>'name', '')), '');
      IF v_tool_name IS NULL THEN CONTINUE; END IF;

      v_tool_count := v_tool_count + 1;
      v_tool_name_arr := array_append(v_tool_name_arr, v_tool_name);
      
      v_tool_desc := NULLIF(trim(coalesce(t->>'description', '')), '');
      IF v_tool_desc IS NOT NULL THEN
        v_all_tool_descriptions := v_all_tool_descriptions || ' ' || v_tool_desc;
      END IF;

      v_schema_text := NULLIF(trim(coalesce((t->'inputSchema')::TEXT, '')), '');
      IF v_schema_text IS NOT NULL THEN
        v_schema_summaries := v_schema_summaries || ' ' || v_schema_text;
        v_has_rich_schemas := TRUE;
      END IF;
    END LOOP;
  ELSE
    FOREACH v_tool_name IN ARRAY coalesce(s.tools, '{}'::TEXT[])
    LOOP
      v_tool_name := NULLIF(trim(coalesce(v_tool_name, '')), '');
      IF v_tool_name IS NULL THEN CONTINUE; END IF;

      v_tool_count := v_tool_count + 1;
      v_tool_name_arr := array_append(v_tool_name_arr, v_tool_name);
    END LOOP;
  END IF;

  v_tool_names := array_to_string(v_tool_name_arr, ' ');

  -- Build the unified search vector:
  -- Weight A: server name, display_name, and tool names
  v_search_vector := setweight(to_tsvector('english', s.name || ' ' || coalesce(s.display_name, '') || ' ' || v_tool_names), 'A')
    -- Weight B: server description, tool descriptions
    || setweight(to_tsvector('english', coalesce(s.description, '') || ' ' || v_all_tool_descriptions), 'B')
    -- Weight C: tags, schema summaries
    || setweight(to_tsvector('english', array_to_string(s.tags, ' ') || ' ' || v_schema_summaries), 'C')
    -- Weight D: github_url, transport
    || setweight(to_tsvector('english', coalesce(s.github_url, '') || ' ' || coalesce(s.transport, '')), 'D');

  -- Build compact search_text for trigram fuzzy matching
  v_search_text := concat_ws(
    ' ',
    s.name,
    coalesce(s.display_name, ''),
    array_to_string(s.tags, ' '),
    v_tool_names,
    v_all_tool_descriptions
  );

  -- UPSERT into server_search_docs
  INSERT INTO public.server_search_docs (
    server_id, server_name, search_vector, search_text, tool_names, tool_count,
    trust_score, is_canonical, has_endpoint, has_rich_schemas, source, transport, created_at
  )
  VALUES (
    s.id,
    s.name,
    v_search_vector,
    v_search_text,
    v_tool_names,
    v_tool_count,
    s.trust_score,
    coalesce(s.is_canonical, FALSE),
    (s.endpoint IS NOT NULL AND s.endpoint <> ''),
    v_has_rich_schemas,
    s.source,
    s.transport,
    coalesce(s.created_at, NOW())
  )
  ON CONFLICT (server_id) DO UPDATE SET
    server_name = EXCLUDED.server_name,
    search_vector = EXCLUDED.search_vector,
    search_text = EXCLUDED.search_text,
    tool_names = EXCLUDED.tool_names,
    tool_count = EXCLUDED.tool_count,
    trust_score = EXCLUDED.trust_score,
    is_canonical = EXCLUDED.is_canonical,
    has_endpoint = EXCLUDED.has_endpoint,
    has_rich_schemas = EXCLUDED.has_rich_schemas,
    source = EXCLUDED.source,
    transport = EXCLUDED.transport,
    created_at = EXCLUDED.created_at;
END;
$$;


-- ── 4. Update the Trigger Function to maintain server_search_docs ───────────

CREATE OR REPLACE FUNCTION public.sync_server_tools_trigger()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    DELETE FROM public.server_tools WHERE server_id = OLD.id;
    DELETE FROM public.server_search_docs WHERE server_id = OLD.id;
    RETURN OLD;
  END IF;

  PERFORM public.sync_server_tools_for_server(NEW.id);
  PERFORM public.sync_server_search_doc(NEW.id);
  RETURN NEW;
END;
$$;


-- ── 5. Re-implement search_servers with single-pass search ──────────────────
-- FIX v4: Four critical ranking improvements:
--   1. True multi-signal RRF (separate fts_pos, name_pos, tool_pos rank lists)
--   2. RRF only awards lane credit when that lane actually matched
--   3. Strict AND matching preferred over loose OR with 1.5x boost
--   4. Trust/canonical/behavior boosts are capped so relevance remains dominant

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
      END AS loose_tsq,
      GREATEST(result_limit, 1) AS lim
  ),
  matches AS (
    -- Single-pass match: strict AND for WHERE + loose OR for recall
    SELECT
      d.server_id,
      d.server_name,
      -- FTS rank: flag 33 = 32 (scale to 0-1) | 1 (divide by 1+log(doc_length))
      -- Boost strict AND matches 1.5x over loose OR matches
      CASE
        WHEN q.strict_tsq IS NOT NULL AND d.search_vector @@ q.strict_tsq
          THEN ts_rank_cd(d.search_vector, q.strict_tsq, 33) * 1.5
        WHEN q.loose_tsq IS NOT NULL
          THEN ts_rank_cd(d.search_vector, q.loose_tsq, 33)
        ELSE 0.0::FLOAT8
      END AS fts_rank,
      -- FIX: Token-level name matching — compare each query word against server_name
      -- "query a postgres database" → MAX(ws('query',name), ws('postgres',name), ws('database',name))
      -- This gives 0.8+ when "postgres" appears in the server name, instead of 0.05
      CASE
        WHEN q.raw = '' THEN 0.0::FLOAT8
        ELSE COALESCE((
          SELECT MAX(word_similarity(w, d.server_name))
          FROM unnest(string_to_array(q.raw, ' ')) AS w
          WHERE length(w) > 2
        ), 0.0)
      END AS name_sim,
      -- FIX: Token-level tool matching — same approach for tool names
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
    -- Fetch details only on the small match set
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
      -- RRF lane positions are nullable. A candidate can enter through any
      -- recall lane, but it only receives RRF credit for lanes with real signal.
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
      -- Single lateral scan for invoke_count on match subset
      SELECT COALESCE(SUM(ism.invoke_count), 0)::BIGINT AS invoke_count
      FROM public.intent_server_mappings ism
      WHERE ism.server_name = s.name
    ) rel ON TRUE
    LEFT JOIN LATERAL (
      -- Single lateral scan for intent-specific boost on match subset
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
        -- Weighted RRF across independent rank lists. COALESCE is intentional:
        -- if the lane did not match, the candidate gets zero credit for it.
        (COALESCE(0.45 / (60 + b.fts_pos), 0)
         + COALESCE(0.30 / (60 + b.name_pos), 0)
         + COALESCE(0.20 / (60 + b.tool_pos), 0)
         + COALESCE(0.05 / (60 + b.text_pos), 0)
        ) * b.ranking_boost
        -- Trust/canonical/behavior are tie-breakers, not relevance substitutes.
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


-- ── 6. Create tracking table + backfill function for unified search ────────

CREATE TABLE IF NOT EXISTS public._047_backfill_done (
  server_id UUID PRIMARY KEY
);

ALTER TABLE public._047_backfill_done ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Service only _047_backfill_done" ON public._047_backfill_done;
CREATE POLICY "Service only _047_backfill_done"
  ON public._047_backfill_done FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

CREATE OR REPLACE FUNCTION public.backfill_unified_search(
  p_batch_size INTEGER DEFAULT 50
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_server_id UUID;
  v_processed INTEGER := 0;
  v_remaining INTEGER;
BEGIN
  FOR v_server_id IN
    SELECT s.id
    FROM public.servers s
    WHERE s.status = 'active'
      AND NOT EXISTS (
        SELECT 1 FROM public._047_backfill_done d WHERE d.server_id = s.id
      )
    ORDER BY s.id
    LIMIT p_batch_size
  -- Loop
  LOOP
    PERFORM public.sync_server_search_doc(v_server_id);
    INSERT INTO public._047_backfill_done (server_id) VALUES (v_server_id)
      ON CONFLICT DO NOTHING;
    v_processed := v_processed + 1;
  END LOOP;

  SELECT COUNT(*) INTO v_remaining
  FROM public.servers s
  WHERE s.status = 'active'
    AND NOT EXISTS (
      SELECT 1 FROM public._047_backfill_done d WHERE d.server_id = s.id
    );

  RAISE NOTICE '047 backfill: processed % servers, % remaining', v_processed, v_remaining;
  RETURN v_remaining;
END;
$$;

GRANT EXECUTE ON FUNCTION public.backfill_unified_search(INTEGER)
  TO service_role;

ANALYZE public.server_search_docs;

NOTIFY pgrst, 'reload schema';
