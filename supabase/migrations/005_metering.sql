-- ─────────────────────────────────────────────────────────────────────────────
-- relay — Migration 005: Per-call metering for revenue share
-- ─────────────────────────────────────────────────────────────────────────────

-- Metering events — billing-grade call tracking
-- Every proxy call (REST + MCP server) writes one row here
CREATE TABLE IF NOT EXISTS public.metering_events (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  server_id     UUID NOT NULL REFERENCES public.servers(id) ON DELETE CASCADE,
  user_id       UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  tool_name     TEXT NOT NULL,
  interface     TEXT NOT NULL DEFAULT 'rest', -- 'rest' | 'mcp_server'
  request_bytes INTEGER NOT NULL DEFAULT 0,
  response_bytes INTEGER NOT NULL DEFAULT 0,
  latency_ms    INTEGER,
  status_code   INTEGER,
  dlp_triggered BOOLEAN NOT NULL DEFAULT FALSE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Partition hint — metering grows fast, query by month
CREATE INDEX IF NOT EXISTS idx_metering_server_id  ON public.metering_events(server_id);
CREATE INDEX IF NOT EXISTS idx_metering_user_id    ON public.metering_events(user_id);
CREATE INDEX IF NOT EXISTS idx_metering_created_at ON public.metering_events(created_at DESC);

-- RLS — users see their own calls, server owners see their server calls
ALTER TABLE public.metering_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "metering_own_calls"
  ON public.metering_events FOR SELECT TO authenticated
  USING (
    user_id = auth.uid()
    OR server_id IN (
      SELECT id FROM public.servers WHERE author_id = auth.uid()
    )
  );

-- Service role can insert (proxy writes metering events)
-- No explicit policy needed — service role bypasses RLS

-- Revenue summary view — per server, rolling 30 days
CREATE OR REPLACE VIEW public.revenue_summary AS
SELECT
  s.id           AS server_id,
  s.name         AS server_name,
  s.author_id,
  COUNT(*)       AS calls_30d,
  -- $0.001 per call, 90% to developer
  COUNT(*) * 0.001 * 0.90 AS developer_earnings_usd,
  COUNT(*) * 0.001 * 0.10 AS platform_earnings_usd,
  AVG(m.latency_ms)::INTEGER AS avg_latency_ms,
  SUM(m.response_bytes) AS total_response_bytes
FROM public.metering_events m
JOIN public.servers s ON s.id = m.server_id
WHERE m.created_at > NOW() - INTERVAL '30 days'
GROUP BY s.id, s.name, s.author_id;

-- Helper RPC — server analytics for dashboard
CREATE OR REPLACE FUNCTION public.server_analytics(
  p_server_name TEXT,
  p_days        INTEGER DEFAULT 30
)
RETURNS JSON LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT json_build_object(
    'total_calls',     COUNT(*),
    'error_calls',     COUNT(*) FILTER (WHERE status_code >= 400),
    'dlp_triggers',    COUNT(*) FILTER (WHERE dlp_triggered = TRUE),
    'avg_latency_ms',  ROUND(AVG(latency_ms))::INTEGER,
    'calls_by_tool',   (
      SELECT json_agg(json_build_object('tool', tool_name, 'calls', cnt))
      FROM (
        SELECT tool_name, COUNT(*) AS cnt
        FROM public.metering_events
        WHERE server_id = (SELECT id FROM public.servers WHERE name = p_server_name)
          AND created_at > NOW() - (p_days || ' days')::INTERVAL
        GROUP BY tool_name
        ORDER BY cnt DESC
        LIMIT 10
      ) t
    ),
    'calls_by_day', (
      SELECT json_agg(json_build_object('date', day, 'calls', cnt))
      FROM (
        SELECT DATE(created_at) AS day, COUNT(*) AS cnt
        FROM public.metering_events
        WHERE server_id = (SELECT id FROM public.servers WHERE name = p_server_name)
          AND created_at > NOW() - (p_days || ' days')::INTERVAL
        GROUP BY day
        ORDER BY day
      ) t
    )
  )
  FROM public.metering_events
  WHERE server_id = (SELECT id FROM public.servers WHERE name = p_server_name)
    AND created_at > NOW() - (p_days || ' days')::INTERVAL;
$$;
