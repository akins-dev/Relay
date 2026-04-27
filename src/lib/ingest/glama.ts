/**
 * Glama MCP Registry Fetcher
 *
 * Source: https://glama.ai
 * API: GET /api/mcp/v1/servers?perPage={n}&after={cursor}
 *
 * Response contract (from API inspection):
 *   { servers: ServerEntry[], pageInfo: { hasNextPage, endCursor } }
 *   ServerEntry: {
 *     id: string,
 *     name: string,
 *     slug?: string,
 *     description: string,
 *     url?: string,                    // server endpoint URL
 *     repository?: { url: string },
 *     attributes?: string[],           // e.g. ['local-only', 'remote']
 *     tools?: Array<{ name: string }>,
 *     spdxLicense?: { name: string },
 *     updatedAt?: string,
 *   }
 */

import type { IngestServer, Transport } from './types';
import { slugify } from './helpers';
import { log } from '@/lib/logger';

const TAG = 'ingest:glama';

function resolveGlamaTransport(attrs: string[], url?: string): Transport {
  if (attrs.some(a => a.includes('local-only'))) return 'stdio';
  if (attrs.some(a => a.includes('remote'))) {
    if (url && (url.includes('/sse') || url.includes('/events'))) return 'sse';
    return 'streamable_http';
  }
  if (url) {
    if (url.includes('/sse') || url.includes('/events')) return 'sse';
    if (url.startsWith('https://') || url.startsWith('http://')) return 'streamable_http';
  }
  return 'unknown';
}

export async function fetchGlamaServers(): Promise<IngestServer[]> {
  const servers: IngestServer[] = [];
  let cursor: string | null = null;
  const perPage = 100;
  let pageNum = 0;

  while (true) {
    pageNum++;
    let data: any;

    try {
      const url = cursor
        ? `https://glama.ai/api/mcp/v1/servers?perPage=${perPage}&after=${cursor}`
        : `https://glama.ai/api/mcp/v1/servers?perPage=${perPage}`;

      const res = await fetch(url, {
        headers: { 'User-Agent': 'relay-ingest/2.0', 'Accept': 'application/json' },
        signal: AbortSignal.timeout(15_000),
      });

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

      const attrs: string[] = Array.isArray(s.attributes) ? s.attributes : [];
      const serverUrl = typeof s.url === 'string' ? s.url : '';
      const transport = resolveGlamaTransport(attrs, serverUrl);
      const endpoint = transport === 'stdio' ? '' : serverUrl;

      servers.push({
        name,
        display_name: s.name ?? name,
        description:  typeof s.description === 'string' ? s.description : '',
        endpoint,
        version:      '1.0.0', // Glama doesn't version servers
        github_url:   typeof s.repository?.url === 'string' ? s.repository.url : null,
        homepage_url: serverUrl || null,
        license:      typeof s.spdxLicense?.name === 'string' ? s.spdxLicense.name : null,
        tags:         attrs,
        tools:        Array.isArray(s.tools) ? s.tools.map((t: any) => t.name ?? t).filter(Boolean) : [],
        tool_schemas: [],
        source:       'glama',
        source_id:    s.id ?? null,
        glama_id:     s.id ?? null,
        verified:     false, // Glama doesn't have a verified flag in their API
        transport,
        upstream_updated_at: s.updatedAt ?? null,
        raw_upstream_json:   s,
      });
    }

    log.info(TAG, `Page ${pageNum} processed`, {
      itemsOnPage: items.length,
      totalSoFar: servers.length,
    });

    // Cursor pagination
    const hasNext = data.pageInfo?.hasNextPage ?? false;
    cursor = data.pageInfo?.endCursor ?? null;
    if (!hasNext || !cursor) break;

    // Polite rate limiting
    await new Promise(r => setTimeout(r, 300));
  }

  log.info(TAG, 'Fetch complete', { total: servers.length });
  return servers;
}
