-- ─────────────────────────────────────────────────────────────────────────────
-- relay — Migration 007: Tool policies (user-controlled safety layer)
-- Lets users define which tools their agents can call, and which are blocked.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.tool_policies (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id     UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  server_name TEXT,           -- NULL = applies to ALL servers
  tool_pattern TEXT NOT NULL, -- glob-style: 'delete_*', 'drop_*', exact 'delete_repo'
  action      TEXT NOT NULL   -- 'block' | 'allow' | 'require_confirmation'
    CHECK (action IN ('block', 'allow', 'require_confirmation')),
  reason      TEXT,           -- optional user note
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Index for fast lookup on every proxy call
CREATE INDEX IF NOT EXISTS idx_tool_policies_user_server
  ON public.tool_policies(user_id, server_name);

-- RLS — users manage only their own policies
ALTER TABLE public.tool_policies ENABLE ROW LEVEL SECURITY;

CREATE POLICY "policies_own_only"
  ON public.tool_policies FOR ALL TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- Seed default safe policies for new users (run via trigger or manually)
-- These are sensible defaults — destructive patterns blocked by default
CREATE OR REPLACE FUNCTION public.create_default_policies(p_user_id UUID)
RETURNS void LANGUAGE sql SECURITY DEFINER AS $$
  INSERT INTO public.tool_policies (user_id, server_name, tool_pattern, action, reason)
  VALUES
    -- Block destructive patterns across all servers
    (p_user_id, NULL, 'delete_*',          'block', 'Destructive — blocks all delete_ tools by default'),
    (p_user_id, NULL, 'destroy_*',         'block', 'Destructive — blocks all destroy_ tools'),
    (p_user_id, NULL, 'drop_*',            'block', 'Destructive — blocks all drop_ tools (SQL drops etc.)'),
    (p_user_id, NULL, 'remove_*',          'block', 'Destructive — blocks remove_ tools'),
    (p_user_id, NULL, 'purge_*',           'block', 'Destructive — blocks purge_ tools'),
    (p_user_id, NULL, 'truncate_*',        'block', 'Destructive — blocks truncate_ tools'),
    (p_user_id, NULL, 'wipe_*',            'block', 'Destructive — blocks wipe_ tools'),
    (p_user_id, NULL, 'terminate_*',       'block', 'Destructive — blocks terminate_ tools'),
    (p_user_id, NULL, 'format_*',          'block', 'Destructive — blocks format_ tools'),
    -- Require confirmation for risky but not always destructive
    (p_user_id, NULL, 'push_*',            'require_confirmation', 'Risky — pushing code'),
    (p_user_id, NULL, 'merge_*',           'require_confirmation', 'Risky — merging branches'),
    (p_user_id, NULL, 'deploy_*',          'require_confirmation', 'Risky — deployments'),
    (p_user_id, NULL, 'send_*',            'require_confirmation', 'Risky — sending (emails, messages)')
  ON CONFLICT DO NOTHING;
$$;

-- Helper RPC: check if a tool call is allowed for a user
-- Returns: 'allowed' | 'blocked' | 'require_confirmation'
CREATE OR REPLACE FUNCTION public.check_tool_policy(
  p_user_id    UUID,
  p_server     TEXT,
  p_tool       TEXT
)
RETURNS TEXT LANGUAGE plpgsql STABLE SECURITY DEFINER AS $$
DECLARE
  v_action TEXT;
BEGIN
  -- Check server-specific policies first, then global (server_name IS NULL)
  SELECT action INTO v_action
  FROM public.tool_policies
  WHERE user_id = p_user_id
    AND (server_name = p_server OR server_name IS NULL)
    AND (
      p_tool = tool_pattern                                -- exact match
      OR p_tool LIKE REPLACE(tool_pattern, '*', '%')      -- glob match
    )
  ORDER BY
    (server_name IS NOT NULL) DESC,  -- server-specific takes priority
    CASE action WHEN 'block' THEN 0 WHEN 'require_confirmation' THEN 1 ELSE 2 END
  LIMIT 1;

  RETURN COALESCE(v_action, 'allowed');
END;
$$;
