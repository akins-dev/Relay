/**
 * Smithery Registry Fetcher
 *
 * Source: https://registry.smithery.ai
 * API: GET /servers?q=&page={n}&pageSize={n} (Bearer token required)
 *
 * Response contract (from API inspection + docs):
 *   { servers: ServerEntry[], totalCount: number }
 *   ServerEntry: {
 *     qualifiedName: string,         // canonical ID: "owner/repo-name"
 *     displayName: string,
 *     description: string,
 *     homepage?: string,
 *     useCount?: number,
 *     createdAt: string,
 *     updatedAt?: string,
 *     repository?: string,           // GitHub URL
 *     owner?: { name: string },
 *     tools?: Array<{ name: string, description?: string }>,
 *     connections?: Array<{ type: 'stdio'|'sse'|'streamable-http', url?: string, configSchema?: object }>,
 *     deploymentUrl?: string,        // Smithery-hosted endpoint
 *     security?: { scanPassed: boolean },
 *     tags?: string[],
 *   }
 */

import type { IngestServer, Transport } from './types';
import { slugify } from './helpers';
import { log } from '@/lib/logger';

const TAG = 'ingest:smithery';

/**
 * Resolve transport and endpoint from Smithery's connections[] array.
 * Smithery connection types: 'stdio', 'sse', 'streamable-http'
 */
export function resolveSmitheryConnection(
  connections: any[] | undefined,
  deploymentUrl?: string | null
): { endpoint: string; transport: Transport } {
  const declared = Array.isArray(connections) ? connections : [];

  // Prefer remote transports (HTTP/SSE) over stdio
  for (const conn of declared) {
    const url = typeof conn?.url === 'string' ? conn.url.trim() : '';
    const type = typeof conn?.type === 'string' ? conn.type.toLowerCase() : '';

    if (type === 'streamable-http' || type.includes('http')) {
      if (url) return { endpoint: url, transport: 'streamable_http' };
    }
    if (type === 'sse' || type.includes('sse')) {
      if (url) return { endpoint: url, transport: 'sse' };
    }
  }

  // Smithery deployment URL (hosted instance)
  const hostedUrl = typeof deploymentUrl === 'string' ? deploymentUrl.trim() : '';
  if (hostedUrl) {
    return { endpoint: hostedUrl, transport: 'streamable_http' };
  }

  // Stdio fallback
  if (declared.some(c => {
    const type = typeof c?.type === 'string' ? c.type.toLowerCase() : '';
    return type === 'stdio';
  })) {
    return { endpoint: '', transport: 'stdio' };
  }

  return { endpoint: '', transport: 'unknown' };
}

export async function fetchSmitheryServers(): Promise<IngestServer[]> {
  const apiKey = process.env.SMITHERY_API_KEY;
  if (!apiKey) {
    log.warn(TAG, 'SMITHERY_API_KEY not set — skipping');
    return [];
  }

  const servers: IngestServer[] = [];
  let page = 1;
  const pageSize = 100;

  while (true) {
    let data: any;
    try {
      const res = await fetch(
        `https://registry.smithery.ai/servers?q=&page=${page}&pageSize=${pageSize}`,
        {
          headers: {
            Authorization: `Bearer ${apiKey}`,
            'User-Agent': 'relay-ingest/2.0',
            'Accept': 'application/json',
          },
          signal: AbortSignal.timeout(15_000),
        }
      );

      if (!res.ok) {
        log.warn(TAG, `Page ${page} returned ${res.status} — stopping`);
        break;
      }

      data = await res.json();
    } catch (err) {
      log.error(TAG, `Page ${page} fetch failed`, err);
      break;
    }

    const items: any[] = data.servers ?? [];
    if (items.length === 0) break;

    for (const s of items) {
      const rawName = s.qualifiedName ?? s.displayName ?? '';
      const name = slugify(rawName);
      if (!name) continue;

      const { endpoint, transport } = resolveSmitheryConnection(
        s.connections,
        s.deploymentUrl ?? s.url ?? null
      );

      servers.push({
        name,
        display_name: s.displayName ?? rawName,
        description:  typeof s.description === 'string' ? s.description : '',
        endpoint,
        version:      '1.0.0', // Smithery doesn't version servers
        github_url:   typeof s.repository === 'string' ? s.repository : null,
        homepage_url: typeof s.homepage === 'string' ? s.homepage : null,
        license:      null, // Smithery doesn't provide license info
        tags:         Array.isArray(s.tags) ? s.tags : [],
        tools:        Array.isArray(s.tools) ? s.tools.map((t: any) => t.name ?? t).filter(Boolean) : [],
        tool_schemas: [],
        source:       'smithery',
        source_id:    s.qualifiedName ?? null,
        smithery_id:  s.qualifiedName ?? null,
        verified:     s.security?.scanPassed ?? false,
        transport,
        upstream_updated_at: s.updatedAt ?? s.createdAt ?? null,
        raw_upstream_json:   s,
      });
    }

    log.info(TAG, `Page ${page} processed`, {
      itemsOnPage: items.length,
      totalSoFar: servers.length,
    });

    if (items.length < pageSize) break;
    page++;
    // Polite rate limiting
    await new Promise(r => setTimeout(r, 200));
  }

  log.info(TAG, 'Fetch complete', { total: servers.length });
  return servers;
}
