/**
 * mcp.directory Registry Fetcher
 *
 * Source: mcp.directory/api/v1/servers
 * Tier:   ENRICHMENT ONLY — does NOT provide server endpoint URLs
 *
 * API: GET /api/v1/servers?limit=100&offset=0 (offset-paginated)
 * Total servers: 2,002 (confirmed from total field in live API response)
 *
 * What this source contributes:
 *   publisher.verified      → verified (trust signal)
 *   publisher.avatarUrl     → icon_url (fallback when Official/Smithery don't have one)
 *   transportType[]         → transport hint (pre-confirms before probing)
 *   toolCount               → stored in raw_upstream_json (not on IngestServer directly)
 *   githubStars + npmWeeklyDownloads → analytics table only (Grade F)
 *
 * The enrichment pass in pipeline.ts uses publisher.name + slug
 * to match against existing records by github_url or display_name.
 */

import type { IngestServer, Transport } from './types';
import { slugify } from './helpers';
import { log } from '@/lib/logger';

const TAG = 'ingest:mcp_directory';
const API_BASE = 'https://mcp.directory/api/v1/servers';
const PAGE_SIZE = 100;

// ── Transport from transportType[] ───────────────────────────────────────────

function resolveTransportFromTypes(types: string[]): Transport {
  const normalized = types.map(t => t.toLowerCase());
  // Prefer remote transports
  if (normalized.includes('streamable-http') || normalized.includes('streamable_http')) {
    return 'streamable_http';
  }
  if (normalized.includes('sse')) return 'sse';
  if (normalized.includes('stdio') && normalized.length === 1) return 'stdio';
  // If both stdio and remote → streamable_http (can be cloud-accessed)
  if (normalized.includes('stdio') && normalized.length > 1) return 'streamable_http';
  return 'unknown';
}

// ── Main fetcher ──────────────────────────────────────────────────────────────

export async function fetchMcpDirectoryServers(): Promise<IngestServer[]> {
  const servers: IngestServer[] = [];
  let offset = 0;
  let total: number | null = null;
  let pageNum = 0;

  while (true) {
    pageNum++;
    let data: any;

    try {
      const res = await fetch(`${API_BASE}?limit=${PAGE_SIZE}&offset=${offset}`, {
        headers: { 'User-Agent': 'relay-ingest/2.0', 'Accept': 'application/json' },
        signal: AbortSignal.timeout(15_000),
      });

      if (res.status === 429) {
        log.warn(TAG, `Page ${pageNum} rate limited — waiting 5s`);
        await new Promise(r => setTimeout(r, 5_000));
        continue;
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

    if (total === null && typeof data.total === 'number') {
      total = data.total;
      log.info(TAG, `Total servers reported by API: ${total}`);
    }

    for (const s of items) {
      const name = slugify(s.name ?? s.slug ?? s.id ?? '');
      if (!name) continue;

      const transportTypes: string[] = Array.isArray(s.transportType) ? s.transportType : [];
      const transport = resolveTransportFromTypes(transportTypes);

      // icon_url: prefer publisher.avatarUrl (GitHub org avatar — reliable fallback)
      const iconUrl = typeof s.publisher?.avatarUrl === 'string' ? s.publisher.avatarUrl : null;

      servers.push({
        name,
        display_name:  s.name ?? name,
        description:   typeof s.shortDescription === 'string' ? s.shortDescription : '',
        transport,
        // ENRICHMENT SOURCE: never provides endpoint URLs
        endpoint:      null,
        version:       null,
        icon_url:      iconUrl,
        github_url:    null, // mcp.directory doesn't provide repository URL directly
        homepage_url:  null,
        license:       null,
        tags:          typeof s.classification === 'string' ? [s.classification] : [],
        tools:         [],
        tool_schemas:  [],
        tool_extraction_source: 'none',
        source:        'mcp_directory',
        source_id:     String(s.id ?? ''),
        mcp_directory_id: String(s.id ?? ''),
        verified:      s.publisher?.verified === true,
        upstream_updated_at: null,
        // Store raw for analytics signals (toolCount, githubStars, npmWeeklyDownloads)
        // These are Grade-F fields — handled by the analytics pipeline, not IngestServer
        raw_upstream_json: s,
      });
    }

    log.info(TAG, `Page ${pageNum} processed`, {
      offset,
      itemsOnPage:  items.length,
      totalSoFar:   servers.length,
      totalFromApi: total,
    });

    offset += PAGE_SIZE;
    if (items.length < PAGE_SIZE) break;

    await new Promise(r => setTimeout(r, 300));
  }

  log.info(TAG, 'Fetch complete', { total: servers.length });
  return servers;
}
