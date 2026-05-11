-- ═════════════════════════════════════════════════════════════════════════════
-- relay — Migration 022: Intelligence & Analytics Data Layer
--
-- This is the core business asset. Three tables:
--
-- 1. intent_server_mappings — the feedback loop and ranking signal.
--    Every search→invoke chain writes here. Over time this table becomes
--    the training corpus for the Gap 3 fine-tuned model. It answers:
--    "Given this intent, which server + tool actually succeeded?"
--
-- 2. search_events — every call to search_tools with full context.
--    Answers: "What are agents trying to do? What did we return? What did
--    we miss?" Used for ecosystem gap analysis and search quality measurement.
--
-- 3. invoke_outcomes — every invoke_tool result, linked to its search.
--    Answers: "Did the suggested server work? How fast? Did it fail?"
--    The signal that drives ranking improvement.
--
-- Together these three tables are relay's moat. The longer the system
-- runs, the smarter the search becomes, and the harder the dataset is to
-- replicate.
-- ═════════════════════════════════════════════════════════════════════════════

-- ── 1. intent_server_mappings ─────────────────────────────────────────────────
-- Aggregated success/failure per (intent, server, tool) triple.
-- Updated atomically on every invoke_outcome. Used for search ranking boost.
-- This is the feedback loop that makes search smarter over time.

CREATE TABLE IF NOT EXISTS public.intent_server_mappings (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),

  -- Intent identity
  intent_hash       TEXT NOT NULL,    -- SHA-256 of normalized intent, for O(1) lookup
  intent_text       TEXT NOT NULL,    -- original intent string, for display/analysis
  intent_normalized TEXT NOT NULL,    -- lowercase + stripped for dedup

  -- Resolution
  server_name       TEXT NOT NULL,
  tool_name         TEXT NOT NULL DEFAULT '', -- Empty string if agent searched but didn't invoke

  -- Aggregate signals (updated in place, not append-only — keeps table small)
  invoke_count      INTEGER NOT NULL DEFAULT 0,
  success_count     INTEGER NOT NULL DEFAULT 0,
  failure_count     INTEGER NOT NULL DEFAULT 0,
  avg_latency_ms    INTEGER,          -- EWMA, updated on each success

  -- Time signals
  first_seen_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_invoked_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_success_at   TIMESTAMPTZ,
  last_failure_at   TIMESTAMPTZ,

  -- Derived: success_rate = success_count / NULLIF(invoke_count, 0)
  -- Used by search_servers RPC to boost historically successful (intent, server) pairs

  UNIQUE (intent_hash, server_name, tool_name)
);

-- Primary lookup: given intent_hash, find all server mappings ordered by success
CREATE INDEX IF NOT EXISTS idx_ism_intent_hash
  ON public.intent_server_mappings (intent_hash, success_count DESC);

-- For ranking boost in search: given server_name, find all its intent mappings
CREATE INDEX IF NOT EXISTS idx_ism_server_name
  ON public.intent_server_mappings (server_name, last_invoked_at DESC);

-- For ML training corpus export: all recent successful mappings
CREATE INDEX IF NOT EXISTS idx_ism_success_recent
  ON public.intent_server_mappings (last_success_at DESC NULLS LAST)
  WHERE success_count > 0;

-- Service role only — no user-level access to aggregate intelligence
ALTER TABLE public.intent_server_mappings ENABLE ROW LEVEL SECURITY;
-- No policies — only accessible via service_role (server-side code)

-- ── 2. search_events ──────────────────────────────────────────────────────────
-- One row per call to search_tools. Append-only.
-- Partition by month if volume exceeds 10M rows.

CREATE TABLE IF NOT EXISTS public.search_events (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),

  -- Who searched
  user_id         UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  session_id      TEXT,              -- anonymous session fingerprint for funnel analysis
  interface       TEXT NOT NULL DEFAULT 'mcp_server', -- 'mcp_server' | 'rest' | 'sdk'

  -- What they searched for
  intent_text     TEXT NOT NULL,
  intent_hash     TEXT NOT NULL,     -- SHA-256 of normalized intent
  intent_class    TEXT,              -- 'action' | 'knowledge' | 'ambiguous' (Lever 3 output)

  -- What we returned
  result_count    INTEGER NOT NULL DEFAULT 0,
  result_servers  TEXT[],            -- ordered list of server names returned
  top_server      TEXT,              -- first result (most relevant)
  top_confidence  NUMERIC(5,4),      -- confidence score of top result (0-1)
  cache_hit       BOOLEAN NOT NULL DEFAULT FALSE,  -- served from intent cache?
  no_tool_needed  BOOLEAN NOT NULL DEFAULT FALSE,  -- Lever 3A returned early?

  -- Performance
  search_latency_ms INTEGER,         -- time to execute search query
  total_latency_ms  INTEGER,         -- total handler time including cache check

  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_se_intent_hash   ON public.search_events (intent_hash);
CREATE INDEX IF NOT EXISTS idx_se_user_id       ON public.search_events (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_se_created_at    ON public.search_events (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_se_top_server    ON public.search_events (top_server, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_se_no_result     ON public.search_events (created_at DESC)
  WHERE result_count = 0;  -- ecosystem gap analysis: what are agents searching for that we can't answer?

ALTER TABLE public.search_events ENABLE ROW LEVEL SECURITY;
-- No user policies — analytics data, service_role only

-- ── 3. invoke_outcomes ────────────────────────────────────────────────────────
-- One row per invoke_tool call. Links back to the search_event that preceded it.
-- Append-only. The primary feedback signal.

CREATE TABLE IF NOT EXISTS public.invoke_outcomes (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),

  -- Linkage
  search_event_id UUID REFERENCES public.search_events(id) ON DELETE SET NULL,
  user_id         UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  server_id       UUID REFERENCES public.servers(id) ON DELETE SET NULL,

  -- What was invoked
  server_name     TEXT NOT NULL,
  tool_name       TEXT NOT NULL,
  intent_hash     TEXT,              -- the intent that led to this invoke (via search)

  -- Result
  status_code     INTEGER NOT NULL,
  success         BOOLEAN NOT NULL,  -- true if 2xx
  latency_ms      INTEGER,
  error_type      TEXT,              -- 'auth', 'policy', 'dlp', 'upstream', 'timeout', null
  dlp_triggered   BOOLEAN NOT NULL DEFAULT FALSE,
  was_retry       BOOLEAN NOT NULL DEFAULT FALSE,  -- agent retried after initial failure?
  retry_server    TEXT,              -- if retried, which server did they fall back to?

  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_io_search_event  ON public.invoke_outcomes (search_event_id);
CREATE INDEX IF NOT EXISTS idx_io_intent_hash   ON public.invoke_outcomes (intent_hash, success);
CREATE INDEX IF NOT EXISTS idx_io_server_name   ON public.invoke_outcomes (server_name, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_io_created_at    ON public.invoke_outcomes (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_io_retries       ON public.invoke_outcomes (created_at DESC)
  WHERE was_retry = TRUE;  -- detect systematic search quality failures

ALTER TABLE public.invoke_outcomes ENABLE ROW LEVEL SECURITY;
-- No user policies — analytics data, service_role only

-- ── RPCs for search ranking boost ─────────────────────────────────────────────

-- Called by search_servers to boost results with historical success data.
-- Returns success_rate and invoke_count for a list of server names given an intent.
-- O(1) lookup via index on (intent_hash, server_name).
CREATE OR REPLACE FUNCTION public.get_intent_boosts(
  p_intent_hash TEXT,
  p_server_names TEXT[]
)
RETURNS TABLE (
  server_name   TEXT,
  success_rate  NUMERIC,   -- 0–1
  invoke_count  INTEGER,
  avg_latency_ms INTEGER
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    ism.server_name,
    ROUND(
      COALESCE(ism.success_count::NUMERIC / NULLIF(ism.invoke_count, 0), 0),
      4
    ) AS success_rate,
    ism.invoke_count,
    ism.avg_latency_ms
  FROM public.intent_server_mappings ism
  WHERE ism.intent_hash = p_intent_hash
    AND ism.server_name = ANY(p_server_names)
  ORDER BY success_rate DESC;
$$;

-- Upsert outcome into intent_server_mappings.
-- Called asynchronously after every invoke_tool result.
CREATE OR REPLACE FUNCTION public.record_intent_outcome(
  p_intent_hash    TEXT,
  p_intent_text    TEXT,
  p_server_name    TEXT,
  p_tool_name      TEXT,
  p_success        BOOLEAN,
  p_latency_ms     INTEGER DEFAULT NULL
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_normalized TEXT := LOWER(TRIM(p_intent_text));
BEGIN
  INSERT INTO public.intent_server_mappings (
    intent_hash, intent_text, intent_normalized,
    server_name, tool_name,
    invoke_count, success_count, failure_count,
    avg_latency_ms, last_invoked_at,
    last_success_at, last_failure_at
  )
  VALUES (
    p_intent_hash, p_intent_text, v_normalized,
    p_server_name, COALESCE(p_tool_name, ''),
    1,
    CASE WHEN p_success THEN 1 ELSE 0 END,
    CASE WHEN p_success THEN 0 ELSE 1 END,
    p_latency_ms,
    NOW(),
    CASE WHEN p_success THEN NOW() ELSE NULL END,
    CASE WHEN p_success THEN NULL ELSE NOW() END
  )
  ON CONFLICT (intent_hash, server_name, tool_name)
  DO UPDATE SET
    invoke_count   = intent_server_mappings.invoke_count + 1,
    success_count  = intent_server_mappings.success_count + (CASE WHEN p_success THEN 1 ELSE 0 END),
    failure_count  = intent_server_mappings.failure_count + (CASE WHEN p_success THEN 0 ELSE 1 END),
    avg_latency_ms = CASE
      WHEN p_success AND p_latency_ms IS NOT NULL
      THEN ROUND(intent_server_mappings.avg_latency_ms * 0.9 + p_latency_ms * 0.1)
      ELSE intent_server_mappings.avg_latency_ms
    END,
    last_invoked_at = NOW(),
    last_success_at = CASE WHEN p_success THEN NOW() ELSE intent_server_mappings.last_success_at END,
    last_failure_at = CASE WHEN p_success THEN intent_server_mappings.last_failure_at ELSE NOW() END;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_intent_boosts     TO service_role;
GRANT EXECUTE ON FUNCTION public.record_intent_outcome TO service_role;

-- ── Analytics views ───────────────────────────────────────────────────────────

-- Top intents by volume — what agents are actually trying to do
CREATE OR REPLACE VIEW public.top_intents AS
SELECT
  intent_text,
  SUM(invoke_count)   AS total_invocations,
  SUM(success_count)  AS total_successes,
  ROUND(100.0 * SUM(success_count) / NULLIF(SUM(invoke_count), 0), 1) AS success_rate_pct,
  COUNT(DISTINCT server_name) AS server_diversity,
  MAX(last_invoked_at) AS last_seen
FROM public.intent_server_mappings
GROUP BY intent_text
ORDER BY total_invocations DESC;

-- Ecosystem gaps — intents with zero results (what we can't serve)
CREATE OR REPLACE VIEW public.ecosystem_gaps AS
SELECT
  intent_text,
  COUNT(*) AS search_attempts,
  MAX(created_at) AS last_attempted
FROM public.search_events
WHERE result_count = 0
  AND no_tool_needed = FALSE
  AND created_at > NOW() - INTERVAL '30 days'
GROUP BY intent_text
ORDER BY search_attempts DESC;

-- Search quality by day
CREATE OR REPLACE VIEW public.search_quality_daily AS
SELECT
  DATE(created_at)                                                        AS day,
  COUNT(*)                                                                AS total_searches,
  COUNT(*) FILTER (WHERE result_count = 0 AND no_tool_needed = FALSE)    AS zero_results,
  COUNT(*) FILTER (WHERE no_tool_needed = TRUE)                          AS knowledge_deflected,
  COUNT(*) FILTER (WHERE cache_hit = TRUE)                               AS cache_hits,
  ROUND(AVG(search_latency_ms))::INTEGER                                  AS avg_search_ms,
  ROUND(100.0 * COUNT(*) FILTER (WHERE cache_hit = TRUE) / NULLIF(COUNT(*), 0), 1) AS cache_hit_pct,
  ROUND(100.0 * COUNT(*) FILTER (WHERE result_count = 0 AND no_tool_needed = FALSE) / NULLIF(COUNT(*), 0), 1) AS zero_result_pct
FROM public.search_events
WHERE created_at > NOW() - INTERVAL '90 days'
GROUP BY DATE(created_at)
ORDER BY day DESC;

-- Server reliability ranking (the ML training signal)
CREATE OR REPLACE VIEW public.server_reliability AS
SELECT
  server_name,
  SUM(invoke_count)                                                        AS total_invokes,
  SUM(success_count)                                                       AS total_successes,
  ROUND(100.0 * SUM(success_count) / NULLIF(SUM(invoke_count), 0), 1)    AS success_rate_pct,
  ROUND(AVG(avg_latency_ms))::INTEGER                                      AS avg_latency_ms,
  COUNT(DISTINCT intent_hash)                                              AS unique_intents_served,
  MAX(last_success_at)                                                     AS last_success
FROM public.intent_server_mappings
WHERE invoke_count > 0
GROUP BY server_name
ORDER BY total_invokes DESC;