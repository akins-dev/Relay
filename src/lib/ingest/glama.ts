/**
 * Glama MCP Registry Fetcher
 *
 * Source: glama.ai/api/mcp/v1/servers
 * Tier:   ENRICHMENT ONLY — does NOT provide server endpoint URLs
 *
 * Verified by live API (2026-05-02): the `url` field on every Glama server entry
 * is always "https://glama.ai/mcp/servers/{id}" — Glama's own listing page.
 * There is no remoteUrl, endpoint, or serverUrl field in either the listing
 * or detail API responses. Glama is NOT a source for invocation endpoints.
 *
 * What Glama DOES provide (unique value):
 *   repository.url          → github_url (cross-reference key for enrichment matching)
 *   environmentVariablesJsonSchema → env_var_schema (richest source of env var data)
 *   spdxLicense.name        → license (SPDX — only registry that provides this)
 *   attributes[]            → tags (hosting:remote-capable → remote-capable, etc.)
 *   hosting:hybrid          → both stdio AND remote-capable
 *
 * Tools are always [] in the API. Glama fetches them live via in-browser MCP Inspector.
 * Do NOT set tool_extraction_source to anything other than 'none'.
 *
 * Transport resolution from attributes[] (verified by live API):
 *   'hosting:local-only'     → stdio
 *   'hosting:remote-capable' → streamable_http (probe to confirm)
 *   'hosting:hybrid'         → has both stdio and remote modes
 *   (none of the above)      → unknown
 */

import type { IngestServer, Transport, EnvVarSpec } from './types';
import { slugify } from './helpers';
import { log } from '@/lib/logger';

const TAG = 'ingest:glama';

// ── Transport from attributes[] ───────────────────────────────────────────────

function resolveGlamaTransport(attrs: string[]): Transport {
  const hasRemote = attrs.some(a => a === 'hosting:remote-capable' || a === 'hosting:hybrid');
  const hasLocal  = attrs.some(a => a === 'hosting:local-only');

  if (hasRemote) return 'streamable_http'; // dominant — can be cloud-indexed
  if (hasLocal)  return 'stdio';
  return 'unknown';
}

// ── EnvVarSpec from environmentVariablesJsonSchema ────────────────────────────

/**
 * Normalize Glama's environmentVariablesJsonSchema (JSON Schema format) → EnvVarSpec[].
 * This is the richest, most consistently structured env var source in the ecosystem.
 *
 * Schema shape (verified from live API):
 *   { type: 'object', properties: { NAME: { type, description, default } }, required: ['NAME'] }
 */
function normalizeEnvVarsFromJsonSchema(schema: any): EnvVarSpec[] | null {
  if (!schema || typeof schema !== 'object') return null;
  const props: Record<string, any> = schema.properties ?? {};
  const required: string[] = Array.isArray(schema.required) ? schema.required : [];

  const specs: EnvVarSpec[] = [];
  for (const [name, def] of Object.entries<any>(props)) {
    if (!name) continue;

    const isExplicitlySecret = def.isSecret === true;
    const nameImpliesSecret  = (
      name.toLowerCase().includes('key') ||
      name.toLowerCase().includes('token') ||
      name.toLowerCase().includes('secret') ||
      name.toLowerCase().includes('password')
    );
    // H3 fix: mirror the Smithery fix — name-based heuristic only fires when the variable
    // is required AND has no default. Optional credential fields (e.g. an optional apiKey)
    // should not force api_key auth type and block users from trying the server.
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
      choices:      Array.isArray(def.enum) ? def.enum.map(String) : undefined,
    });
  }

  return specs.length > 0 ? specs : null;
}

// ── Tag normalization ─────────────────────────────────────────────────────────

/**
 * Strip Glama attribute prefixes to produce clean tags.
 * 'hosting:remote-capable' → 'remote-capable'
 * 'author:official'        → 'official'
 */
function normalizeGlamaTags(attrs: string[]): string[] {
  return attrs.map(a => {
    const colonIdx = a.indexOf(':');
    return colonIdx >= 0 ? a.slice(colonIdx + 1) : a;
  }).filter(Boolean);
}

// ── Main fetcher ──────────────────────────────────────────────────────────────

export async function fetchGlamaServers(): Promise<IngestServer[]> {
  const servers: IngestServer[] = [];
  let cursor: string | null = null;
  const pageSize = 100;
  let pageNum = 0;

  while (true) {
    pageNum++;
    let data: any;

    try {
      const url = cursor
        ? `https://glama.ai/api/mcp/v1/servers?first=${pageSize}&after=${encodeURIComponent(cursor)}`
        : `https://glama.ai/api/mcp/v1/servers?first=${pageSize}`;

      const res = await fetch(url, {
        headers: { 'User-Agent': 'relay-ingest/2.0', 'Accept': 'application/json' },
        signal: AbortSignal.timeout(15_000),
      });

      if (res.status === 429) {
        log.warn(TAG, `Page ${pageNum} rate limited — waiting 5s`);
        await new Promise(r => setTimeout(r, 5_000));
        continue; // retry same cursor
      }

      if (!res.ok) {
        log.warn(TAG, `Page ${pageNum} returned ${res.status} — stopping`);
        break;
      }

      data = await res.json();
    } catch (err) {
      log.error(TAG, `Page ${pageNum} fetch failed`, err);
      break;
    }

    const items: any[] = data.servers ?? [];
    if (items.length === 0) break;

    for (const s of items) {
      const name = slugify(s.name ?? s.slug ?? s.id ?? '');
      if (!name) continue;

      const attrs: string[]  = Array.isArray(s.attributes) ? s.attributes : [];
      const transport        = resolveGlamaTransport(attrs);
      const tags             = normalizeGlamaTags(attrs);
      const env_var_schema   = normalizeEnvVarsFromJsonSchema(s.environmentVariablesJsonSchema);

      servers.push({
        name,
        display_name:  s.name ?? name,
        description:   typeof s.description === 'string' ? s.description : '',
        transport,
        // ── CRITICAL: Glama does NOT provide server endpoint URLs ──────────
        // s.url is always "https://glama.ai/mcp/servers/{id}" — Glama's own page.
        // Never map s.url to endpoint or homepage_url.
        endpoint:      null,
        homepage_url:  null,
        // ── Cross-reference key — used by pipeline enrichment pass ─────────
        github_url:    typeof s.repository?.url === 'string' ? s.repository.url : null,
        version:       null, // Glama does not version servers
        icon_url:      null, // Glama does not provide icon URLs in their API
        license:       typeof s.spdxLicense?.name === 'string' ? s.spdxLicense.name : null,
        tags,
        tools:         [], // Always empty — Glama fetches tools live in-browser only
        tool_schemas:  [],
        tool_extraction_source: 'none',
        env_var_schema,
        source:        'glama',
        source_id:     s.id ?? null,
        glama_id:      s.id ?? null,
        verified:      undefined, // Glama has no verified flag — leave undefined, not false
        upstream_updated_at: s.updatedAt ?? null,
        raw_upstream_json: s,
      });
    }

    log.info(TAG, `Page ${pageNum} processed`, {
      itemsOnPage:  items.length,
      totalSoFar:   servers.length,
    });

    const hasNext = data.pageInfo?.hasNextPage ?? false;
    cursor = data.pageInfo?.endCursor ?? null;
    if (!hasNext || !cursor) break;

    await new Promise(r => setTimeout(r, 300));
  }

  log.info(TAG, 'Fetch complete', { total: servers.length });
  return servers;
}
