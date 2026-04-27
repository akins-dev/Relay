/**
 * Official MCP Registry Fetcher
 *
 * Source of truth: OpenAPI spec at
 *   https://raw.githubusercontent.com/modelcontextprotocol/registry/main/docs/reference/api/openapi.yaml
 *
 * Endpoint: GET /v0.1/servers (falls back to /v0/servers)
 *
 * Response contract (from OpenAPI):
 *   ServerList → { servers: ServerResponse[], metadata: { nextCursor, count } }
 *   ServerResponse → { server: ServerDetail, _meta: { "io.modelcontextprotocol.registry/official": {...} } }
 *
 * ServerDetail fields we map:
 *   - name (required, reverse-DNS: "io.github.user/weather")
 *   - description (required, max 100 chars)
 *   - version (required, semver)
 *   - title (optional, human-readable display name)
 *   - websiteUrl (optional, homepage)
 *   - repository { url, source, id?, subfolder? }
 *   - icons[] { src, mimeType?, sizes?, theme? }
 *   - remotes[] (RemoteTransport: streamable-http or sse, with url, headers[], variables{})
 *   - packages[] (Package: registryType, identifier, version, runtimeHint, transport, envVars, etc.)
 *   - _meta["io.modelcontextprotocol.registry/publisher-provided"] (arbitrary JSON)
 *   - _meta["io.modelcontextprotocol.registry/official"] { status, statusMessage, publishedAt, updatedAt, statusChangedAt, isLatest }
 */

import type { IngestServer, Transport } from './types';
import { slugify } from './helpers';
import { log } from '@/lib/logger';

const TAG = 'ingest:official';

/** Endpoints to try, in order. The spec formalizes v0.1; production also serves v0. */
const API_BASES = [
  'https://registry.modelcontextprotocol.io/v0.1/servers',
  'https://registry.modelcontextprotocol.io/v0/servers',
];

/**
 * Determine transport from a remote entry (official schema: RemoteTransport).
 * Remote transport types are exactly 'streamable-http' or 'sse' per OpenAPI spec.
 */
function resolveRemoteTransport(remote: any): Transport {
  const type = typeof remote?.type === 'string' ? remote.type.toLowerCase() : '';
  if (type === 'streamable-http') return 'streamable_http';
  if (type === 'sse') return 'sse';
  return 'unknown';
}

/**
 * Determine transport from a package entry (official schema: Package.transport).
 * Local transport can be 'stdio', 'streamable-http', or 'sse'.
 */
function resolvePackageTransport(pkg: any): Transport {
  const type = typeof pkg?.transport?.type === 'string' ? pkg.transport.type.toLowerCase() : '';
  if (type === 'stdio') return 'stdio';
  if (type === 'streamable-http') return 'streamable_http';
  if (type === 'sse') return 'sse';
  return 'unknown';
}

/**
 * Determine the best transport and endpoint from remotes[] and packages[].
 * Priority: remotes (remote HTTP) > packages with HTTP transport > packages with stdio.
 */
function resolveConnectionInfo(remotes: any[], packages: any[]): { endpoint: string; transport: Transport } {
  // Try remotes first — these are always remote HTTP
  for (const remote of remotes) {
    const url = typeof remote?.url === 'string' ? remote.url.trim() : '';
    const transport = resolveRemoteTransport(remote);
    if (url && (transport === 'streamable_http' || transport === 'sse')) {
      return { endpoint: url, transport };
    }
  }

  // Try packages with HTTP transport
  for (const pkg of packages) {
    const transport = resolvePackageTransport(pkg);
    if (transport === 'streamable_http' || transport === 'sse') {
      const url = typeof pkg?.transport?.url === 'string' ? pkg.transport.url.trim() : '';
      return { endpoint: url, transport };
    }
  }

  // Packages with stdio
  if (packages.some(p => resolvePackageTransport(p) === 'stdio')) {
    return { endpoint: '', transport: 'stdio' };
  }

  return { endpoint: '', transport: 'unknown' };
}

export async function fetchOfficialServers(): Promise<IngestServer[]> {
  const servers: IngestServer[] = [];
  let apiBase: string | null = null;

  // Discover working API base
  for (const base of API_BASES) {
    try {
      const probe = await fetch(`${base}?limit=1`, {
        headers: { 'User-Agent': 'relay-ingest/2.0', 'Accept': 'application/json' },
        signal: AbortSignal.timeout(10_000),
      });
      if (probe.ok) {
        apiBase = base;
        log.info(TAG, `Using API base: ${base}`);
        break;
      }
    } catch (err) {
      log.warn(TAG, `API base ${base} unreachable`, err instanceof Error ? err : undefined);
    }
  }

  if (!apiBase) {
    log.error(TAG, 'All API bases unreachable — skipping official source');
    return [];
  }

  let cursor: string | null = null;
  let pageNum = 0;

  do {
    pageNum++;
    const pageUrl = cursor
      ? `${apiBase}?limit=100&cursor=${cursor}`
      : `${apiBase}?limit=100`;

    let pageRes: Response;
    try {
      pageRes = await fetch(pageUrl, {
        headers: { 'User-Agent': 'relay-ingest/2.0', 'Accept': 'application/json' },
        signal: AbortSignal.timeout(15_000),
      });
    } catch (err) {
      log.error(TAG, `Page ${pageNum} fetch failed`, err);
      break;
    }

    if (!pageRes.ok) {
      log.warn(TAG, `Page ${pageNum} returned ${pageRes.status} — stopping pagination`);
      break;
    }

    let pageData: any;
    try {
      pageData = await pageRes.json();
    } catch (err) {
      log.error(TAG, `Page ${pageNum} JSON parse failed`, err);
      break;
    }

    const items: any[] = pageData.servers ?? pageData.items ?? [];
    if (items.length === 0) break;

    for (const entry of items) {
      // Official response: { server: ServerDetail, _meta: {...} }
      // Handle both wrapped format and flat format for backwards compat
      const s = entry.server ?? entry;
      const officialMeta = entry._meta?.['io.modelcontextprotocol.registry/official'] ?? {};
      const publisherMeta = entry._meta?.['io.modelcontextprotocol.registry/publisher-provided'] ?? null;

      // Skip non-latest versions to avoid duplicates (per OpenAPI: isLatest boolean)
      if (officialMeta.isLatest === false) continue;

      // Skip deleted/deprecated
      if (officialMeta.status === 'deleted') continue;

      // name is required, reverse-DNS format: "io.github.user/weather"
      const rawName: string = s.name ?? '';
      if (!rawName) continue;

      const name = slugify(rawName);
      if (!name) continue;

      // Extract connection info from remotes[] and packages[]
      const remotes: any[] = Array.isArray(s.remotes) ? s.remotes : [];
      const packages: any[] = Array.isArray(s.packages) ? s.packages : [];
      const { endpoint, transport } = resolveConnectionInfo(remotes, packages);

      // Repository metadata
      const repo = s.repository ?? null;
      const githubUrl = typeof repo?.url === 'string' ? repo.url : null;

      // Icons
      const icons: any[] = Array.isArray(s.icons) ? s.icons : [];

      servers.push({
        name,
        display_name: s.title ?? rawName,
        description:  typeof s.description === 'string' ? s.description : '',
        title:        typeof s.title === 'string' ? s.title : null,
        endpoint,
        version:      typeof s.version === 'string' ? s.version : '0.0.0',
        github_url:   githubUrl,
        homepage_url: typeof s.websiteUrl === 'string' ? s.websiteUrl : null,
        license:      null, // Official registry does not include license in OpenAPI
        tags:         [], // Official registry does not include tags in OpenAPI
        tools:        [],
        tool_schemas: [],
        source:       'official',
        source_id:    rawName,
        official_id:  rawName,
        verified:     officialMeta.status === 'active',
        transport,
        upstream_updated_at: officialMeta.updatedAt ?? officialMeta.publishedAt ?? null,

        // Connection profile (Option B side table)
        raw_upstream_json: entry,
        remotes:           remotes.length > 0 ? remotes : null,
        packages:          packages.length > 0 ? packages : null,
        icons:             icons.length > 0 ? icons : null,
        official_meta:     Object.keys(officialMeta).length > 0 ? officialMeta : null,
        publisher_meta:    publisherMeta,
      });
    }

    // Pagination: per OpenAPI, metadata.nextCursor
    cursor = pageData.metadata?.nextCursor ?? pageData.nextCursor ?? pageData.cursor ?? null;

    log.info(TAG, `Page ${pageNum} processed`, {
      itemsOnPage: items.length,
      totalSoFar: servers.length,
      hasMore: !!cursor,
    });
  } while (cursor);

  log.info(TAG, `Fetch complete`, { total: servers.length });
  return servers;
}
