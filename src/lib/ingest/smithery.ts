/**
 * Smithery Registry Fetcher — v3 (Rate-Limit Hardened)
 *
 * Source: registry.smithery.ai
 * Tier:   PRIMARY — provides live endpoints + pre-stored tool schemas
 *
 * Two-phase strategy:
 *   Phase 1 — Listing sweep:
 *     GET https://registry.smithery.ai/servers?q=&page=N&pageSize=100
 *     Collects qualifiedName, displayName, description, iconUrl, homepage,
 *     verified, bySmithery, useCount, createdAt
 *     — NO tools, NO endpoint (confirmed: `fields` param is whitelist-only).
 *
 *   Phase 2 — Detail fetch (priority-filtered, adaptive rate limit):
 *     GET https://registry.smithery.ai/servers/{qualifiedName}
 *     Returns: deploymentUrl, connections[].configSchema, tools[] with inputSchema,
 *              resources[], prompts[]
 *
 * Rate-limit strategy:
 *   - AdaptiveTokenBucket self-tunes to Smithery's undocumented rate limit
 *   - Starts conservative (2 req/s), backs off on 429, speeds up on success
 *   - Global pause on 429 (respects Retry-After header)
 *   - Priority queue: new servers first, stale servers next, fresh servers skipped
 *
 * Probe findings (May 2026):
 *   - `fields` param is whitelist-only (cannot inject detail fields into listing)
 *   - `registry.smithery.ai` and `api.smithery.ai` are identical backends
 *   - Listing response does NOT include `repository` or `updatedAt` fields
 *   - Detail endpoint returns full tools/connections/resources/prompts
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
const BASE_URL      = 'https://registry.smithery.ai/servers';
const CONCURRENCY   = 3;
const PAGE_SIZE     = 100;

// ── Adaptive Token Bucket ─────────────────────────────────────────────────────
// Self-tuning rate limiter that learns Smithery's actual (undocumented) limit.
// Starts conservative, backs off aggressively on 429, ramps up on success.

class AdaptiveTokenBucket {
  private tokens: number;
  private maxTokens: number;
  private refillRate: number; // tokens per second
  private lastRefill: number;
  private consecutiveSuccess = 0;

  constructor(maxTokens = 15, refillRate = 1.5) {
    this.maxTokens = maxTokens;
    this.tokens = maxTokens;
    this.refillRate = refillRate;
    this.lastRefill = Date.now();
  }

  /** Wait until a token is available, then consume it. */
  async acquire(): Promise<void> {
    this.refill();
    while (this.tokens < 1) {
      const waitMs = Math.ceil((1 - this.tokens) / this.refillRate * 1000) + 50;
      await new Promise(r => setTimeout(r, waitMs));
      this.refill();
    }
    this.tokens--;
  }

  private refill() {
    const now = Date.now();
    const elapsed = (now - this.lastRefill) / 1000;
    this.tokens = Math.min(this.maxTokens, this.tokens + elapsed * this.refillRate);
    this.lastRefill = now;
  }

  /** Call on successful request. After sustained success, slowly increases rate. */
  onSuccess() {
    this.consecutiveSuccess++;
    if (this.consecutiveSuccess >= 50) {
      this.maxTokens = Math.min(25, Math.ceil(this.maxTokens * 1.1));
      this.refillRate = Math.min(2.5, this.refillRate * 1.05);
      this.consecutiveSuccess = 0;
      log.info(TAG, `Token bucket adapted UP: maxTokens=${this.maxTokens}, refillRate=${this.refillRate.toFixed(2)}/s`);
    }
  }

  /** Call on 429. Drains bucket, halves capacity, waits for Retry-After. */
  async on429(retryAfterMs?: number) {
    this.consecutiveSuccess = 0;
    this.tokens = 0;
    this.maxTokens = Math.max(5, Math.floor(this.maxTokens * 0.5));
    this.refillRate = Math.max(0.5, this.refillRate * 0.7);
    const waitMs = retryAfterMs ?? 60_000;
    log.warn(TAG, `Token bucket adapted DOWN: maxTokens=${this.maxTokens}, refillRate=${this.refillRate.toFixed(2)}/s, pausing ${(waitMs / 1000).toFixed(0)}s`);
    await new Promise(r => setTimeout(r, waitMs));
  }

  stats() {
    return { maxTokens: this.maxTokens, refillRate: this.refillRate.toFixed(2), tokens: this.tokens.toFixed(1) };
  }
}

// ── Transport helpers ─────────────────────────────────────────────────────────

export function resolveSmitheryTransport(
  connections: any[] | undefined,
  deploymentUrl?: string | null
): { endpoint: string | null; transport: Transport } {
  const declared = Array.isArray(connections) ? connections : [];

  for (const conn of declared) {
    const url  = typeof conn?.url === 'string' ? conn.url.trim() : null;
    const depUrl = typeof conn?.deploymentUrl === 'string' ? conn.deploymentUrl.trim() : null;
    const type = typeof conn?.type === 'string' ? conn.type.toLowerCase() : '';
    if (type === 'streamable-http' || type === 'http') {
      return { endpoint: depUrl || url, transport: 'streamable_http' };
    }
    if (type === 'sse') {
      return { endpoint: depUrl || url, transport: 'sse' };
    }
  }

  const hosted = typeof deploymentUrl === 'string' ? deploymentUrl.trim() : null;
  if (hosted) return { endpoint: hosted, transport: 'streamable_http' };

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

// ── Detail fetch (single request, no internal retry — bucket handles pacing) ─

interface SmitheryDetail {
  endpoint:       string | null;
  transport:      Transport;
  tool_schemas:   ToolSchema[];
  resources:      McpResource[];
  prompts:        McpPrompt[];
  env_var_schema: EnvVarSpec[] | null;
}

interface FetchDetailResult {
  detail:      SmitheryDetail | null;
  is429:       boolean;
  retryAfter?: number;
}

async function fetchDetail(qualifiedName: string, apiKey: string): Promise<FetchDetailResult> {
  const url = `${BASE_URL}/${encodeURIComponent(qualifiedName)}`;

  let res: Response | undefined;

  // Retry up to 3 times for transient network errors (DNS, TLS, ECONNRESET)
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      res = await fetch(url, {
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'User-Agent':  'relay-ingest/3.0',
          'Accept':      'application/json',
        },
        signal: AbortSignal.timeout(12_000),
      });
      break; // Success — exit retry loop
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      if (attempt < 3) {
        const backoffMs = 1_000 * Math.pow(2, attempt - 1); // 1s, 2s, 4s
        log.warn(TAG, `Detail ${qualifiedName} network error (attempt ${attempt}/3): ${errMsg} — retrying in ${backoffMs / 1000}s`);
        await new Promise(r => setTimeout(r, backoffMs));
      } else {
        log.warn(TAG, `Detail ${qualifiedName} failed after 3 attempts: ${errMsg}`);
        return { detail: null, is429: false };
      }
    }
  }

  if (!res) return { detail: null, is429: false };

  if (res.status === 429) {
    const retryAfter = res.headers.get('Retry-After');
    return { detail: null, is429: true, retryAfter: retryAfter ? parseInt(retryAfter, 10) * 1000 : undefined };
  }

  if (res.status === 404) return { detail: null, is429: false };
  if (!res.ok) {
    log.warn(TAG, `Detail ${qualifiedName} returned ${res.status}`);
    return { detail: null, is429: false };
  }

  let data: any;
  try { data = await res.json(); }
  catch { return { detail: null, is429: false }; }

  const connections: any[] = Array.isArray(data.connections) ? data.connections : [];
  const { endpoint, transport } = resolveSmitheryTransport(connections, data.deploymentUrl);

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

  return { detail: { endpoint, transport, tool_schemas, resources, prompts, env_var_schema }, is429: false };
}

// ── Queue-based concurrent detail fetcher with adaptive rate limiting ─────────

interface QueueItem {
  qualifiedName: string;
  priority: number; // lower = higher priority
}

async function fetchDetailsWithBucket(
  items: QueueItem[],
  concurrency: number,
  bucket: AdaptiveTokenBucket,
  apiKey: string,
  onProgress: (fetched: number, total: number, rl: number) => void,
): Promise<{ detailMap: Map<string, SmitheryDetail>; rateLimitHits: number; fetched: number; success: number }> {
  // Sort by priority (lower number = fetch first)
  const queue = [...items].sort((a, b) => a.priority - b.priority);
  const detailMap = new Map<string, SmitheryDetail>();
  let fetched = 0;
  let success = 0;
  let rateLimitHits = 0;

  // Global pause promise — shared across all workers
  let globalPause: Promise<void> | null = null;

  async function worker() {
    while (true) {
      // Check for global pause first
      if (globalPause) await globalPause;

      // Atomic dequeue (Array.shift is synchronous in single-threaded JS)
      const item = queue.shift();
      if (!item) break;

      // Wait for token from bucket
      await bucket.acquire();

      const result = await fetchDetail(item.qualifiedName, apiKey);

      if (result.is429) {
        rateLimitHits++;
        // Push item back to front of queue for retry
        queue.unshift(item);

        // Set global pause if not already set
        if (!globalPause) {
          globalPause = bucket.on429(result.retryAfter).then(() => { globalPause = null; });
        }
        await globalPause;
        continue;
      }

      fetched++;
      if (result.detail) {
        success++;
        detailMap.set(item.qualifiedName, result.detail);
      }
      bucket.onSuccess();

      if (fetched % 50 === 0) {
        onProgress(fetched, items.length, rateLimitHits);
      }
    }
  }

  await Promise.all(Array.from({ length: concurrency }, () => worker()));
  return { detailMap, rateLimitHits, fetched, success };
}

// ── Main fetcher ──────────────────────────────────────────────────────────────

export async function fetchSmitheryServers(svc?: any): Promise<IngestServer[]> {
  const apiKey = process.env.SMITHERY_API_KEY;
  if (!apiKey) {
    log.warn(TAG, 'SMITHERY_API_KEY not set — skipping');
    return [];
  }

  // ── Phase 1: Listing sweep ──────────────────────────────────────────────────
  log.info(TAG, 'Phase 1: listing sweep starting');

  type ListingEntry = {
    qualifiedName:  string;
    displayName:    string;
    description:    string;
    iconUrl?:       string;
    homepage?:      string;
    verified:       boolean;
    bySmithery:     boolean;
    useCount:       number;
    createdAt?:     string;
  };

  const listingEntries: ListingEntry[] = [];
  const seed = Date.now();
  let page = 1;
  let totalFromApi = 0;

  while (true) {
    let data: any;
    let fetchSuccess = false;

    // Retry loop for transient network errors (DNS, TLS, ECONNRESET)
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        const res = await fetch(
          `${BASE_URL}?q=&page=${page}&pageSize=${PAGE_SIZE}&seed=${seed}&isDeployed=true`,
          {
            headers: {
              Authorization: `Bearer ${apiKey}`,
              'User-Agent': 'relay-ingest/3.0',
              'Accept': 'application/json',
            },
            signal: AbortSignal.timeout(15_000),
          }
        );

        if (res.status === 429) {
          log.warn(TAG, `Listing page ${page} rate limited — waiting 5s`);
          await new Promise(r => setTimeout(r, 5_000));
          // Break inner retry loop, outer while(true) will retry same page
          fetchSuccess = false;
          break;
        }

        if (!res.ok) {
          log.warn(TAG, `Listing page ${page} returned ${res.status} — stopping`);
          fetchSuccess = false;
          break;
        }

        data = await res.json();
        fetchSuccess = true;
        break; // Success — exit retry loop
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err);
        log.warn(TAG, `Listing page ${page} network error (attempt ${attempt}/3): ${errMsg}`);
        if (attempt < 3) {
          const backoffMs = 2_000 * Math.pow(2, attempt - 1); // 2s, 4s, 8s
          log.info(TAG, `Retrying in ${backoffMs / 1000}s...`);
          await new Promise(r => setTimeout(r, backoffMs));
        } else {
          log.error(TAG, `Listing page ${page} failed after 3 attempts — stopping`, err);
        }
      }
    }

    if (!fetchSuccess || !data) {
      // If it was a 429, the outer loop will handle re-entry for the same page
      // For all other failures, break the outer pagination loop
      if (!data) break;
      continue; // 429 case — retry same page
    }

    const items: any[] = data.servers ?? [];
    if (items.length === 0) break;

    totalFromApi = data.pagination?.totalCount ?? totalFromApi;

    for (const s of items) {
      const qn = typeof s.qualifiedName === 'string' ? s.qualifiedName : '';
      if (!qn) continue;

      if (s.isDeployed === false) continue;

      listingEntries.push({
        qualifiedName: qn,
        displayName:   s.displayName ?? qn,
        description:   typeof s.description === 'string' ? s.description : '',
        iconUrl:       typeof s.iconUrl === 'string' ? s.iconUrl : undefined,
        homepage:      typeof s.homepage === 'string' ? s.homepage : undefined,
        verified:      s.verified === true || s.bySmithery === true,
        bySmithery:    s.bySmithery === true,
        useCount:      typeof s.useCount === 'number' ? s.useCount : 0,
        createdAt:     s.createdAt ?? undefined,
        // NOTE: `repository` and `updatedAt` do NOT exist in the Smithery listing API
        // response (confirmed via API probe May 2026). Do not reference them.
      });
    }

    log.info(TAG, `Listing page ${page} — collected ${listingEntries.length} / ~${totalFromApi}`);
    if (items.length < PAGE_SIZE) break;
    page++;
    await new Promise(r => setTimeout(r, 300));
  }

  log.info(TAG, 'Phase 1 complete', { deployed: listingEntries.length, totalInRegistry: totalFromApi });

  // ── Phase 2: Priority-filtered detail fetch ─────────────────────────────────
  // Priority tiers (lower = fetched first):
  //   P0: New server — not in DB at all
  //   P1: Incomplete — in DB but has 0 tools (prior fetch may have failed)
  //   P2: Stale — in DB but last_scanned_at > 7 days ago
  //   SKIP: Fresh — in DB, has tools, scanned within 7 days

  const STALE_DAYS = 7;
  let itemsToFetch: QueueItem[] = [];

  if (svc) {
    try {
      log.info(TAG, 'Pre-filtering Phase 2 with priority queue...');
      const { data: existing } = await svc
        .from('servers')
        .select('smithery_id, last_scanned_at, tools')
        .eq('source', 'smithery');

      if (existing && existing.length > 0) {
        const existingMap = new Map<string, { scannedMs: number; toolCount: number }>();
        for (const row of existing) {
          if (row.smithery_id) {
            existingMap.set(row.smithery_id, {
              scannedMs: row.last_scanned_at ? new Date(row.last_scanned_at).getTime() : 0,
              toolCount: Array.isArray(row.tools) ? row.tools.length : 0,
            });
          }
        }

        const now = Date.now();
        const staleCutoff = now - STALE_DAYS * 86_400_000;
        let skipCount = 0;

        for (const entry of listingEntries) {
          const db = existingMap.get(entry.qualifiedName);

          if (!db) {
            // P0: Not in DB — must fetch
            itemsToFetch.push({ qualifiedName: entry.qualifiedName, priority: 0 });
          } else if (db.toolCount === 0) {
            // P1: In DB but no tools — prior fetch probably failed
            itemsToFetch.push({ qualifiedName: entry.qualifiedName, priority: 1 });
          } else if (db.scannedMs < staleCutoff) {
            // P2: Stale — hasn't been refreshed in >7 days
            itemsToFetch.push({ qualifiedName: entry.qualifiedName, priority: 2 });
          } else {
            // SKIP: Fresh and complete
            skipCount++;
          }
        }

        const p0 = itemsToFetch.filter(i => i.priority === 0).length;
        const p1 = itemsToFetch.filter(i => i.priority === 1).length;
        const p2 = itemsToFetch.filter(i => i.priority === 2).length;
        log.info(TAG, `Pre-filter: ${listingEntries.length} total → ${itemsToFetch.length} need fetch, ${skipCount} skipped`, {
          new_P0: p0, incomplete_P1: p1, stale_P2: p2, fresh_skip: skipCount,
        });
      } else {
        // Empty DB — fetch everything
        itemsToFetch = listingEntries.map(e => ({ qualifiedName: e.qualifiedName, priority: 0 }));
      }
    } catch (err) {
      log.warn(TAG, `Pre-filter failed, fetching all ${listingEntries.length}`, err);
      itemsToFetch = listingEntries.map(e => ({ qualifiedName: e.qualifiedName, priority: 0 }));
    }
  } else {
    itemsToFetch = listingEntries.map(e => ({ qualifiedName: e.qualifiedName, priority: 0 }));
  }

  log.info(TAG, `Phase 2: detail fetch for ${itemsToFetch.length} servers (concurrency ${CONCURRENCY})`);

  const bucket = new AdaptiveTokenBucket();
  const { detailMap, rateLimitHits, fetched: detailFetched, success: detailSuccess } = await fetchDetailsWithBucket(
    itemsToFetch,
    CONCURRENCY,
    bucket,
    apiKey,
    (fetched, total, rl) => {
      log.info(TAG, `Detail progress: ${fetched}/${total}`, {
        rateLimitHits: rl, bucket: bucket.stats(),
      });
    },
  );

  // ── Assemble final IngestServer[] ───────────────────────────────────────
  const servers: IngestServer[] = [];

  for (const listing of listingEntries) {
    const name = slugify(listing.qualifiedName);
    if (!name) continue;

    const detail     = detailMap.get(listing.qualifiedName) || null;
    const endpoint   = detail?.endpoint  ?? null;
    const transport  = detail?.transport ?? 'unknown';
    const tools      = detail?.tool_schemas ?? [];

    servers.push({
      name,
      display_name:  listing.displayName,
      description:   listing.description,
      transport,
      endpoint,
      version:       null,
      icon_url:      listing.iconUrl ?? null,
      github_url:    null, // Smithery listing does NOT include repository URL
      homepage_url:  listing.homepage ?? null,
      license:       null,
      tags:          [],
      tools:         tools.map((t: any) => t.name),
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
      upstream_updated_at: listing.createdAt ?? null,
      raw_upstream_json: listing as unknown as Record<string, unknown>,
    });
  }

  log.info(TAG, 'Phase 2 complete', {
    total:          servers.length,
    withTools:      servers.filter(s => s.tool_schemas.length > 0).length,
    withEndpoint:   servers.filter(s => s.endpoint).length,
    detailFetched,
    detailSuccess,
    detailSkipped:  listingEntries.length - itemsToFetch.length,
    rateLimitHits,
    bucketFinal:    bucket.stats(),
  });

  return servers;
}
