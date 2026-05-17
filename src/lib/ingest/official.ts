/**
 * Official MCP Registry Fetcher
 *
 * Source: registry.modelcontextprotocol.io
 * API:    GET /v0/servers?limit=100&cursor=... (cursor-paginated)
 *
 * CRITICAL: The API returns ALL versions of every server.
 * The ?isLatest param does NOT filter server-side (verified by live API).
 * We filter isLatest: true client-side in the pagination loop.
 *
 * Field mapping:
 *   remotes[].url             → endpoint (Grade A for HTTP invoke)
 *   remotes[].headers[]       → env_var_schema (auth header specs)
 *   packages[]                → package_info (Grade A for stdio invoke)
 *   packages[].environmentVariables[] → env_var_schema (Grade A)
 *   icons[0].src              → icon_url
 *   server.title              → title (Grade B for search)
 *   server.version            → version (Official is the only source with real versions)
 *   repository.url            → github_url
 */

import type {
  IngestServer,
  Transport,
  EnvVarSpec,
  PackageInfo,
} from './types';
import { connect } from 'node:http2';
import { slugify } from './helpers';
import { log } from '@/lib/logger';

const TAG = 'ingest:official';

const API_BASES = [
  'https://registry.modelcontextprotocol.io/v0/servers',
  'https://registry.modelcontextprotocol.io/v0.1/servers',
];

function officialRegistryTimeoutMs(): number {
  const value = Number(process.env.OFFICIAL_REGISTRY_TIMEOUT_MS || 30_000);
  return Number.isFinite(value) && value > 0 ? value : 30_000;
}

async function fetchJsonWithHttp2(url: string, timeoutMs: number): Promise<{ status: number; data: any }> {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const client = connect(parsed.origin);
    let settled = false;
    let timer: ReturnType<typeof setTimeout>;

    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      client.close();
      fn();
    };

    timer = setTimeout(() => {
      finish(() => reject(new Error(`HTTP/2 request timed out after ${timeoutMs}ms`)));
    }, timeoutMs);

    client.on('error', (err) => {
      finish(() => reject(err));
    });

    const req = client.request({
      ':method': 'GET',
      ':path': `${parsed.pathname}${parsed.search}`,
      'user-agent': 'relay-ingest/2.0',
      accept: 'application/json',
    });

    let status = 0;
    const chunks: Buffer[] = [];

    req.setEncoding('utf8');
    req.on('response', (headers) => {
      const rawStatus = headers[':status'];
      status = typeof rawStatus === 'number' ? rawStatus : Number(rawStatus ?? 0);
    });
    req.on('data', (chunk) => {
      chunks.push(Buffer.from(chunk));
    });
    req.on('error', (err) => {
      finish(() => reject(err));
    });
    req.on('end', () => {
      finish(() => {
        const body = Buffer.concat(chunks).toString('utf8');
        try {
          resolve({ status, data: body ? JSON.parse(body) : null });
        } catch (err) {
          reject(new Error(`Official registry returned invalid JSON: ${err instanceof Error ? err.message : String(err)}`));
        }
      });
    });
    req.end();
  });
}

async function fetchOfficialJson(url: string, timeoutMs: number): Promise<{ status: number; data: any }> {
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'relay-ingest/2.0', 'Accept': 'application/json' },
      signal: AbortSignal.timeout(timeoutMs),
    });
    return { status: res.status, data: await res.json() };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log.warn(TAG, `fetch failed for ${url}; retrying with HTTP/2`, err instanceof Error ? err : undefined);
    try {
      return await fetchJsonWithHttp2(url, timeoutMs);
    } catch (http2Err) {
      const http2Message = http2Err instanceof Error ? http2Err.message : String(http2Err);
      throw new Error(`${message}; HTTP/2 fallback failed: ${http2Message}`);
    }
  }
}

// ── Transport helpers ─────────────────────────────────────────────────────────

function resolveRemoteTransport(remote: any): Transport {
  const type = typeof remote?.type === 'string' ? remote.type.toLowerCase() : '';
  if (type === 'streamable-http') return 'streamable_http';
  if (type === 'sse') return 'sse';
  return 'unknown';
}

function resolvePackageTransport(pkg: any): Transport {
  const type = typeof pkg?.transport?.type === 'string' ? pkg.transport.type.toLowerCase() : '';
  if (type === 'stdio') return 'stdio';
  if (type === 'streamable-http') return 'streamable_http';
  if (type === 'sse') return 'sse';
  return 'unknown';
}

function resolveConnectionInfo(
  remotes: any[],
  packages: any[]
): { endpoint: string | null; transport: Transport } {
  // Remotes first — always remote HTTP
  for (const remote of remotes) {
    const url = typeof remote?.url === 'string' ? remote.url.trim() : '';
    const transport = resolveRemoteTransport(remote);
    if (url && (transport === 'streamable_http' || transport === 'sse')) {
      return { endpoint: url, transport };
    }
  }
  // Packages with HTTP transport
  for (const pkg of packages) {
    const transport = resolvePackageTransport(pkg);
    if (transport === 'streamable_http' || transport === 'sse') {
      const url = typeof pkg?.transport?.url === 'string' ? pkg.transport.url.trim() : null;
      return { endpoint: url, transport };
    }
  }
  // stdio
  if (packages.some(p => resolvePackageTransport(p) === 'stdio')) {
    return { endpoint: null, transport: 'stdio' };
  }
  return { endpoint: null, transport: 'unknown' };
}

// ── EnvVarSpec normalization ──────────────────────────────────────────────────

/**
 * Normalize Official registry packages[].environmentVariables[] → EnvVarSpec[].
 * This is the richest source of env var data for stdio servers.
 */
function normalizeEnvVarsFromPackages(packages: any[]): EnvVarSpec[] {
  const specs: EnvVarSpec[] = [];
  for (const pkg of packages) {
    const envVars: any[] = Array.isArray(pkg.environmentVariables) ? pkg.environmentVariables : [];
    for (const ev of envVars) {
      if (typeof ev.name !== 'string' || !ev.name) continue;
      specs.push({
        name:         ev.name,
        description:  typeof ev.description === 'string' ? ev.description : undefined,
        isRequired:   ev.isRequired === true,
        isSecret:     ev.isSecret === true,
        defaultValue: typeof ev.default === 'string' ? ev.default : undefined,
        format:       ev.format ?? undefined,
        placeholder:  typeof ev.placeholder === 'string' ? ev.placeholder : undefined,
      });
    }
  }
  return specs;
}

/**
 * Normalize Official registry remotes[].headers[] → EnvVarSpec[].
 * Remote auth headers (e.g. Authorization: Bearer token) are credential requirements
 * for HTTP invoke — same semantic as env vars for vault injection.
 */
function normalizeEnvVarsFromRemoteHeaders(remotes: any[]): EnvVarSpec[] {
  const specs: EnvVarSpec[] = [];
  for (const remote of remotes) {
    const headers: any[] = Array.isArray(remote.headers) ? remote.headers : [];
    for (const h of headers) {
      if (typeof h.name !== 'string' || !h.name) continue;
      specs.push({
        name:        h.name,
        description: typeof h.description === 'string' ? h.description : undefined,
        isRequired:  h.isRequired === true,
        isSecret:    h.isSecret !== false, // Auth headers are secret by default
        format:      'string',
      });
    }
  }
  return specs;
}

/**
 * Normalize Official registry packages[] → PackageInfo[].
 * This is the ONLY source for stdio install specs — no other registry has this.
 */
function normalizePackageInfo(packages: any[]): PackageInfo[] {
  const infos: PackageInfo[] = [];
  for (const pkg of packages) {
    const registryType = typeof pkg.registryType === 'string' ? pkg.registryType : '';
    const identifier   = typeof pkg.identifier === 'string' ? pkg.identifier : '';
    if (!registryType || !identifier) continue;

    infos.push({
      registryType,
      registryBaseUrl: typeof pkg.registryBaseUrl === 'string' ? pkg.registryBaseUrl : undefined,
      identifier,
      version:         typeof pkg.version === 'string' ? pkg.version : undefined,
      runtimeHint:     typeof pkg.runtimeHint === 'string' ? pkg.runtimeHint : undefined,
      fileSha256:      typeof pkg.fileSha256 === 'string' ? pkg.fileSha256 : undefined,
      transport:       resolvePackageTransport(pkg),
    });
  }
  return infos;
}

// ── Main fetcher ──────────────────────────────────────────────────────────────

export async function fetchOfficialServers(): Promise<IngestServer[]> {
  const servers: IngestServer[] = [];
  let apiBase: string | null = null;
  const timeoutMs = officialRegistryTimeoutMs();
  const baseErrors: string[] = [];

  for (const base of API_BASES) {
    try {
      const probe = await fetchOfficialJson(`${base}?limit=1`, timeoutMs);
      if (probe.status >= 200 && probe.status < 300) { apiBase = base; break; }
      baseErrors.push(`${base}: HTTP ${probe.status}`);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      baseErrors.push(`${base}: ${message}`);
      log.warn(TAG, `API base ${base} unreachable`, err instanceof Error ? err : undefined);
    }
  }

  if (!apiBase) {
    throw new Error(`All official registry API bases unreachable: ${baseErrors.join('; ')}`);
  }

  let cursor: string | null = null;
  let pageNum = 0;
  let totalSeen = 0;

  do {
    pageNum++;
    const pageUrl = cursor
      ? `${apiBase}?limit=100&cursor=${encodeURIComponent(cursor)}`
      : `${apiBase}?limit=100`;

    let pageData: any;
    let pageStatus: number;
    try {
      const page = await fetchOfficialJson(pageUrl, timeoutMs);
      pageStatus = page.status;
      pageData = page.data;
    } catch (err) {
      log.error(TAG, `Page ${pageNum} fetch failed`, err);
      break;
    }

    if (pageStatus < 200 || pageStatus >= 300) {
      log.warn(TAG, `Page ${pageNum} returned ${pageStatus} — stopping pagination`);
      break;
    }

    const items: any[] = pageData.servers ?? pageData.items ?? [];
    if (items.length === 0) break;

    totalSeen += items.length;
    let accepted = 0;

    for (const entry of items) {
      const s            = entry.server ?? entry;
      const officialMeta = entry._meta?.['io.modelcontextprotocol.registry/official'] ?? {};
      const publisherMeta = entry._meta?.['io.modelcontextprotocol.registry/publisher-provided'] ?? null;

      // ── CRITICAL: filter non-latest versions client-side ─────────────────
      // The API returns ALL versions. isLatest query param does NOT filter.
      // H6 fix: use !== true (not === false) so malformed entries with
      // isLatest: undefined are also excluded — never import non-latest versions.
      if (officialMeta.isLatest !== true) continue;
      if (officialMeta.status === 'deleted') continue;

      const rawName: string = s.name ?? '';
      if (!rawName) continue;
      const name = slugify(rawName);
      if (!name) continue;

      const remotes: any[]  = Array.isArray(s.remotes)  ? s.remotes  : [];
      const packages: any[] = Array.isArray(s.packages) ? s.packages : [];
      const icons: any[]    = Array.isArray(s.icons)    ? s.icons    : [];

      const { endpoint, transport } = resolveConnectionInfo(remotes, packages);

      // Combine env vars from packages (stdio) + remote headers (HTTP auth)
      const envFromPkgs    = normalizeEnvVarsFromPackages(packages);
      const envFromHeaders = normalizeEnvVarsFromRemoteHeaders(remotes);
      const allEnvVars     = [...envFromPkgs, ...envFromHeaders];

      // Deduplicate by name (packages + headers may overlap)
      const envVarMap = new Map<string, EnvVarSpec>();
      for (const ev of allEnvVars) envVarMap.set(ev.name, ev);
      const env_var_schema = envVarMap.size > 0 ? Array.from(envVarMap.values()) : null;

      const pkg_info = normalizePackageInfo(packages);

      accepted++;
      servers.push({
        name,
        display_name:  s.title ?? rawName,
        description:   typeof s.description === 'string' ? s.description.slice(0, 500) : '',
        title:         typeof s.title === 'string' ? s.title : null,
        transport,
        endpoint,
        version:       typeof s.version === 'string' ? s.version : null,
        github_url:    typeof s.repository?.url === 'string' ? s.repository.url : null,
        homepage_url:  typeof s.websiteUrl === 'string' ? s.websiteUrl : null,
        icon_url:      typeof icons[0]?.src === 'string' ? icons[0].src : null,
        license:       null, // Official registry does not include license
        tags:          [],   // Official registry does not include tags
        tools:         [],
        tool_schemas:  [],
        tool_extraction_source: 'none',
        env_var_schema,
        package_info:  pkg_info.length > 0 ? pkg_info : null,
        source:        'official',
        source_id:     rawName,
        official_id:   rawName,
        verified:      false,
        upstream_updated_at: officialMeta.updatedAt ?? officialMeta.publishedAt ?? null,

        raw_upstream_json: entry,
        remotes:           remotes.length > 0 ? remotes : null,
        packages:          packages.length > 0 ? packages : null,
        icons:             icons.length > 0 ? icons : null,
        official_meta:     Object.keys(officialMeta).length > 0 ? officialMeta : null,
        publisher_meta:    publisherMeta,
      });
    }

    cursor = pageData.metadata?.nextCursor ?? pageData.nextCursor ?? null;

    log.info(TAG, `Page ${pageNum}`, {
      totalSeen,
      accepted,
      totalAccepted: servers.length,
      hasMore: !!cursor,
    });
  } while (cursor);

  log.info(TAG, 'Fetch complete', { totalRecords: totalSeen, uniqueServers: servers.length });
  return servers;
}
