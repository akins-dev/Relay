-- ─────────────────────────────────────────────────────────────────────────────
-- 046_compact_search_text.sql
--
-- Root cause: search_text contains the entire server description, long
-- description, inputSchema JSON, env_var_schema JSON, and package_info JSON.
-- The trigram operator (st.search_text % q.raw) in tool_text_rows must
-- compute similarity against these multi-KB blobs for every GIN candidate,
-- which exceeds Supabase Free statement timeout on broad intents like
-- "send a transactional email with html body".
--
-- Fix: shrink search_text to a compact signal string:
--   server name + display_name + tags + tool_name + tool_description
--
-- Everything removed from search_text is ALREADY covered by search_vector
-- (weighted tsvector with A/B/C/D priorities) through the FTS lane. The
-- trigram lane's job is fuzzy matching on short, high-signal text — not
-- re-scanning the full document.
--
-- The search_vector column, the search_servers() RPC, and all indexes are
-- unchanged. Only the content of search_text shrinks.
--
-- Backfill strategy: a temporary batch function re-syncs servers in small
-- batches by tracking which servers have been processed via a temporary
-- marker. Call it repeatedly until it returns 0, then drop it.
-- ─────────────────────────────────────────────────────────────────────────────


-- ── 1. Update the sync function (permanent) ─────────────────────────────────
-- All future ingests will immediately produce compact search_text.

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

  IF s.status <> 'active' THEN
    RETURN;
  END IF;

  IF jsonb_typeof(s.tool_schemas) = 'array' AND jsonb_array_length(s.tool_schemas) > 0 THEN
    FOR t IN SELECT value FROM jsonb_array_elements(s.tool_schemas)
    LOOP
      v_tool_name := NULLIF(trim(coalesce(t->>'name', '')), '');
      IF v_tool_name IS NULL THEN CONTINUE; END IF;

      v_tool_desc := NULLIF(trim(coalesce(t->>'description', '')), '');
      v_schema_text := NULLIF(trim(coalesce((t->'inputSchema')::TEXT, '')), '');

      -- 046: Compact search_text — only high-signal short fields for trigram.
      -- Full content (descriptions, schemas, package_info) stays in search_vector.
      v_doc := concat_ws(
        ' ',
        s.name, coalesce(s.display_name, ''),
        array_to_string(s.tags, ' '),
        v_tool_name, coalesce(v_tool_desc, '')
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

      -- 046: Compact search_text for plain-name tools too.
      v_doc := concat_ws(
        ' ',
        s.name, coalesce(s.display_name, ''),
        array_to_string(s.tags, ' '),
        v_tool_name
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


-- ── 2. Tracking table + batch backfill function ─────────────────────────────
-- Previous attempts to detect "old" rows by content (length > 400, LIKE '%{%')
-- both failed — compact text can be long, and tool descriptions can contain '{'.
--
-- This version just processes ALL active servers, tracks what's done, and stops.
--
-- Usage:
--   Step 1: Run this full migration SQL in Supabase SQL Editor.
--   Step 2: Run repeatedly until it returns 0:
--           SELECT public.backfill_compact_search_text(50);
--   Step 3: Clean up:
--           ANALYZE public.server_tools;
--           DROP FUNCTION public.backfill_compact_search_text(INTEGER);
--           DROP TABLE public._046_backfill_done;

CREATE TABLE IF NOT EXISTS public._046_backfill_done (
  server_id UUID PRIMARY KEY
);

CREATE OR REPLACE FUNCTION public.backfill_compact_search_text(
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
        SELECT 1 FROM public._046_backfill_done d WHERE d.server_id = s.id
      )
    ORDER BY s.id
    LIMIT p_batch_size
  LOOP
    PERFORM public.sync_server_tools_for_server(v_server_id);
    INSERT INTO public._046_backfill_done (server_id) VALUES (v_server_id)
      ON CONFLICT DO NOTHING;
    v_processed := v_processed + 1;
  END LOOP;

  SELECT COUNT(*) INTO v_remaining
  FROM public.servers s
  WHERE s.status = 'active'
    AND NOT EXISTS (
      SELECT 1 FROM public._046_backfill_done d WHERE d.server_id = s.id
    );

  RAISE NOTICE '046 backfill: processed % servers, % remaining', v_processed, v_remaining;
  RETURN v_remaining;
END;
$$;

GRANT EXECUTE ON FUNCTION public.backfill_compact_search_text(INTEGER)
  TO service_role;


-- ── 3. Metadata ─────────────────────────────────────────────────────────────

COMMENT ON FUNCTION public.sync_server_tools_for_server IS
  '046: Compact search_text to high-signal fields only (name, display_name, tags, tool_name, tool_desc). Full content stays in search_vector for FTS.';

NOTIFY pgrst, 'reload schema';

