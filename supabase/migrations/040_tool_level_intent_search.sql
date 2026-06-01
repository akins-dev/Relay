-- ─────────────────────────────────────────────────────────────────────────────
-- 040_tool_level_intent_search.sql
--
-- Goal: make search optimize for intent -> tool discovery, not just
-- intent -> server discovery.
--
-- Current infra only: Postgres FTS + pg_trgm + intent feedback. No paid LLM
-- calls, no external vector service, no new runtime dependency.
--
-- Ranking approach:
--   1. Maintain a server_tools side table from servers.tools/tool_schemas.
--   2. Search server documents and tool documents independently.
--   3. Fuse ranks with Reciprocal Rank Fusion (RRF).
--   4. Apply trust, canonical, new-server, and behavior signals as boosts.
--
-- RRF is intentionally used because it is simple, unsupervised, robust across
-- heterogeneous rankers, and does not require calibrated score scales.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pg_trgm";

-- Prerequisite columns (safe if already applied from earlier migrations)
ALTER TABLE public.servers ADD COLUMN IF NOT EXISTS title TEXT;
ALTER TABLE public.servers ADD COLUMN IF NOT EXISTS is_canonical BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE public.servers ADD COLUMN IF NOT EXISTS tool_schemas JSONB;
ALTER TABLE public.servers ADD COLUMN IF NOT EXISTS env_var_schema JSONB;
ALTER TABLE public.servers ADD COLUMN IF NOT EXISTS package_info JSONB;

-- ── 1. Tool-level search table ────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.server_tools (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  server_id         UUID NOT NULL REFERENCES public.servers(id) ON DELETE CASCADE,
  server_name       TEXT NOT NULL,
  tool_name         TEXT NOT NULL,
  description       TEXT,
  input_schema_text TEXT,
  search_text       TEXT NOT NULL DEFAULT '',
  search_vector     TSVECTOR NOT NULL DEFAULT ''::tsvector,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (server_name, tool_name)
);

CREATE INDEX IF NOT EXISTS idx_server_tools_server_name
  ON public.server_tools(server_name);

CREATE INDEX IF NOT EXISTS idx_server_tools_fts
  ON public.server_tools USING GIN(search_vector);

CREATE INDEX IF NOT EXISTS idx_server_tools_name_trgm
  ON public.server_tools USING GIN(tool_name gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_server_tools_text_trgm
  ON public.server_tools USING GIN(search_text gin_trgm_ops);

ALTER TABLE public.server_tools ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Public read server_tools" ON public.server_tools;
CREATE POLICY "Public read server_tools"
  ON public.server_tools FOR SELECT USING (true);

DROP POLICY IF EXISTS "Service write server_tools" ON public.server_tools;
CREATE POLICY "Service write server_tools"
  ON public.server_tools FOR ALL USING (auth.role() = 'service_role');

-- ── 2. Rich server search vector ──────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.set_server_derived_fields()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.name_normalized := regexp_replace(lower(coalesce(NEW.name, '')), '[^a-z0-9]', '', 'g');
  NEW.search_vector :=
    setweight(to_tsvector('english', coalesce(NEW.name, '')), 'A') ||
    setweight(to_tsvector('english', coalesce(NEW.display_name, '')), 'A') ||
    setweight(to_tsvector('english', coalesce(NEW.title, '')), 'A') ||
    setweight(to_tsvector('english', coalesce(NEW.description, '')), 'B') ||
    setweight(to_tsvector('english', coalesce(NEW.long_description, '')), 'B') ||
    setweight(to_tsvector('english', coalesce(array_to_string(NEW.tools, ' '), '')), 'A') ||
    setweight(to_tsvector('english', coalesce(NEW.tool_schemas::TEXT, '')), 'B') ||
    setweight(to_tsvector('english', coalesce(array_to_string(NEW.tags, ' '), '')), 'C') ||
    setweight(to_tsvector('english', coalesce(NEW.env_var_schema::TEXT, '')), 'C') ||
    setweight(to_tsvector('english', coalesce(NEW.package_info::TEXT, '')), 'C') ||
    setweight(to_tsvector('english', coalesce(NEW.homepage_url, '')), 'D') ||
    setweight(to_tsvector('english', coalesce(NEW.github_url, '')), 'D') ||
    setweight(to_tsvector('english', coalesce(NEW.transport, '')), 'D');
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS servers_set_derived_fields ON public.servers;
CREATE TRIGGER servers_set_derived_fields
  BEFORE INSERT OR UPDATE OF
    name, display_name, title, description, long_description, tags, tools,
    tool_schemas, env_var_schema, package_info, homepage_url, github_url,
    transport
  ON public.servers
  FOR EACH ROW EXECUTE FUNCTION public.set_server_derived_fields();

-- Backfill richer vectors for existing rows.
UPDATE public.servers
SET search_vector =
    setweight(to_tsvector('english', coalesce(name, '')), 'A') ||
    setweight(to_tsvector('english', coalesce(display_name, '')), 'A') ||
    setweight(to_tsvector('english', coalesce(title, '')), 'A') ||
    setweight(to_tsvector('english', coalesce(description, '')), 'B') ||
    setweight(to_tsvector('english', coalesce(long_description, '')), 'B') ||
    setweight(to_tsvector('english', coalesce(array_to_string(tools, ' '), '')), 'A') ||
    setweight(to_tsvector('english', coalesce(tool_schemas::TEXT, '')), 'B') ||
    setweight(to_tsvector('english', coalesce(array_to_string(tags, ' '), '')), 'C') ||
    setweight(to_tsvector('english', coalesce(env_var_schema::TEXT, '')), 'C') ||
    setweight(to_tsvector('english', coalesce(package_info::TEXT, '')), 'C') ||
    setweight(to_tsvector('english', coalesce(homepage_url, '')), 'D') ||
    setweight(to_tsvector('english', coalesce(github_url, '')), 'D') ||
    setweight(to_tsvector('english', coalesce(transport, '')), 'D');

-- ── 3. Server -> server_tools sync ────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.sync_server_tools_for_server(p_server_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  s public.servers%ROWTYPE;
  t JSONB;
  v_tool_name TEXT;
  v_tool_desc TEXT;
  v_schema_text TEXT;
  v_doc TEXT;
BEGIN
  SELECT * INTO s FROM public.servers WHERE id = p_server_id;
  IF NOT FOUND THEN
    DELETE FROM public.server_tools WHERE server_id = p_server_id;
    RETURN;
  END IF;

  DELETE FROM public.server_tools WHERE server_id = p_server_id;

  IF jsonb_typeof(s.tool_schemas) = 'array' AND jsonb_array_length(s.tool_schemas) > 0 THEN
    FOR t IN SELECT value FROM jsonb_array_elements(s.tool_schemas)
    LOOP
      v_tool_name := NULLIF(trim(coalesce(t->>'name', '')), '');
      IF v_tool_name IS NULL THEN CONTINUE; END IF;

      v_tool_desc := NULLIF(trim(coalesce(t->>'description', '')), '');
      v_schema_text := NULLIF(trim(coalesce((t->'inputSchema')::TEXT, '')), '');
      v_doc := concat_ws(
        ' ',
        s.name, s.display_name, s.title, s.description, s.long_description,
        array_to_string(s.tags, ' '), s.transport, s.source,
        v_tool_name, v_tool_desc, v_schema_text,
        s.env_var_schema::TEXT, s.package_info::TEXT
      );

      INSERT INTO public.server_tools (
        server_id, server_name, tool_name, description, input_schema_text,
        search_text, search_vector
      )
      VALUES (
        s.id, s.name, v_tool_name, v_tool_desc, v_schema_text, v_doc,
        setweight(to_tsvector('english', v_tool_name), 'A') ||
        setweight(to_tsvector('english', coalesce(v_tool_desc, '')), 'B') ||
        setweight(to_tsvector('english', coalesce(v_schema_text, '')), 'C') ||
        setweight(to_tsvector('english', concat_ws(' ', s.name, s.display_name, s.description, array_to_string(s.tags, ' '))), 'D')
      )
      ON CONFLICT (server_name, tool_name) DO UPDATE SET
        server_id = EXCLUDED.server_id,
        description = EXCLUDED.description,
        input_schema_text = EXCLUDED.input_schema_text,
        search_text = EXCLUDED.search_text,
        search_vector = EXCLUDED.search_vector,
        updated_at = NOW();
    END LOOP;
  ELSE
    FOREACH v_tool_name IN ARRAY coalesce(s.tools, '{}'::TEXT[])
    LOOP
      v_tool_name := NULLIF(trim(coalesce(v_tool_name, '')), '');
      IF v_tool_name IS NULL THEN CONTINUE; END IF;

      v_doc := concat_ws(
        ' ',
        s.name, s.display_name, s.title, s.description, s.long_description,
        array_to_string(s.tags, ' '), s.transport, s.source,
        v_tool_name, s.env_var_schema::TEXT, s.package_info::TEXT
      );

      INSERT INTO public.server_tools (
        server_id, server_name, tool_name, description, input_schema_text,
        search_text, search_vector
      )
      VALUES (
        s.id, s.name, v_tool_name, NULL, NULL, v_doc,
        setweight(to_tsvector('english', v_tool_name), 'A') ||
        setweight(to_tsvector('english', concat_ws(' ', s.name, s.display_name, s.description, array_to_string(s.tags, ' '))), 'D')
      )
      ON CONFLICT (server_name, tool_name) DO UPDATE SET
        server_id = EXCLUDED.server_id,
        description = EXCLUDED.description,
        input_schema_text = EXCLUDED.input_schema_text,
        search_text = EXCLUDED.search_text,
        search_vector = EXCLUDED.search_vector,
        updated_at = NOW();
    END LOOP;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.sync_server_tools_trigger()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    DELETE FROM public.server_tools WHERE server_id = OLD.id;
    RETURN OLD;
  END IF;

  PERFORM public.sync_server_tools_for_server(NEW.id);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS servers_sync_tools_search ON public.servers;
CREATE TRIGGER servers_sync_tools_search
  AFTER INSERT OR UPDATE OF
    name, display_name, title, description, long_description, tags, tools,
    tool_schemas, env_var_schema, package_info, transport, source, status
  ON public.servers
  FOR EACH ROW EXECUTE FUNCTION public.sync_server_tools_trigger();

-- Backfill: run separately in 041_backfill_server_tools.sql (avoids SQL Editor timeout).

-- ── 4. Tool-level RRF search RPC ──────────────────────────────────────────────

DROP FUNCTION IF EXISTS public.search_servers(TEXT, INTEGER);
DROP FUNCTION IF EXISTS public.search_servers(TEXT, INTEGER, BOOLEAN);
DROP FUNCTION IF EXISTS public.search_servers(TEXT, INTEGER, BOOLEAN, TEXT);

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

GRANT EXECUTE ON FUNCTION public.search_servers TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.sync_server_tools_for_server TO service_role;

COMMENT ON TABLE public.server_tools IS
  'Tool-level lexical index for intent -> tool discovery. Maintained from servers.tools/tool_schemas.';

COMMENT ON FUNCTION public.search_servers IS
  '040: Tool-level intent search using server FTS, tool FTS, trigram similarity, RRF rank fusion, trust, and intent outcome boosts. include_stdio defaults to true for Relay Local.';

-- Optional: uncomment after apply if PostgREST schema cache is stale.
-- NOTIFY pgrst, 'reload schema';
