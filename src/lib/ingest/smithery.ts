/**
 * Smithery Registry Fetcher
 *
 * Source: registry.smithery.ai + api.smithery.ai
 * Tier:   PRIMARY — provides live endpoints + pre-stored tool schemas
 *
 * Two-phase strategy:
 *   Phase 1 — Listing sweep:
 *     GET https://registry.smithery.ai/servers?q=&page=N&pageSize=100
 *     Collects qualifiedName, displayName, description, iconUrl, homepage,
 *     verified (top-level boolean), bySmithery, useCount, createdAt
 *     — NO tools, NO endpoint.
 *
 *   Phase 2 — Detail fetch for ALL servers (concurrency 5):
 *     GET https://api.smithery.ai/v2/servers/{qualifiedName}
 *     Returns: deploymentUrl (endpoint), connections[].type (transport),
 *              connections[].configSchema (→ env_var_schema),
 *              tools[] with inputSchema, resources[], prompts[]
 *
 * Rate limiting: 429 responses trigger exponential backoff + warning log.
 * Smithery concurrency is intentionally low (5) to stay well within API limits.
 */

import type {
  IngestServer,
  Transport,
  ToolSchema,
  McpResource,
  McpPrompt,
  EnvVarSpec,
} from './types';
import { slugify } from './helpers';
import { log } from '@/lib/logger';

const TAG = 'ingest:smithery';
const LISTING_URL  = 'https://registry.smithery.ai/servers';
const DETAIL_URL   = 'https://api.smithery.ai/v2/servers';
const CONCURRENCY  = 5;    // Conservative — avoids rate-limit triggers
const PAGE_SIZE    = 100;
const BACKOFF_BASE = 2_000; // ms — base for exponential backoff on 429

// ── Transport helpers ─────────────────────────────────────────────────────────

export function resolveSmitheryTransport(
  connections: any[] | undefined,
  deploymentUrl?: string | null
): { endpoint: string | null; transport: Transport } {
  const declared = Array.isArray(connections) ? connections : [];

  for (const conn of declared) {
    const url  = typeof conn?.url === 'string' ? conn.url.trim() : null;
    const type = typeof conn?.type === 'string' ? conn.type.toLowerCase() : '';
    if (type === 'streamable-http' || type === 'http') {
      return { endpoint: url, transport: 'streamable_http' };
    }
    if (type === 'sse') {
      return { endpoint: url, transport: 'sse' };
    }
  }

  // Smithery-hosted deployment URL
  const hosted = typeof deploymentUrl === 'string' ? deploymentUrl.trim() : null;
  if (hosted) return { endpoint: hosted, transport: 'streamable_http' };

  // stdio fallback
  if (declared.some(c => typeof c?.type === 'string' && c.type.toLowerCase() === 'stdio')) {
    return { endpoint: null, transport: 'stdio' };
  }

  return { endpoint: null, transport: 'unknown' };
}

// ── EnvVarSpec from configSchema ──────────────────────────────────────────────

function normalizeEnvVarsFromConfigSchema(configSchema: any): EnvVarSpec[] {
  if (!configSchema || typeof configSchema !== 'object') return [];
  const props = configSchema.properties ?? {};
  const required: string[] = Array.isArray(configSchema.required) ? configSchema.required : [];
  const specs: EnvVarSpec[] = [];

  for (const [name, def] of Object.entries<any>(props)) {
    const isExplicitlySecret = def.isSecret === true || def.secret === true;
    const nameImpliesSecret  = (
      name.toLowerCase().includes('key') ||
      name.toLowerCase().includes('token') ||
      name.toLowerCase().includes('secret')
    );
    // H2 fix: heuristic secret detection (name-based) only fires when the variable is
    // also required AND has no default. Optional keys (e.g. apiKey with a default value)
    // should NOT trigger 'api_key' auth type — that blocks users from trying the server.
    const isRequired = required.includes(name);
    const hasDefault = def.default !== undefined;
    const isSecret   = isExplicitlySecret || (nameImpliesSecret && isRequired && !hasDefault);

    specs.push({
      name,
      description:  typeof def.description === 'string' ? def.description : undefined,
      isRequired,
      isSecret,
      defaultValue: def.default !== undefined ? String(def.default) : undefined,
      format:       def.type === 'boolean' ? 'boolean'
                  : def.type === 'number'  ? 'number'
                  : 'string',
    });
  }

  return specs;
}

// ── Detail fetch (with 429 backoff) ──────────────────────────────────────────

interface SmitheryDetail {
  endpoint:       string | null;
  transport:      Transport;
  tool_schemas:   ToolSchema[];
  resources:      McpResource[];
  prompts:        McpPrompt[];
  env_var_schema: EnvVarSpec[] | null;
}

interface FetchDetailResult {
  detail:        SmitheryDetail | null;
  rateLimitHits: number; // how many 429s were hit for this server
}

async function fetchDetail(
  qualifiedName: string,
  apiKey: string,
  retries = 3
): Promise<FetchDetailResult> {
  const url = `${DETAIL_URL}/${encodeURIComponent(qualifiedName)}`;
  let rateLimitHits = 0;

  for (let attempt = 1; attempt <= retries; attempt++) {
    let res: Response;
    try {
      res = await fetch(url, {
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'User-Agent':  'relay-ingest/2.0',
          'Accept':      'application/json',
        },
        signal: AbortSignal.timeout(12_000),
      });
    } catch (err) {
      // M3 fix: retry on transient network errors (DNS, TLS, ECONNRESET) —
      // the original code returned null immediately, losing servers on transient failures.
      log.warn(TAG, `Detail fetch network error for ${qualifiedName} (attempt ${attempt})`, err);
      if (attempt < retries) {
        await new Promise(r => setTimeout(r, 1_000 * attempt)); // 1s, 2s backoff
        continue;
      }
      return { detail: null, rateLimitHits };
    }

    // 429 — Rate limited: backoff and retry
    if (res.status === 429) {
      const retryAfter = res.headers.get('Retry-After');
      const waitMs = retryAfter
        ? parseInt(retryAfter, 10) * 1000
        : BACKOFF_BASE * Math.pow(2, attempt - 1);
      log.warn(TAG, `Rate limited on ${qualifiedName} — waiting ${waitMs}ms`, {
        attempt, qualifiedName, waitMs,
      });
      rateLimitHits++; // C4/L1 fix: accumulate per-server, returned to outer scope
      await new Promise(r => setTimeout(r, waitMs));
      continue;
    }

    if (res.status === 404) return { detail: null, rateLimitHits }; // Server exists in listing but no detail
    if (!res.ok) {
      log.warn(TAG, `Detail ${qualifiedName} returned ${res.status}`);
      return { detail: null, rateLimitHits };
    }

    let data: any;
    try { data = await res.json(); }
    catch { return { detail: null, rateLimitHits }; }

    const connections: any[] = Array.isArray(data.connections) ? data.connections : [];
    const { endpoint, transport } = resolveSmitheryTransport(connections, data.deploymentUrl);

    // Get configSchema from first connection that has one
    const configSchema = connections.find(c => c.configSchema)?.configSchema ?? null;
    const env_var_schema = configSchema ? normalizeEnvVarsFromConfigSchema(configSchema) : null;

    const tool_schemas: ToolSchema[] = (Array.isArray(data.tools) ? data.tools : [])
      .map((t: any) => ({
        name:        String(t.name ?? '').trim(),
        description: typeof t.description === 'string' ? t.description : undefined,
        inputSchema: t.inputSchema ?? t.input_schema ?? undefined,
      }))
      .filter((t: ToolSchema) => t.name);

    const resources: McpResource[] = (Array.isArray(data.resources) ? data.resources : [])
      .map((r: any) => ({
        uri:         String(r.uri ?? ''),
        name:        String(r.name ?? r.uri ?? ''),
        description: typeof r.description === 'string' ? r.description : undefined,
        mimeType:    typeof r.mimeType === 'string' ? r.mimeType : undefined,
      }))
      .filter((r: McpResource) => r.uri);

    const prompts: McpPrompt[] = (Array.isArray(data.prompts) ? data.prompts : [])
      .map((p: any) => ({
        name:        String(p.name ?? '').trim(),
        description: typeof p.description === 'string' ? p.description : undefined,
      }))
      .filter((p: McpPrompt) => p.name);

    return { detail: { endpoint, transport, tool_schemas, resources, prompts, env_var_schema }, rateLimitHits };
  }

  log.error(TAG, `Exhausted retries for detail fetch: ${qualifiedName}`);
  return { detail: null, rateLimitHits };
}

// ── Concurrency runner ────────────────────────────────────────────────────────

async function runWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T, index: number) => Promise<R>
): Promise<Array<{ item: T; result: R | null }>> {
  const results: Array<{ item: T; result: R | null }> = [];
  let i = 0;

  async function worker() {
    while (i < items.length) {
      const idx = i++;
      const item = items[idx];
      try {
        const result = await fn(item, idx);
        results.push({ item, result });
      } catch {
        results.push({ item, result: null });
      }
    }
  }

  await Promise.all(Array.from({ length: concurrency }, worker));
  return results;
}

// ── Main fetcher ──────────────────────────────────────────────────────────────

export async function fetchSmitheryServers(): Promise<IngestServer[]> {
  const apiKey = process.env.SMITHERY_API_KEY;
  if (!apiKey) {
    log.warn(TAG, 'SMITHERY_API_KEY not set — skipping');
    return [];
  }

  // ── Phase 1: Listing sweep ──────────────────────────────────────────────
  log.info(TAG, 'Phase 1: listing sweep starting');

  type ListingEntry = {
    qualifiedName:  string;
    displayName:    string;
    description:    string;
    iconUrl?:       string;
    homepage?:      string;
    /**
     * Top-level `verified` boolean from the Smithery listing API.
     * True = Smithery's review process passed for this server.
     * NOTE: This is NOT nested under `security.scanPassed` — that path does not exist.
     */
    verified:       boolean;
    /**
     * True = Smithery itself built and maintains this server (Gmail, GitHub, Google Sheets, etc.).
     * These are Smithery's own curated integrations — the canonical choice for their domain.
     * Used to set is_canonical = true in the DB.
     */
    bySmithery:     boolean;
    /**
     * Real-world usage count (agent invocations). Grade B trust signal.
     * Log scale: 55,000 uses = ~14.7 trust pts. Zero uses = 0 pts.
     */
    useCount:       number;
    createdAt?:     string;
    updatedAt?:     string;
    repository?:    string;
  };

  const listingEntries: ListingEntry[] = [];
  let page = 1;
  let totalFromApi = 0;
  let skippedNotDeployed = 0;

  while (true) {
    let data: any;
    try {
      const res = await fetch(
        `${LISTING_URL}?q=&page=${page}&pageSize=${PAGE_SIZE}`,
        {
          headers: {
            Authorization: `Bearer ${apiKey}`,
            'User-Agent': 'relay-ingest/2.0',
            'Accept': 'application/json',
          },
          signal: AbortSignal.timeout(15_000),
        }
      );

      if (res.status === 429) {
        log.warn(TAG, `Listing page ${page} rate limited — waiting 5s`);
        await new Promise(r => setTimeout(r, 5_000));
        continue; // retry same page
      }

      if (!res.ok) {
        log.warn(TAG, `Listing page ${page} returned ${res.status} — stopping`);
        break;
      }

      data = await res.json();
    } catch (err) {
      log.error(TAG, `Listing page ${page} fetch failed`, err);
      break;
    }

    const items: any[] = data.servers ?? [];
    if (items.length === 0) break;

    totalFromApi = data.totalCount ?? totalFromApi;

    for (const s of items) {
      const qn = typeof s.qualifiedName === 'string' ? s.qualifiedName : '';
      if (!qn) continue;

      // Only ingest servers with a live, reachable deployment.
      // isDeployed: false means Smithery couldn't reach the endpoint
      // when it last crawled — no endpoint to invoke, no tools stored.
      if (!s.isDeployed) {
        skippedNotDeployed++;
        continue;
      }

      listingEntries.push({
        qualifiedName: qn,
        displayName:   s.displayName ?? qn,
        description:   typeof s.description === 'string' ? s.description : '',
        iconUrl:       typeof s.iconUrl === 'string' ? s.iconUrl : undefined,
        homepage:      typeof s.homepage === 'string' ? s.homepage : undefined,
        // `verified` is a top-level boolean in the Smithery listing API response.
        // `bySmithery: true` means Smithery itself built and hosts this server.
        // When bySmithery is true, the server is definitionally verified.
        verified:      s.verified === true || s.bySmithery === true,
        bySmithery:    s.bySmithery === true,
        useCount:      typeof s.useCount === 'number' ? s.useCount : 0,
        createdAt:     s.createdAt ?? undefined,
        updatedAt:     s.updatedAt ?? undefined,
        repository:    typeof s.repository === 'string' ? s.repository : undefined,
      });
    }

    log.info(TAG, `Listing page ${page} — collected ${listingEntries.length} / ~${totalFromApi}`);
    if (items.length < PAGE_SIZE) break;
    page++;
    await new Promise(r => setTimeout(r, 300)); // polite delay between pages
  }

  log.info(TAG, 'Phase 1 complete', {
    deployed:          listingEntries.length,
    skippedNotDeployed,
    totalInRegistry:   totalFromApi,
  });

  // ── Phase 2: Detail fetch for ALL servers (concurrency 5) ───────────────
  log.info(TAG, `Phase 2: detail fetch for all ${listingEntries.length} servers (concurrency ${CONCURRENCY})`);

  let detailFetched = 0;
  let detailSuccess = 0;
  let rateLimitHits = 0;

  const detailResults = await runWithConcurrency(
    listingEntries,
    CONCURRENCY,
    async (entry, idx) => {
      const { detail, rateLimitHits: rlHits } = await fetchDetail(entry.qualifiedName, apiKey);
      detailFetched++;
      if (detail) detailSuccess++;
      rateLimitHits += rlHits; // C4/L1 fix: accumulate from per-server return value

      if ((idx + 1) % 100 === 0) {
        log.info(TAG, `Detail progress: ${idx + 1}/${listingEntries.length}`, {
          success: detailSuccess,
          failed: detailFetched - detailSuccess,
          rateLimitHits,
        });
      }

      return detail;
    }
  );

  // ── Assemble final IngestServer[] ───────────────────────────────────────
  const servers: IngestServer[] = [];

  for (const { item: listing, result: detail } of detailResults) {
    const name = slugify(listing.qualifiedName);
    if (!name) continue;

    const endpoint   = detail?.endpoint  ?? null;
    const transport  = detail?.transport ?? 'unknown';
    const tools      = detail?.tool_schemas ?? [];

    servers.push({
      name,
      display_name:  listing.displayName,
      description:   listing.description,
      transport,
      endpoint,
      version:       null, // Smithery does not version servers
      icon_url:      listing.iconUrl ?? null,
      github_url:    listing.repository ?? null,
      homepage_url:  listing.homepage ?? null,
      license:       null,
      tags:          [],
      tools:         tools.map(t => t.name),
      tool_schemas:  tools,
      tool_extraction_source: tools.length > 0 ? 'smithery_detail' : 'none',
      resources:     detail?.resources ?? [],
      prompts:       detail?.prompts   ?? [],
      env_var_schema: detail?.env_var_schema ?? null,
      source:        'smithery',
      source_id:     listing.qualifiedName,
      smithery_id:   listing.qualifiedName,
      verified:      listing.verified,
      by_smithery:   listing.bySmithery,
      use_count:     listing.useCount,
      upstream_updated_at: listing.updatedAt ?? listing.createdAt ?? null,
      raw_upstream_json: listing as unknown as Record<string, unknown>,
    });
  }

  log.info(TAG, 'Phase 2 complete', {
    total:          servers.length,
    withTools:      servers.filter(s => s.tool_schemas.length > 0).length,
    withEndpoint:   servers.filter(s => s.endpoint).length,
    detailSuccess,
    detailFailed:   detailFetched - detailSuccess,
    rateLimitHits,
  });

  return servers;
}
