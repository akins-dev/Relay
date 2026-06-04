-- ─────────────────────────────────────────────────────────────────────────────
-- 044_prune_inactive_server_tools.sql
--
-- Goal: reduce catalog storage without dropping indexes or weakening active
-- search behavior.
--
-- search_servers() only searches active servers:
--   JOIN public.servers s ... WHERE s.status = 'active'
--
-- Therefore server_tools rows for suspended/rejected/pending servers consume
-- table and index space but do not contribute to search results. This migration:
--   1. Deletes existing server_tools rows for non-active servers.
--   2. Updates the sync function so non-active servers do not repopulate
--      server_tools until they become active again.
-- ─────────────────────────────────────────────────────────────────────────────

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

DELETE FROM public.server_tools st
USING public.servers s
WHERE st.server_id = s.id
  AND s.status <> 'active';

ANALYZE public.server_tools;
ANALYZE public.servers;

COMMENT ON FUNCTION public.sync_server_tools_for_server IS
  '044: Keeps server_tools populated only for active servers; non-active rows are pruned to reduce storage.';
