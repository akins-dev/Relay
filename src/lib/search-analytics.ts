/**
 * search-analytics.ts
 *
 * Standard data collection layer for all search and invoke activity.
 *
 * DESIGN PRINCIPLES:
 *   1. Always non-blocking — analytics never slow down the critical path.
 *      Every write is fire-and-forget via after() or Promise.catch().
 *   2. Always complete — every event has a defined schema. No ad-hoc fields.
 *   3. Always linked — invoke_outcomes reference the search_event that
 *      preceded them, enabling full funnel analysis.
 *   4. Always normalized — intent strings are normalized before hashing
 *      so "Send email" and "send email" map to the same hash.
 *
 * WHY THIS IS THE CORE BUSINESS ASSET:
 *   The intent→server mappings accumulated here are:
 *   - The feedback loop that improves search ranking in real time
 *   - The training corpus for the Gap 3 fine-tuned model
 *   - The dataset that reveals ecosystem gaps (what agents need but can't find)
 *   - The evidence base for trust score behavioral signals
 *   - The source of truth for "which servers actually work for which intents"
 *
 * This file is the single source of truth for how analytics data is collected.
 * Never write analytics directly to Supabase from route handlers — always go
 * through this module so the schema stays consistent.
 */

import { createHash }        from 'crypto';
import { createServiceClient } from '@/lib/supabase/server';

// ── Intent normalization ───────────────────────────────────────────────────────
// Normalize intent strings before hashing so semantically identical queries
// map to the same bucket regardless of capitalization, whitespace, or punctuation.

export function normalizeIntent(intent: string): string {
  return intent
    .toLowerCase()
    .trim()
    .replace(/\s+/g, ' ')         // collapse whitespace
    .replace(/[.,!?;:]+$/g, '')   // strip trailing punctuation
    .slice(0, 500);               // cap at 500 chars
}

export function hashIntent(intent: string): string {
  return createHash('sha256')
    .update(normalizeIntent(intent))
    .digest('hex')
    .slice(0, 32);               // 32 hex chars = 128 bits, sufficient for collision resistance
}

// ── Search event ──────────────────────────────────────────────────────────────

export interface SearchEventParams {
  userId:          string | null;
  sessionId:       string;
  interface:       'mcp_server' | 'rest' | 'sdk';
  intentText:      string;
  intentClass:     'action' | 'knowledge' | 'ambiguous';
  resultCount:     number;
  resultServers:   string[];
  topServer:       string | null;
  topConfidence:   number | null;
  cacheHit:        boolean;
  noToolNeeded:    boolean;
  searchLatencyMs: number;
  totalLatencyMs:  number;
}

/**
 * Record a search_tools call. Returns the search_event UUID so it can be
 * passed to recordInvokeOutcome() to link the full funnel.
 *
 * Fire-and-forget safe — errors are suppressed.
 */
export async function recordSearchEvent(params: SearchEventParams): Promise<string | null> {
  try {
    const svc = createServiceClient();
    const intentHash = hashIntent(params.intentText);

    const { data } = await svc
      .from('search_events')
      .insert({
        user_id:          params.userId,
        session_id:       params.sessionId,
        interface:        params.interface,
        intent_text:      params.intentText,
        intent_hash:      intentHash,
        intent_class:     params.intentClass,
        result_count:     params.resultCount,
        result_servers:   params.resultServers,
        top_server:       params.topServer,
        top_confidence:   params.topConfidence,
        cache_hit:        params.cacheHit,
        no_tool_needed:   params.noToolNeeded,
        search_latency_ms: params.searchLatencyMs,
        total_latency_ms: params.totalLatencyMs,
      })
      .select('id')
      .single();

    return data?.id ?? null;
  } catch {
    return null;
  }
}

// ── Invoke outcome ─────────────────────────────────────────────────────────────

export interface InvokeOutcomeParams {
  searchEventId:  string | null;   // from recordSearchEvent()
  userId:         string | null;
  serverId:       string | null;
  serverName:     string;
  toolName:       string;
  intentHash:     string | null;   // from the preceding search
  intentText:     string | null;
  statusCode:     number;
  success:        boolean;
  latencyMs:      number;
  errorType:      'auth' | 'policy' | 'dlp' | 'upstream' | 'timeout' | null;
  dlpTriggered:   boolean;
  wasRetry:       boolean;
  retryServer:    string | null;
}

/**
 * Record an invoke_tool result and update the intent_server_mappings table.
 * This is the core feedback loop — every success/failure updates the ranking
 * signal for future searches with the same intent.
 *
 * Always fire-and-forget. Never blocks the proxy response.
 */
export async function recordInvokeOutcome(params: InvokeOutcomeParams): Promise<void> {
  try {
    const svc = createServiceClient();

    // 1. Insert invoke outcome row (append-only event log)
    await svc.from('invoke_outcomes').insert({
      search_event_id: params.searchEventId,
      user_id:         params.userId,
      server_id:       params.serverId,
      server_name:     params.serverName,
      tool_name:       params.toolName,
      intent_hash:     params.intentHash,
      status_code:     params.statusCode,
      success:         params.success,
      latency_ms:      params.latencyMs,
      error_type:      params.errorType,
      dlp_triggered:   params.dlpTriggered,
      was_retry:       params.wasRetry,
      retry_server:    params.retryServer,
    });

    // 2. Update aggregated intent_server_mappings (the ranking signal)
    if (params.intentHash && params.intentText) {
      await svc.rpc('record_intent_outcome', {
        p_intent_hash:  params.intentHash,
        p_intent_text:  params.intentText,
        p_server_name:  params.serverName,
        p_tool_name:    params.toolName,
        p_success:      params.success,
        p_latency_ms:   params.success ? params.latencyMs : null,
      });
    }
  } catch {
    // Analytics failures never propagate — the proxy call already succeeded or failed.
  }
}

// ── Intent cache ──────────────────────────────────────────────────────────────
// Aggressive caching of frequent intent→server mappings.
// Cache key: intent_hash → { servers: string[], confidence: number, cachedAt: number }
// TTL: 10 minutes for high-confidence mappings, 2 minutes for low-confidence.

export interface CachedMapping {
  servers:      CachedServer[];
  intentHash:   string;
  cachedAt:     number;
  hitCount:     number;
}

export interface CachedServer {
  server_name:   string;
  tool_name:     string | null;
  success_rate:  number;
  invoke_count:  number;
  avg_latency_ms: number | null;
}

const CACHE_TTL_HIGH_CONFIDENCE = 10 * 60 * 1000;  // 10 min for success_rate > 0.8
const CACHE_TTL_LOW_CONFIDENCE  =  2 * 60 * 1000;  // 2 min for lower confidence

// In-memory L1 cache (single process — works on Vercel Edge where each request is isolated)
// In production with session pooling, this moves to Upstash Redis.
const intentL1Cache = new Map<string, CachedMapping>();
const INTENT_CACHE_MAX = 2000;

/**
 * Look up intent in the intent_server_mappings cache.
 * Returns null if not found or expired.
 */
export function getIntentCache(intentHash: string): CachedMapping | null {
  const entry = intentL1Cache.get(intentHash);
  if (!entry) return null;

  const age = Date.now() - entry.cachedAt;
  const topRate = entry.servers[0]?.success_rate ?? 0;
  const ttl = topRate >= 0.8 ? CACHE_TTL_HIGH_CONFIDENCE : CACHE_TTL_LOW_CONFIDENCE;

  if (age > ttl) {
    intentL1Cache.delete(intentHash);
    return null;
  }

  entry.hitCount++;
  return entry;
}

/**
 * Store intent→server mappings in the L1 cache.
 */
export function setIntentCache(intentHash: string, servers: CachedServer[]): void {
  if (intentL1Cache.size >= INTENT_CACHE_MAX) {
    // Evict oldest entry (Map iteration is insertion-order)
    const firstKey = intentL1Cache.keys().next().value;
    if (firstKey) intentL1Cache.delete(firstKey);
  }
  intentL1Cache.set(intentHash, {
    servers,
    intentHash,
    cachedAt: Date.now(),
    hitCount: 0,
  });
}

/**
 * Fetch historical success data for a set of servers given an intent.
 * Used to boost search results with behavioral evidence.
 */
export async function getIntentBoosts(
  intentHash: string,
  serverNames: string[]
): Promise<Map<string, { successRate: number; invokeCount: number; avgLatencyMs: number | null }>> {
  const result = new Map();
  if (!intentHash || serverNames.length === 0) return result;

  try {
    const svc = createServiceClient();
    const { data } = await svc.rpc('get_intent_boosts', {
      p_intent_hash:   intentHash,
      p_server_names:  serverNames,
    });

    for (const row of data ?? []) {
      result.set(row.server_name, {
        successRate:   Number(row.success_rate ?? 0),
        invokeCount:   row.invoke_count ?? 0,
        avgLatencyMs:  row.avg_latency_ms ?? null,
      });
    }
  } catch {
    // Non-fatal — search proceeds without boost data
  }

  return result;
}

// ── Schema trimming ────────────────────────────────────────────────────────────
// Return only the tools from a server that are relevant to the intent.
// Prevents sending 50 tool schemas when the agent needs 2.
// Max 3 tools per server in search results.

export const MAX_TOOLS_PER_RESULT = 3;

export function trimSchemasToIntent(
  tools: Array<{ name: string; description?: string; inputSchema?: any }>,
  intent: string
): Array<{ name: string; description?: string; inputSchema?: any }> {
  if (!tools || tools.length === 0) return [];
  if (tools.length <= MAX_TOOLS_PER_RESULT) return tools;

  const intentWords = new Set(
    normalizeIntent(intent)
      .split(' ')
      .filter(w => w.length > 3)  // skip short words
  );

  // Score each tool by word overlap with intent
  const scored = tools.map(tool => {
    const toolText = `${tool.name} ${tool.description ?? ''}`.toLowerCase();
    let score = 0;
    for (const word of intentWords) {
      if (toolText.includes(word)) score++;
    }
    // Exact name match is a strong signal
    if (intentWords.has(tool.name.toLowerCase())) score += 5;
    return { tool, score };
  });

  // Return top MAX_TOOLS_PER_RESULT by score, preserving order on ties
  return scored
    .sort((a, b) => b.score - a.score)
    .slice(0, MAX_TOOLS_PER_RESULT)
    .map(s => s.tool);
}

// ── Confidence scoring ─────────────────────────────────────────────────────────
// Compute a 0–1 confidence score for each search result.
// Combines: FTS rank position + trust score + historical success rate.

export function computeConfidence(params: {
  rank:          number;    // 0-based position in results (0 = best)
  totalResults:  number;
  trustScore:    number;    // 0-100
  successRate:   number;    // 0-1, from intent_server_mappings (0 if no history)
  invokeCount:   number;    // how many times invoked for this intent
}): number {
  const { rank, totalResults, trustScore, successRate, invokeCount } = params;

  // Positional score: 1.0 for rank 0, decays to 0.5 for last result
  const positional = totalResults <= 1
    ? 1.0
    : 1.0 - (rank / (totalResults - 1)) * 0.5;

  // Trust score normalized 0-1
  const trust = Math.min(1, trustScore / 100);

  // Historical success rate (weighted by invoke count — more data = more weight)
  // invokeCount = 0 → weight 0, invokeCount ≥ 50 → full weight
  const historyWeight = Math.min(1, invokeCount / 50);
  const history = successRate * historyWeight;

  // Weighted combination
  // Positional: 40% weight (primary signal when no history)
  // Trust:      35% weight (static quality signal)
  // History:    25% weight (grows as invoke_count increases)
  const confidence = (positional * 0.40) + (trust * 0.35) + (history * 0.25);

  return Math.round(confidence * 10000) / 10000; // 4 decimal places
}

// ── Error type classification ──────────────────────────────────────────────────
// Maps HTTP status codes + context to structured error types.
// Used by invoke_outcomes for analytics and retry logic.

export function classifyError(
  statusCode:    number,
  dlpTriggered:  boolean,
  responseBody:  string
): InvokeOutcomeParams['errorType'] {
  if (dlpTriggered) return 'dlp';
  if (statusCode === 401 || statusCode === 403) return 'auth';
  if (statusCode === 429) return 'policy';  // rate limit / policy block
  if (statusCode >= 500) return 'upstream';
  if (statusCode === 408 || responseBody.includes('timeout')) return 'timeout';
  return null;
}