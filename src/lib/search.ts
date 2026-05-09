/**
 * search.ts — Shared search pipeline for all surfaces.
 *
 * S15: Extracts the search pipeline from the MCP route into a shared module
 * so both the MCP server and the REST API (/api/servers) get identical search
 * quality — caching, confidence scoring, schema trimming, and behavioral boosts.
 *
 * Surface differences:
 *   MCP:  Intent classifier → cache check → search_servers() → boosts → confidence → trim → cache
 *   REST: No classifier → cache check → search_servers() → boosts → confidence → trim → cache
 *         (knowledge deflection is MCP-specific — REST callers are developers, not agents)
 *
 * Both surfaces share the DB query, boost fetch, scoring, and caching paths.
 * The MCP route keeps its own rate limiting, auth, and JSON-RPC envelope.
 * The REST route keeps its own pagination and filter params.
 */

import { createClient }         from '@/lib/supabase/server';
import { BRAND }                from '@/lib/brand';
import {
  hashIntent,
  getIntentCache, setIntentCache,
  trimSchemasToIntent, computeConfidence,
  MAX_TOOLS_PER_RESULT,
  type CachedServer,
} from '@/lib/search-analytics';
import { deriveServerQualityStatus, deriveServerTrustState, type ServerQualityStatus, type ServerTrustState } from '@/lib/server-quality';

export interface SearchResult {
  name:                   string;
  display_name:           string | null;
  description:            string | null;
  confidence:             number;
  trust_score:            number | null;
  latency_ms:             number | null;
  uptime_pct:             number | null;
  source:                 string;
  verified:               boolean;
  scan_status:            string | null;
  tool_extraction_source: string;
  invoke_history:         { success_rate: number; invoke_count: number } | null;
  tools:                  any[];           // trimmed to MAX_TOOLS_PER_RESULT
  total_tools:            number;
  proxy_available:        boolean;
  transport:              string | null;
  usage:                  string;
  is_new:                 boolean;
  quality_status:         ServerQualityStatus;
  trust_state:            ServerTrustState;
}

export interface RunSearchOptions {
  intent:     string;
  limit:      number;
  surface:    'mcp' | 'rest';
  intentHash?: string; // pre-computed if available
}

export interface RunSearchResult {
  results:      SearchResult[];
  intentHash:   string;
  cacheHit:     boolean;
  searchLatencyMs: number;
}

/**
 * Core search pipeline — shared between MCP and REST surfaces.
 *
 * Stages:
 *   1. Check L1 intent cache (skips DB entirely on hit)
 *   2. Call search_servers() SQL RPC (FTS + trigram + diversity + ranking)
 *   3. Fetch intent-specific behavioral boosts (success rate per server per intent)
 *   4. Compute Wilson Score confidence for each result
 *   5. Trim tool schemas to MAX_TOOLS_PER_RESULT most relevant
 *   6. Populate intent cache if results are validated (invokeCount >= 5 OR trust >= 85)
 */
export async function runSearch(opts: RunSearchOptions): Promise<RunSearchResult> {
  const { intent, limit, surface } = opts;
  const intentHash = opts.intentHash ?? hashIntent(intent);
  const supabase   = createClient();

  // ── Stage 1: Intent cache ─────────────────────────────────────────────────────
  const cached = getIntentCache(intentHash);
  if (cached && cached.servers.length > 0) {
    const cachedOrder       = new Map(cached.servers.map((row, idx) => [row.server_name, idx]));
    const cachedBoostByName = new Map(cached.servers.map(row => [row.server_name, row]));
    const serverNames       = cached.servers.map(s => s.server_name);

    const { data: cachedRows } = await (supabase as any)
      .from('servers')
      .select(`
        id, name, display_name, description, tools, tool_schemas,
        trust_score, latency_ms, uptime_pct, source, verified, scan_status,
        tool_extraction_source, proxy_available, transport, endpoint
      `)
      .in('name', serverNames)
      .eq('status', 'active');

    const ordered = (cachedRows ?? [])
      .sort((a: any, b: any) => (cachedOrder.get(a.name) ?? 9999) - (cachedOrder.get(b.name) ?? 9999))
      .slice(0, limit);

      return {
      results:         formatResults(ordered, cachedBoostByName, intent, surface, 'cache'),
      intentHash,
      cacheHit:        true,
      searchLatencyMs: 0,
    };
  }

  // ── Stage 2: Full DB search ───────────────────────────────────────────────────
  // S12: Pass intentHash so search_servers() can fold the intent-specific boost
  // LATERAL join into a single DB call — eliminates the old getIntentBoosts() RPC.
  // p_intent_hash defaults to '' inside the SQL function when not provided.
  const searchStart = Date.now();
  const { data: results, error: searchError } = await (supabase as any)
    .rpc('search_servers', {
      query_text:    intent,
      result_limit:  limit,
      p_intent_hash: intentHash,   // S12: intent-boost LATERAL inside the function
    });
  const searchLatencyMs = Date.now() - searchStart;

  if (searchError || !results?.length) {
    return { results: [], intentHash, cacheHit: false, searchLatencyMs };
  }

  // ── Stage 3: Confidence scoring + schema trimming ─────────────────────────────
  // S12: Intent boost data now comes directly from result rows — no extra RPC.
  // Fields: intent_invoke_count, intent_success_rate, intent_avg_latency_ms.
  // These are null when p_intent_hash='' or the server has no history for this intent.

  const formatted: SearchResult[] = results.map((s: any, idx: number) => {
    // S12: read intent-specific boost from the SQL result row directly
    const intentInvokeCount   = (s.intent_invoke_count  ?? 0)  as number;
    const intentSuccessRate   = (s.intent_success_rate  ?? 0)  as number;
    const intentAvgLatency    = (s.intent_avg_latency_ms ?? null) as number | null;

    const confidence = computeConfidence({
      rank:         idx,
      totalResults: results.length,
      trustScore:   s.trust_score ?? 50,
      successRate:  intentSuccessRate,
      invokeCount:  intentInvokeCount,
    });

    const rawTools: any[] = (s.tool_schemas?.length ?? 0) > 0
      ? s.tool_schemas
      : (s.tools ?? []).map((t: any) =>
          typeof t === 'string' ? { name: t } : { name: t.name, description: t.description, inputSchema: t.inputSchema }
        );
    const trimmedTools   = trimSchemasToIntent(rawTools, intent);
    const proxyAvailable = s.proxy_available ?? ((s.transport ?? 'streamable_http') !== 'stdio' && Boolean(s.endpoint));
    const isStdio        = s.transport === 'stdio';

    return {
      name:                   s.name,
      display_name:           s.display_name,
      description:            s.description,
      confidence,
      trust_score:            s.trust_score,
      latency_ms:             intentAvgLatency ?? s.latency_ms,   // prefer behavioral
      uptime_pct:             s.uptime_pct,
      source:                 s.source ?? 'direct',
      verified:               s.verified,
      scan_status:            s.scan_status,
      tool_extraction_source: s.tool_extraction_source ?? 'none',  // S12: now in result
      invoke_history:         intentInvokeCount > 0 ? {
        success_rate: Math.round(intentSuccessRate * 100),
        invoke_count: intentInvokeCount,
      } : null,
      tools:           trimmedTools,
      total_tools:     rawTools.length,
      proxy_available: proxyAvailable,
      transport:       s.transport ?? null,
      usage: proxyAvailable === false
        ? isStdio
          ? `This is a local stdio process. Use: npx -y @${BRAND.slug}/cli invoke ${s.name} <tool_name>`
          : `This server is discoverable but not currently proxyable. Check its transport metadata before invoking.`
        : `invoke_tool({ server: "${s.name}", tool: "<tool_name>", args: {...} })`,
      is_new: s.is_new ?? false,
      quality_status: deriveServerQualityStatus(s),
      trust_state: deriveServerTrustState(s),
    } satisfies SearchResult;
  });

  // ── Stage 4: Populate intent cache ───────────────────────────────────────────
  // S11: setIntentCache enforces the gate internally (invokeCount >= 5 OR trust >= 85).
  const topResult = formatted[0];
  if (topResult) {
    const cacheableServers: CachedServer[] = formatted
      .filter(r => r.confidence > 0.4)
      .map(r => ({
        server_name:    r.name,
        tool_name:      r.tools?.[0]?.name ?? null,
        success_rate:   r.confidence,
        invoke_count:   r.invoke_history?.invoke_count ?? 0,
        avg_latency_ms: r.latency_ms ?? null,
      }));
    setIntentCache(
      intentHash,
      cacheableServers,
      topResult.invoke_history?.invoke_count ?? 0,
      topResult.trust_score ?? 0,
    );
  }

  return { results: formatted, intentHash, cacheHit: false, searchLatencyMs };
}

// ── Internal helpers ──────────────────────────────────────────────────────────

function formatResults(
  rows:           any[],
  boostByName:    Map<string, CachedServer>,
  intent:         string,
  surface:        'mcp' | 'rest',
  _source:        'cache' | 'db'
): SearchResult[] {
  return rows.map((s: any) => {
    const boost          = boostByName.get(s.name);
    const proxyAvailable = s.proxy_available ?? ((s.transport ?? 'streamable_http') !== 'stdio' && Boolean(s.endpoint));
    const isStdio        = s.transport === 'stdio';

    const rawTools: any[] = (s.tool_schemas?.length ?? 0) > 0
      ? s.tool_schemas
      : (s.tools ?? []).map((t: any) =>
          typeof t === 'string' ? { name: t } : { name: t.name, description: t.description, inputSchema: t.inputSchema }
        );

    return {
      name:                   s.name,
      display_name:           s.display_name,
      description:            s.description,
      confidence:             boost?.success_rate ?? 0,
      trust_score:            s.trust_score,
      latency_ms:             boost?.avg_latency_ms ?? s.latency_ms,
      uptime_pct:             s.uptime_pct,
      source:                 s.source ?? 'direct',
      verified:               s.verified,
      scan_status:            s.scan_status,
      tool_extraction_source: s.tool_extraction_source ?? 'none',
      invoke_history:         boost ? {
        success_rate: Math.round((boost.success_rate ?? 0) * 100),
        invoke_count: boost.invoke_count ?? 0,
      } : null,
      tools:           trimSchemasToIntent(rawTools, intent),
      total_tools:     rawTools.length,
      proxy_available: proxyAvailable,
      transport:       s.transport ?? null,
      usage: proxyAvailable === false
        ? isStdio
          ? `This is a local stdio process. Use: npx -y @${BRAND.slug}/cli invoke ${s.name} <tool_name>`
          : `This server is discoverable but not currently proxyable. Check its transport metadata before invoking.`
        : `invoke_tool({ server: "${s.name}", tool: "<tool_name>", args: {...} })`,
      is_new: s.is_new ?? false,
      quality_status: deriveServerQualityStatus(s),
      trust_state: deriveServerTrustState(s),
    };
  });
}

// Re-export so callers don't need to import from two places
export { MAX_TOOLS_PER_RESULT, hashIntent };
