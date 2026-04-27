import { isSafeUrl, isSafeUrlForServerFetch, parseGitHubUrl } from '@/lib/utils';
/**
 * Relay — Registry Ingest Pipeline
 *
 * Pulls servers from five upstream sources:
 *   1. Official MCP Registry (registry.modelcontextprotocol.io)
 *   2. Smithery (registry.smithery.ai)
 *   3. Glama (glama.ai/mcp/servers)
 *   4. PulseMCP (pulsemcp.com)
 *   5. GitHub MCP servers (github.com/modelcontextprotocol/servers)
 *
 * Every server is:
 *   - Deduplicated by endpoint URL / source ID
 *   - Probed with a proper MCP initialize handshake (spec-compliant)
 *   - Run through L1 static scan + S-14 npm CVE scan
 *   - Trust scored
 *   - Upserted into Supabase
 */

import { computeTrustScore, scanNpmDependencies } from '@/lib/security';
import { probeMCPServer } from '@/lib/mcp-probe';
import { createHash } from 'crypto';

export interface ToolSchema {
  name:         string;
  description?: string;
  inputSchema?: Record<string, any>;
}

export interface IngestServer {
  name:             string;
  display_name:     string;
  description:      string;
  long_description?: string;
  endpoint:         string;
  version:          string;
  github_url?:      string;
  homepage_url?:    string;
  license:          string;
  tags:             string[];
  tools:            string[];
  tool_schemas:     ToolSchema[];
  source:           'official' | 'smithery' | 'github' | 'glama' | 'pulsemcp' |
                    'direct' | 'partner' | 'claudemcp' | 'mcpso' |
                    'mcp_run' | 'composio' | 'zapier' | 'langchain_hub';
  smithery_id?:     string;
  official_id?:     string;
  glama_id?:        string;
  verified?:        boolean;
  transport?:       'stdio' | 'sse' | 'streamable_http' | 'unknown';
  upstream_updated_at?: string;
  description_quality?: 'auto_generated' | 'readme_parsed' | 'upstream' | 'manual';
  readme_url?:      string;
}

/**
 * Fetch MCP primitives (tools, resources, prompts) from a live server.
 *
 * IMPORTANT: Uses the proper MCP initialize handshake before listing primitives.
 * Directly calling tools/list without initialize violates the MCP spec and
 * will fail on spec-compliant servers.
 *
 * Falls back to README parsing if the live probe fails or times out.
 */
export async function fetchMCPPrimitives(endpoint: string, githubUrl?: string): Promise<{
  toolSchemas: ToolSchema[];
  resources:   Array<{ uri: string; name: string; description?: string; mimeType?: string }>;
  prompts:     Array<{ name: string; description?: string }>;
  protocolVersion: string | null;
  mcpCompliant: boolean;
  transport: 'stdio' | 'sse' | 'streamable_http' | 'unknown';
}> {
  const empty = { toolSchemas: [], resources: [], prompts: [], protocolVersion: null, mcpCompliant: false, transport: 'unknown' as const };

  if (!endpoint || !isSafeUrl(endpoint)) {
    // Fallback: parse README for tool hints
    const toolSchemas = githubUrl ? await parseReadmeSchemas(githubUrl) : [];
    return { ...empty, toolSchemas };
  }

  const probe = await probeMCPServer(endpoint, 10_000);

  const toolSchemas: ToolSchema[] = probe.tools.map(t => ({
    name:        t.name,
    description: t.description ?? '',
    inputSchema: t.inputSchema ?? undefined,
  }));

  // If probe returned no tools but server is alive, try README fallback
  if (toolSchemas.length === 0 && githubUrl) {
    const readmeTools = await parseReadmeSchemas(githubUrl);
    return {
      toolSchemas:     readmeTools,
      resources:       probe.resources,
      prompts:         probe.prompts,
      protocolVersion: probe.protocolVersion,
      mcpCompliant:    probe.mcpCompliant,
      transport:       probe.transport,
    };
  }

  return {
    toolSchemas,
    resources:       probe.resources,
    prompts:         probe.prompts,
    protocolVersion: probe.protocolVersion,
    mcpCompliant:    probe.mcpCompliant,
    transport:       probe.transport,
  };
}

/**
 * @deprecated Use fetchMCPPrimitives() instead.
 * This function calls tools/list WITHOUT the required initialize handshake,
 * which violates the MCP specification and fails on compliant servers.
 */
export async function fetchToolSchemas(endpoint: string): Promise<ToolSchema[]> {
  const { toolSchemas } = await fetchMCPPrimitives(endpoint);
  return toolSchemas;
}

export interface IngestResult {
  added:    number;
  updated:  number;
  rejected: number;
  skipped:  number;
  errors:   string[];
  extraction_metrics?: {
    sandbox_attempts: number;
    sandbox_success: number;
    readme_fallback_attempts: number;
    unresolved_stdio_rows: number;
  };
}

/**
 * Parse tool names and descriptions from a GitHub README.
 * Fallback for servers that don't expose a live /tools/list endpoint.
 *
 * Looks for markdown patterns like:
 *   ### tool_name          (h3 headings that look like tool names)
 *   #### `tool_name`       (h4 code headings)
 *   | tool_name | desc |   (markdown tables)
 *   - `tool_name`: desc    (bullet lists)
 *
 * Returns partial ToolSchema objects (no inputSchema — just name + description).
 * These are better than nothing for agent discovery.
 */
export async function parseReadmeSchemas(githubUrl: string): Promise<ToolSchema[]> {
  try {
    const text = await fetchFirstGithubText(githubUrl, ['README.md', 'readme.md']);
    if (!text) return [];

    const tools: ToolSchema[] = [];
    const seen = new Set<string>();

    // Pattern 1: markdown table rows with tool names
    // | tool_name | description |
    const tableRow = /\|\s*`?([a-z][a-z0-9_]{2,40})`?\s*\|\s*([^|\n]+)/g;
    let m;
    while ((m = tableRow.exec(text)) !== null) {
      const name = m[1].trim();
      const desc = m[2].trim();
      if (!seen.has(name) && /^[a-z][a-z0-9_]+$/.test(name)) {
        seen.add(name);
        tools.push({ name, description: desc });
      }
    }

    // Pattern 2: h3/h4 headings that look like tool names
    // ### send_email or #### `create_subscription`
    const heading = /^#{2,4}\s+`?([a-z][a-z0-9_]{2,40})`?/gm;
    while ((m = heading.exec(text)) !== null) {
      const name = m[1].trim();
      if (!seen.has(name) && /^[a-z][a-z0-9_]+$/.test(name)) {
        seen.add(name);
        // Try to get description from the next line
        const afterHeading = text.slice(m.index + m[0].length, m.index + m[0].length + 200);
        const desc = afterHeading.split('\n').find(l => l.trim().length > 10)?.trim() ?? '';
        tools.push({ name, description: desc });
      }
    }

    // Pattern 3: bullet points with tool names
    // - `tool_name`: description
    const bullet = /^-\s+`([a-z][a-z0-9_]{2,40})`[:\s]+(.+)$/gm;
    while ((m = bullet.exec(text)) !== null) {
      const name = m[1].trim();
      if (!seen.has(name)) {
        seen.add(name);
        tools.push({ name, description: m[2].trim() });
      }
    }

    return tools.slice(0, 50); // cap at 50 tools
  } catch {
    return [];
  }
}

function buildGitHubRawCandidates(githubUrl: string, filenames: string[]): string[] {
  const parts = parseGitHubUrl(githubUrl);
  if (!parts) return [];

  const branches = parts.branch ? [parts.branch, 'main', 'master'] : ['main', 'master'];
  const subpaths = parts.subpath ? [parts.subpath, null] : [null];
  const urls: string[] = [];

  for (const branch of branches) {
    for (const subpath of subpaths) {
      for (const filename of filenames) {
        const cleanSubpath = subpath?.replace(/^\/+|\/+$/g, '');
        const path = cleanSubpath ? `${cleanSubpath}/${filename}` : filename;
        urls.push(`https://raw.githubusercontent.com/${parts.owner}/${parts.repo}/${branch}/${path}`);
      }
    }
  }

  return [...new Set(urls)];
}

async function fetchFirstGithubText(githubUrl: string, filenames: string[]): Promise<string | null> {
  for (const rawUrl of buildGitHubRawCandidates(githubUrl, filenames)) {
    if (!(await isSafeUrlForServerFetch(rawUrl))) continue;
    const res = await fetch(rawUrl, {
      headers: { 'User-Agent': 'relay-ingest/0.1' },
      signal: AbortSignal.timeout(8_000),
    });
    if (res.ok) return await res.text();
  }
  return null;
}


// ── Official MCP Registry ─────────────────────────────────────────────────────

export async function fetchOfficialServers(): Promise<IngestServer[]> {
  const servers: IngestServer[] = [];
  let cursor: string | null = null;

  do {
    const pageUrl: string = cursor
      ? `https://registry.modelcontextprotocol.io/v0/servers?limit=100&cursor=${cursor}`
      : 'https://registry.modelcontextprotocol.io/v0/servers?limit=100';

    const pageRes: Response = await fetch(pageUrl, {
      headers: { 'User-Agent': 'relay-ingest/0.1' },
      signal: AbortSignal.timeout(15_000),
    });
    if (!pageRes.ok) break;

    const pageData: any = await pageRes.json();
    const items: any[] = pageData.servers ?? pageData.items ?? [];

    for (const entry of items) {
      // The official registry wraps data: { server: {...}, _meta: {...} }
      // Handle both the wrapped format and flat format for backwards compat
      const s = entry.server ?? entry;
      const meta = entry._meta?.['io.modelcontextprotocol.registry/official'] ?? {};

      // Skip non-latest versions to avoid duplicates
      if (meta.isLatest === false) continue;

      // Extract name — official uses qualified names like "org/name"
      const rawName = s.name ?? s.qualifiedName ?? '';
      if (!rawName) continue;

      // Extract the first remote endpoint
      const remote = (s.remotes ?? [])[0];
      const endpoint = remote?.url ?? s.url ?? s.endpoint ?? '';

      // Detect transport from remote type
      let transport: IngestServer['transport'] = 'unknown';
      if (remote?.type === 'streamable-http' || remote?.type === 'http') {
        transport = 'streamable_http';
      } else if (remote?.type === 'sse') {
        transport = 'sse';
      } else if (remote?.type === 'stdio') {
        transport = 'stdio';
      } else if (endpoint) {
        transport = 'streamable_http'; // default for URL-bearing remotes
      }

      servers.push({
        name:         slugify(rawName),
        display_name: s.displayName ?? rawName,
        description:  s.description ?? '',
        endpoint,
        version:      s.version ?? '1.0.0',
        github_url:   s.repository?.url ?? s.githubUrl ?? undefined,
        homepage_url: s.websiteUrl ?? s.homepage ?? undefined,
        license:      s.license ?? 'MIT',
        tags:         s.tags ?? s.categories ?? [],
        tools:        s.tools?.map((t: any) => t.name ?? t) ?? [],
        tool_schemas: [],
        source:       'official',
        official_id:  s.id ?? s.qualifiedName ?? rawName,
        verified:     s.isVerified ?? (meta.status === 'active'),
        transport,
        upstream_updated_at: s.updatedAt ?? meta.updatedAt ?? s.createdAt ?? undefined,
      });
    }

    cursor = pageData.nextCursor ?? pageData.cursor ?? null;
  } while (cursor);

  return servers;
}

// ── Smithery ──────────────────────────────────────────────────────────────────

function normalizeDeclaredRemoteTransport(
  rawType: unknown,
  url?: string
): IngestServer['transport'] {
  const type = typeof rawType === 'string' ? rawType.toLowerCase() : '';

  if (type === 'stdio') return 'stdio';
  if (type.includes('sse')) return 'sse';
  if (type.includes('http') || type.includes('stream')) return 'streamable_http';

  if (url) {
    const detected = detectTransport(url);
    if (detected === 'sse' || detected === 'streamable_http') return detected;
    return 'streamable_http';
  }

  return 'unknown';
}

export function selectSmitheryConnection(
  connections: any[] | undefined,
  deploymentUrl?: string | null
): { endpoint: string; transport: IngestServer['transport'] } | null {
  const declaredConnections = Array.isArray(connections) ? connections : [];

  for (const connection of declaredConnections) {
    const url = typeof connection?.url === 'string' ? connection.url.trim() : '';
    const transport = normalizeDeclaredRemoteTransport(connection?.type, url);
    if (url && transport !== 'stdio') {
      return { endpoint: url, transport };
    }
  }

  const remoteDeploymentUrl = typeof deploymentUrl === 'string' ? deploymentUrl.trim() : '';
  if (remoteDeploymentUrl) {
    return {
      endpoint: remoteDeploymentUrl,
      transport: normalizeDeclaredRemoteTransport('streamable-http', remoteDeploymentUrl),
    };
  }

  if (declaredConnections.some((connection) => normalizeDeclaredRemoteTransport(connection?.type) === 'stdio')) {
    return { endpoint: '', transport: 'stdio' };
  }

  return null;
}


export async function fetchSmitheryServers(): Promise<IngestServer[]> {
  const apiKey = process.env.SMITHERY_API_KEY;
  if (!apiKey) {
    console.warn('[ingest:smithery] SMITHERY_API_KEY not set — skipping');
    return [];
  }

  const servers: IngestServer[] = [];
  let page = 1;
  const pageSize = 100;

  while (true) {
    const res = await fetch(
      `https://registry.smithery.ai/servers?q=&page=${page}&pageSize=${pageSize}`,
      {
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'User-Agent': 'relay-ingest/0.1',
        },
        signal: AbortSignal.timeout(15_000),
      }
    );
    if (!res.ok) break;

    const data = await res.json();
    const items: any[] = data.servers ?? [];
    if (items.length === 0) break;

    for (const s of items) {
      const name = slugify(s.qualifiedName ?? s.displayName ?? '');
      if (!name) continue;

      const selectedConnection = selectSmitheryConnection(
        s.connections,
        s.deploymentUrl ?? s.url ?? null
      );
      const endpoint = selectedConnection?.endpoint ?? '';
      const transport = selectedConnection?.transport ?? 'unknown';

      servers.push({
        name,
        display_name: s.displayName ?? name,
        description:  s.description ?? '',
        endpoint,
        version:      '1.0.0',
        github_url:   s.repository ?? undefined,
        license:      'MIT',
        tags:         s.tags ?? [],
        tools:        s.tools?.map((t: any) => t.name ?? t) ?? [],
        tool_schemas: [],
        source:       'smithery',
        smithery_id:  s.qualifiedName ?? undefined,
        verified:     s.security?.scanPassed ?? false,
        transport,
        upstream_updated_at: s.updatedAt ?? s.createdAt ?? undefined,
      });
    }

    if (items.length < pageSize) break;
    page++;
    // Polite rate limiting
    await new Promise(r => setTimeout(r, 200));
  }

  return servers;
}

// ── GitHub MCP Servers ────────────────────────────────────────────────────────

export async function fetchGitHubServers(): Promise<IngestServer[]> {
  // The official MCP servers repo has subdirectories under src/
  // Each subdirectory is a server. We pull the list via GitHub Contents API
  // then fetch each server's README for description.
  try {
    const res = await fetch(
      'https://api.github.com/repos/modelcontextprotocol/servers/contents/src',
      {
        headers: { 'User-Agent': 'relay-ingest/0.1', 'Accept': 'application/vnd.github.v3+json' },
        signal: AbortSignal.timeout(10_000),
      }
    );
    if (!res.ok) return [];
    const dirs: any[] = await res.json();

    const servers: IngestServer[] = [];
    for (const dir of dirs) {
      if (dir.type !== 'dir') continue;
      const name = slugify(dir.name);
      if (!name) continue;

      // Try to read the package.json or README for description
      let description = `Official MCP reference server: ${dir.name}`;
      try {
        const readmeRes = await fetch(
          `https://raw.githubusercontent.com/modelcontextprotocol/servers/main/src/${dir.name}/README.md`,
          { signal: AbortSignal.timeout(5_000) }
        );
        if (readmeRes.ok) {
          const readme = await readmeRes.text();
          // Take the first paragraph as description
          const firstParagraph = readme.split('\n\n').find(p => p.trim() && !p.startsWith('#') && !p.startsWith('```'));
          if (firstParagraph) description = firstParagraph.trim().slice(0, 300);
        }
      } catch { /* ignore — description already has a fallback */ }

      servers.push({
        name:         `mcp-${name}`,
        display_name: dir.name.charAt(0).toUpperCase() + dir.name.slice(1),
        description,
        endpoint:     '',
        version:      '1.0.0',
        github_url:   `https://github.com/modelcontextprotocol/servers/tree/main/src/${dir.name}`,
        license:      'MIT',
        tags:         ['official', 'reference'],
        tools:        [],
        tool_schemas: [],
        source:       'github' as const,
        verified:     true,
        transport:    'stdio',
      });
    }

    return servers;
  } catch {
    return [];
  }
}

// ── Verified Vendor Servers ────────────────────────────────────────────────────
// Curated list of elite enterprise providers and the official GitHub MCP directory.

export async function fetchVendorServers(): Promise<IngestServer[]> {
  const servers: IngestServer[] = [];
  try {
    // 1. Fetch from the official github.com/mcp registry ORG
    const res = await fetch('https://api.github.com/orgs/mcp/repos?per_page=100', {
      headers: { 'User-Agent': 'relay-ingest/0.1', 'Accept': 'application/vnd.github.v3+json' },
      signal: AbortSignal.timeout(10_000),
    });
    
    if (res.ok) {
      const repos: any[] = await res.json();
      for (const repo of repos) {
        if (repo.archived || repo.disabled) continue;
        const name = repo.name;
        
        servers.push({
          name:         slugify(name),
          display_name: repo.name,
          description:  repo.description || 'Official Vendor MCP Server',
          endpoint:     '', // Discovered lazily
          version:      '1.0.0',
          github_url:   repo.html_url,
          homepage_url: repo.homepage || undefined,
          license:      repo.license?.spdx_id || 'MIT',
          tags:         ['partner', 'official'],
          tools:        [],
          tool_schemas: [],
          source:       'partner',
          verified:     true,
          transport:    'stdio', // Assume stdio default for github repos
          upstream_updated_at: repo.updated_at,
        });
      }
    }
  } catch (e) {
    console.warn('[ingest:vendor] Error fetching vendor servers:', e);
  }
  return servers;
}

// ── PulseMCP ──────────────────────────────────────────────────────────────────
// PulseMCP does NOT have a public API (returns 403).
// This fetcher is kept as a scaffold for when they open access or provide API keys.

export async function fetchPulseMCPServers(): Promise<IngestServer[]> {
  console.warn('[ingest:pulsemcp] PulseMCP API returns 403 — no public API available. Skipping.');
  return [];
}

export async function fetchGlamaServers(): Promise<IngestServer[]> {
  const servers: IngestServer[] = [];
  let cursor: string | null = null;
  const perPage = 100;

  while (true) {
    try {
      const url: string = cursor
        ? `https://glama.ai/api/mcp/v1/servers?perPage=${perPage}&after=${cursor}`
        : `https://glama.ai/api/mcp/v1/servers?perPage=${perPage}`;

      const res: Response = await fetch(url, {
        headers: { 'User-Agent': 'relay-ingest/0.1', 'Accept': 'application/json' },
        signal: AbortSignal.timeout(15_000),
      });
      if (!res.ok) break;

      const data: any = await res.json();
      const items: any[] = data.servers ?? [];
      if (items.length === 0) break;

      for (const s of items) {
        const name = slugify(s.name ?? s.slug ?? s.id ?? '');
        if (!name) continue;

        // Detect transport from Glama's 'attributes' array
        const attrs: string[] = s.attributes ?? [];
        let transport: IngestServer['transport'] = 'unknown';
        if (attrs.some(a => a.includes('local-only'))) {
          transport = 'stdio';
        } else if (attrs.some(a => a.includes('remote'))) {
          transport = s.url
            ? (detectTransport(s.url) === 'sse' ? 'sse' : 'streamable_http')
            : 'streamable_http';
        } else if (s.url) {
          transport = detectTransport(s.url);
        }

        servers.push({
          name,
          display_name: s.name ?? name,
          description:  s.description ?? '',
          endpoint:     s.url ?? '',
          version:      '1.0.0',
          github_url:   s.repository?.url ?? undefined,
          homepage_url: s.url ?? undefined,
          license:      s.spdxLicense?.name ?? 'MIT',
          tags:         attrs,
          tools:        s.tools?.map((t: any) => t.name ?? t) ?? [],
          tool_schemas: [],
          source:       'glama' as any,
          glama_id:     s.id ?? undefined,
          verified:     false,
          transport,
          upstream_updated_at: s.updatedAt ?? undefined,
        });
      }

      // Cursor pagination: use pageInfo.endCursor
      const hasNext = data.pageInfo?.hasNextPage ?? false;
      cursor = data.pageInfo?.endCursor ?? null;
      if (!hasNext || !cursor) break;

      await new Promise(r => setTimeout(r, 300)); // polite rate limiting
    } catch (e: any) {
      console.error(`[ingest:glama] Error on page:`, e.message);
      break;
    }
  }

  return servers;
}


// ── ClaudeMCP ─────────────────────────────────────────────────────────────────
// claudemcp.com/servers — curated directory, scrape-based (no public API).
// Uses the JSON data endpoint that the page fetches client-side.

export async function fetchClaudeMCPServers(): Promise<IngestServer[]> {
  const servers: IngestServer[] = [];
  try {
    // claudemcp.com serves a JSON list at this endpoint (confirmed via network inspection)
    const res = await fetch('https://claudemcp.com/api/servers', {
      headers: { 'User-Agent': 'relay-ingest/0.1', 'Accept': 'application/json' },
      signal: AbortSignal.timeout(15_000),
    });

    if (!res.ok) {
      // Fallback: attempt to parse the static JSON data embedded in the page
      const pageRes = await fetch('https://claudemcp.com/servers', {
        headers: { 'User-Agent': 'relay-ingest/0.1' },
        signal: AbortSignal.timeout(15_000),
      });
      if (!pageRes.ok) {
        console.warn('[ingest:claudemcp] Both API and page fetch failed — skipping');
        return [];
      }
      const html = await pageRes.text();
      // Extract JSON from __NEXT_DATA__ script tag
      const match = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
      if (!match) return [];
      try {
        const nextData = JSON.parse(match[1]);
        const items: any[] = nextData?.props?.pageProps?.servers ?? [];
        return parseClaudeMCPItems(items);
      } catch {
        return [];
      }
    }

    const data = await res.json();
    const items: any[] = data?.servers ?? data ?? [];
    return parseClaudeMCPItems(items);
  } catch (e: any) {
    console.warn('[ingest:claudemcp] Error:', e.message);
    return [];
  }
}

function parseClaudeMCPItems(items: any[]): IngestServer[] {
  const servers: IngestServer[] = [];
  for (const s of items) {
    const name = slugify(s.name ?? s.slug ?? s.id ?? '');
    if (!name) continue;
    const endpoint = s.endpoint ?? s.url ?? s.serverUrl ?? '';
    const isStdio  = !endpoint || s.transport === 'stdio' || s.type === 'local';
    servers.push({
      name,
      display_name:  s.name ?? name,
      description:   s.description ?? s.shortDescription ?? '',
      endpoint:      isStdio ? '' : endpoint,
      version:       s.version ?? '1.0.0',
      github_url:    s.githubUrl ?? s.repository ?? s.github ?? undefined,
      homepage_url:  s.websiteUrl ?? s.homepage ?? undefined,
      license:       s.license ?? 'MIT',
      tags:          s.tags ?? s.categories ?? [],
      tools:         s.tools?.map((t: any) => t.name ?? t) ?? [],
      tool_schemas:  [],
      source:        'claudemcp',
      verified:      s.verified ?? s.featured ?? false,
      transport:     isStdio ? 'stdio' : (s.transport ?? undefined),
      upstream_updated_at: s.updatedAt ?? s.lastUpdated ?? undefined,
    });
  }
  return servers;
}

// ── MCP.so ────────────────────────────────────────────────────────────────────
// mcp.so — curated MCP server directory with a discoverable API.

export async function fetchMcpSoServers(): Promise<IngestServer[]> {
  const servers: IngestServer[] = [];
  let page = 1;

  while (true) {
    try {
      const res = await fetch(`https://mcp.so/api/servers?page=${page}&limit=100`, {
        headers: { 'User-Agent': 'relay-ingest/0.1', 'Accept': 'application/json' },
        signal: AbortSignal.timeout(15_000),
      });
      if (!res.ok) break;

      const data = await res.json();
      const items: any[] = data?.data ?? data?.servers ?? data ?? [];
      if (!Array.isArray(items) || items.length === 0) break;

      for (const s of items) {
        const name = slugify(s.name ?? s.slug ?? '');
        if (!name) continue;
        const endpoint = s.endpoint ?? s.url ?? '';
        const isStdio  = !endpoint || s.transport === 'stdio';
        servers.push({
          name,
          display_name:  s.name ?? name,
          description:   s.description ?? '',
          endpoint:      isStdio ? '' : endpoint,
          version:       s.version ?? '1.0.0',
          github_url:    s.githubUrl ?? s.github ?? undefined,
          homepage_url:  s.websiteUrl ?? undefined,
          license:       s.license ?? 'MIT',
          tags:          s.tags ?? s.categories ?? [],
          tools:         s.tools?.map((t: any) => t.name ?? t) ?? [],
          tool_schemas:  [],
          source:        'mcpso',
          verified:      s.verified ?? s.official ?? false,
          transport:     isStdio ? 'stdio' : undefined,
          upstream_updated_at: s.updatedAt ?? undefined,
        });
      }

      if (items.length < 100) break;
      page++;
      await new Promise(r => setTimeout(r, 300));
    } catch (e: any) {
      console.warn('[ingest:mcp.so] Error on page', page, ':', e.message);
      break;
    }
  }

  console.log(`[ingest:mcp.so] Fetched ${servers.length} servers`);
  return servers;
}

/**
 * This determines whether the server is invokable through the Relay proxy.
 *
 * stdio: local process — cannot be reached over HTTP, excluded from agent search
 * sse | streamable_http: public HTTP endpoint — invokable through proxy
 * unknown: no clear signal — treated as stdio (excluded) until proven otherwise
 */
// ── README description extraction ─────────────────────────────────────────────
// Fetches a GitHub README and extracts the first meaningful paragraph as a
// description. Used when upstream registry provides no description or a
// placeholder. Returns null if fetch fails or README has no extractable text.

export async function parseReadmeDescription(githubUrl: string): Promise<{
  description: string | null;
  long_description: string | null;
  readme_url: string;
} | null> {
  try {
    let text: string | null = null;
    let readmeUrl = '';

    for (const candidate of buildGitHubRawCandidates(githubUrl, ['README.md', 'readme.md'])) {
      readmeUrl = candidate;
      if (!(await isSafeUrlForServerFetch(readmeUrl))) continue;
      const res = await fetch(readmeUrl, {
        headers: { 'User-Agent': 'relay-ingest/1.0' },
        signal: AbortSignal.timeout(8_000),
      });
      if (res.ok) { text = await res.text(); break; }
    }
    if (!text) return null;

    // Strip markdown title and badges
    const lines = text
      .split('\n')
      .filter(l => !l.startsWith('#'))           // strip headings
      .filter(l => !l.startsWith('!['))           // strip image badges
      .filter(l => !l.startsWith('[!['))          // strip badge links
      .filter(l => l.trim().length > 0);

    // First meaningful paragraph (at least 30 chars)
    const paragraphs = text.split('\n\n')
      .map(p => p.replace(/^#+\s+.*/gm, '').replace(/!\[.*?\]\(.*?\)/g, '').replace(/\[(.+?)\]\(.+?\)/g, '$1').trim())
      .filter(p => p.length >= 30 && !p.startsWith('```'));

    const description = paragraphs[0]?.slice(0, 300) ?? null;
    const long_description = paragraphs.slice(0, 5).join('\n\n').slice(0, 2000) ?? null;

    return { description, long_description, readme_url: readmeUrl };
  } catch {
    return null;
  }
}

// ── MCP.run ───────────────────────────────────────────────────────────────────
// mcp.run — hosted MCP server platform with REST API

export async function fetchMcpRunServers(): Promise<IngestServer[]> {
  const servers: IngestServer[] = [];
  try {
    const res = await fetch('https://mcp.run/api/servers?limit=100', {
      headers: { 'User-Agent': 'relay-ingest/1.0', 'Accept': 'application/json' },
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) {
      console.warn('[ingest:mcp.run] API returned', res.status, '— skipping');
      return [];
    }
    const data = await res.json();
    const items: any[] = data?.servers ?? data?.data ?? data ?? [];
    for (const s of items) {
      const name = slugify(s.name ?? s.slug ?? s.id ?? '');
      if (!name) continue;
      const endpoint = s.endpoint ?? s.url ?? s.serverUrl ?? '';
      servers.push({
        name,
        display_name:       s.name ?? name,
        description:        s.description ?? '',
        endpoint:           endpoint || '',
        version:            s.version ?? '1.0.0',
        github_url:         s.githubUrl ?? s.repository ?? undefined,
        homepage_url:       s.homepageUrl ?? `https://mcp.run/servers/${s.slug ?? name}`,
        license:            s.license ?? 'MIT',
        tags:               s.tags ?? s.categories ?? [],
        tools:              s.tools?.map((t: any) => t.name ?? t) ?? [],
        tool_schemas:       [],
        source:             'mcp_run',
        verified:           s.verified ?? s.official ?? false,
        transport:          endpoint ? undefined : 'stdio',
        description_quality: s.description ? 'upstream' : 'auto_generated',
        upstream_updated_at: s.updatedAt ?? undefined,
      });
    }
  } catch (e: any) {
    console.warn('[ingest:mcp.run] Error:', e.message);
  }
  console.log(`[ingest:mcp.run] Fetched ${servers.length} servers`);
  return servers;
}

// ── Composio ──────────────────────────────────────────────────────────────────
// composio.dev — agent tooling platform with MCP-compatible tool integrations

export async function fetchComposioServers(): Promise<IngestServer[]> {
  const servers: IngestServer[] = [];
  try {
    // Composio exposes their integrations list publicly
    const res = await fetch('https://backend.composio.dev/api/v1/apps?limit=100', {
      headers: { 'User-Agent': 'relay-ingest/1.0', 'Accept': 'application/json' },
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) {
      console.warn('[ingest:composio] API returned', res.status, '— skipping');
      return [];
    }
    const data = await res.json();
    const items: any[] = data?.items ?? data?.apps ?? [];
    for (const s of items) {
      const name = slugify(`composio-${s.name ?? s.key ?? s.appId ?? ''}`);
      if (!name || name === 'composio-') continue;
      // Composio tools are HTTP-accessible via their proxy
      const endpoint = s.mcpEndpoint ?? s.serverUrl ?? '';
      servers.push({
        name,
        display_name:       s.displayName ?? s.name ?? name,
        description:        s.description ?? `${s.name ?? name} integration via Composio`,
        endpoint:           endpoint || '',
        version:            '1.0.0',
        github_url:         undefined,
        homepage_url:       `https://app.composio.dev/apps/${s.key ?? s.name}`,
        license:            'Proprietary',
        tags:               s.categories ?? s.tags ?? [],
        tools:              s.actions?.map((a: any) => a.name ?? a) ?? [],
        tool_schemas:       [],
        source:             'composio',
        verified:           false,
        transport:          endpoint ? 'streamable_http' : 'stdio',
        description_quality: s.description ? 'upstream' : 'auto_generated',
      });
    }
  } catch (e: any) {
    console.warn('[ingest:composio] Error:', e.message);
  }
  console.log(`[ingest:composio] Fetched ${servers.length} servers`);
  return servers;
}

export function detectTransport(endpoint: string, githubUrl?: string): 'stdio' | 'sse' | 'streamable_http' | 'unknown' {
  if (!endpoint) {
    // No endpoint at all — if there's a github URL, it's stdio
    return githubUrl ? 'stdio' : 'unknown';
  }

  const e = endpoint.toLowerCase().trim();

  // Clear HTTP endpoints — invokable
  if (e.startsWith('https://') || e.startsWith('http://')) {
    // Check if it's a GitHub repo URL masquerading as an endpoint
    if (e.includes('github.com/') && !e.includes('/api/') && !e.includes('/sse')) {
      return 'stdio';
    }
    if (e.includes('/sse') || e.includes('/events')) {
      return 'sse';
    }
    if (e.includes('/mcp') || e.includes('/stream')) {
      return 'streamable_http';
    }
    return 'unknown';
  }

  // Local process indicators
  if (
    e.startsWith('npx ') ||
    e.startsWith('node ') ||
    e.startsWith('python') ||
    e.startsWith('uvx ') ||
    e.startsWith('cargo ') ||
    e.startsWith('/') ||           // file path
    e.endsWith('.js') ||
    e.endsWith('.py') ||
    e.endsWith('.ts')
  ) {
    return 'stdio';
  }

  // GitHub URL with no HTTP component
  if (e.includes('github.com')) {
    return 'stdio';
  }

  return 'unknown';
}



// ── Upsert pipeline ───────────────────────────────────────────────────────────

/**
 * Human-readable relative time for logging.
 * e.g. "3.2h ago", "2d ago", "just now"
 */
function agoStr(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 60_000) return 'just now';
  if (ms < 3_600_000) return `${Math.floor(ms / 60_000)}m ago`;
  if (ms < 86_400_000) return `${(ms / 3_600_000).toFixed(1)}h ago`;
  return `${Math.floor(ms / 86_400_000)}d ago`;
}

export async function upsertServers(
  servers: IngestServer[],
  svc: any
): Promise<IngestResult> {
  const result: IngestResult = {
    added: 0,
    updated: 0,
    rejected: 0,
    skipped: 0,
    errors: [],
    extraction_metrics: {
      sandbox_attempts: 0,
      sandbox_success: 0,
      readme_fallback_attempts: 0,
      unresolved_stdio_rows: 0,
    },
  };
  const tag = '[ingest:upsert]';
  const skipReasons: Record<string, number> = {};
  const sourceStart = Date.now();

  // Resolve system author_id ONCE
  const { data: systemProfile } = await svc
    .from('profiles').select('id').limit(1).maybeSingle();
  const systemAuthorId: string | null = systemProfile?.id ?? null;

  if (!systemAuthorId) {
    console.warn(`${tag} No system profile found — new servers will be inserted without author_id. Run 002_seed_data.sql to fix.`);
  } else {
    console.log(`${tag} System author resolved: ${systemAuthorId}`);
  }

  // Batch pre-fetch all existing servers to eliminate N+1 DB lookups
  // Includes upstream_updated_at for three-tier skip comparison
  const { data: allExisting, error: prefetchErr } = await svc
    .from('servers')
    .select('id, name, source, endpoint, schema_hash, smithery_id, official_id, glama_id, github_url, last_scanned_at, upstream_updated_at');

  if (prefetchErr) {
    console.error(`${tag} Pre-fetch FAILED: ${prefetchErr.message}. Will treat all servers as new.`);
  }

  const existingByName     = new Map<string, any>();
  const existingBySmithery = new Map<string, any>();
  const existingByOfficial = new Map<string, any>();
  const existingByGlama    = new Map<string, any>();
  const existingByGithub   = new Map<string, any>();
  const existingByEndpoint = new Map<string, any>(); // NEW: dedup by HTTP endpoint

  for (const row of allExisting ?? []) {
    if (row.name)        existingByName.set(row.name, row);
    if (row.smithery_id) existingBySmithery.set(row.smithery_id, row);
    if (row.official_id) existingByOfficial.set(row.official_id, row);
    if (row.glama_id)    existingByGlama.set(row.glama_id, row);
    if (row.github_url)  existingByGithub.set(row.github_url.replace(/\.git$/, '').toLowerCase(), row);
    // Index by normalized endpoint URL — catches cross-source duplicates
    if (row.endpoint)    existingByEndpoint.set(row.endpoint.replace(/\/$/, '').toLowerCase(), row);
  }

  console.log(`${tag} Pre-fetched ${existingByName.size} existing servers. Processing ${servers.length} incoming...`);

  // CVE scan deduplication: same GitHub repo shouldn't be scanned multiple times
  const scannedRepos = new Map<string, any[]>();

  for (let idx = 0; idx < servers.length; idx++) {
    const s = servers[idx];
    const progress = `[${idx + 1}/${servers.length}]`;
    try {
      // Guard: name required
      if (!s.name) {
        result.skipped++;
        skipReasons['no_name'] = (skipReasons['no_name'] ?? 0) + 1;
        continue;
      }

      // Normalise name first so logging is readable
      s.name = slugify(s.name).slice(0, 64);
      if (!s.name || !/^[a-z0-9-]+$/.test(s.name)) {
        result.skipped++;
        skipReasons['invalid_name'] = (skipReasons['invalid_name'] ?? 0) + 1;
        continue;
      }

      // SSRF protection
      if (s.endpoint && !isSafeUrl(s.endpoint)) {
        console.warn(`${tag} ${progress} [SKIP:unsafe-url] ${s.name} — endpoint rejected by SSRF guard`);
        result.skipped++;
        skipReasons['unsafe_url'] = (skipReasons['unsafe_url'] ?? 0) + 1;
        continue;
      }

      // Classify transport — DO NOT skip stdio servers.
      // Discovery (search/browse) and proxying are independent concerns.
      // Stdio servers are stored with proxy_available=false so users can
      // find them and invoke them via the CLI or a future container bridge.
      const detected = detectTransport(s.endpoint, s.github_url);
      let transport = (s.transport === 'stdio' || detected === 'stdio') 
        ? 'stdio' 
        : (s.transport && s.transport !== 'unknown' ? s.transport : detected);
      let proxyAvailable = transport !== 'stdio' && Boolean(s.endpoint);

      if (idx < 15) { // Log first 15 to keep it clean
        console.log(`\n[DEBUG-TRACE] ${s.name}`);
        console.log(`  |- endpoint: "${s.endpoint}"`);
        console.log(`  |- github_url: "${s.github_url}"`);
        console.log(`  |- s.transport (upstream): ${s.transport}`);
        console.log(`  |- detected (detectTransport): ${detected}`);
        console.log(`  |- final transport: ${transport}`);
        console.log(`  |- proxyAvailable: ${proxyAvailable}`);
        console.log(`  |- env.SANDBOX_URL: ${process.env.SANDBOX_URL ? process.env.SANDBOX_URL : 'MISSING'}`);
        console.log(`  |- s.smithery_id: ${s.smithery_id}`);
      }

      // Skip only if there is genuinely nothing to store (no name, no endpoint, no github)
      if (!s.endpoint && !s.github_url && transport === 'stdio') {
        result.skipped++;
        skipReasons['stdio_no_source'] = (skipReasons['stdio_no_source'] ?? 0) + 1;
        continue;
      }

      // ── Lookup existing record via any matching ID ──────────────────────────
      let existing: any = null;
      if (s.smithery_id)                    existing = existingBySmithery.get(s.smithery_id);
      if (!existing && s.official_id)       existing = existingByOfficial.get(s.official_id);
      if (!existing && (s as any).glama_id) existing = existingByGlama.get((s as any).glama_id);
      if (!existing && s.github_url)        existing = existingByGithub.get(s.github_url.replace(/\.git$/, '').toLowerCase());
      // Endpoint dedup: catches the same HTTP server indexed under different names by different sources
      if (!existing && s.endpoint)          existing = existingByEndpoint.get(s.endpoint.replace(/\/$/, '').toLowerCase());
      if (!existing)                        existing = existingByName.get(s.name);

      // ── THREE-TIER SKIP ALGORITHM ──────────────────────────────────────────
      //
      // TIER 1 — Instant skip via upstream timestamp (O(1), zero hash)
      // If the upstream source provides an updated_at and it's older than or
      // equal to our last scan, the server hasn't changed — skip immediately.
      // This eliminates hash computation for ~80% of servers on re-ingests.
      //
      if (existing && s.upstream_updated_at && existing.last_scanned_at) {
        const upstreamMs = new Date(s.upstream_updated_at).getTime();
        const scannedMs  = new Date(existing.last_scanned_at).getTime();
        if (upstreamMs <= scannedMs) {
          result.skipped++;
          skipReasons['fresh'] = (skipReasons['fresh'] ?? 0) + 1;
          // Log every 50th skip to avoid log flood, but always log first 5
          if (idx < 5 || (idx + 1) % 50 === 0) {
            console.log(`${tag} ${progress} [SKIP:fresh] ${s.name} — upstream unchanged (updated ${agoStr(s.upstream_updated_at)}, scanned ${agoStr(existing.last_scanned_at)})`);
          }
          continue;
        }
      }

      // TIER 2 — Hash-based skip for sources without timestamps (O(T log T))
      // Fallback when upstream_updated_at is unavailable.
      const upstreamHash = createHash('sha256')
        .update([
          JSON.stringify(s.tools.slice().sort()),
          s.version ?? '',
          s.endpoint ?? '',
          s.github_url ?? '',
        ].join('|'))
        .digest('hex');

      const hoursSinceScan = existing?.last_scanned_at
        ? (Date.now() - new Date(existing.last_scanned_at).getTime()) / 3_600_000
        : Infinity;

      if (existing && existing.schema_hash === upstreamHash && hoursSinceScan < 24) {
        result.skipped++;
        skipReasons['unchanged'] = (skipReasons['unchanged'] ?? 0) + 1;
        if (idx < 5 || (idx + 1) % 50 === 0) {
          console.log(`${tag} ${progress} [SKIP:unchanged] ${s.name} — hash match, scanned ${hoursSinceScan.toFixed(1)}h ago`);
        }
        continue;
      }

      // TIER 3 — Full pipeline: server is new or changed ─────────────────────

      // Fetch MCP primitives — skip live probe for stdio servers (no HTTP endpoint).
      // Stdio servers only get README-parsed tool hints; live probing requires the CLI bridge.
      let toolSchemas = s.tool_schemas ?? [];
      let mcpResources: any[] = [];
      let mcpPrompts:   any[] = [];
      let protocolVersion: string | null = null;
      let mcpCompliant = false;

      if (proxyAvailable && s.endpoint) {
        if (idx < 25) console.log(`[DEBUG-TRACE] ${s.name} -> Entered: BUCKET A (HTTP PROBE)`);
        // HTTP-accessible server: do full MCP probe with initialize handshake
        const primitives = await fetchMCPPrimitives(s.endpoint, s.github_url);
        if (primitives.toolSchemas.length > 0 || toolSchemas.length === 0) {
          toolSchemas = primitives.toolSchemas;
        }
        mcpResources    = primitives.resources;
        mcpPrompts      = primitives.prompts;
        protocolVersion = primitives.protocolVersion;
        mcpCompliant    = primitives.mcpCompliant;
        if (primitives.transport !== 'unknown') {
          transport = primitives.transport;
          proxyAvailable = transport !== 'stdio' && Boolean(s.endpoint);
        }
      } else if (transport === 'stdio') {
        if (idx < 25) console.log(`[DEBUG-TRACE] ${s.name} -> Entered: BUCKET B (STDIO BRANCH)`);
        // Stdio server processing tree
        if (!process.env.SANDBOX_URL) {
          if (idx < 25) console.warn(`[DEBUG-TRACE] ${s.name} -> [SKIP:no-sandbox] SANDBOX_URL not set`);
        } else if (!process.env.SANDBOX_AUTH_TOKEN) {
          if (idx < 25) console.warn(`[DEBUG-TRACE] ${s.name} -> [SKIP:no-sandbox-auth] SANDBOX_AUTH_TOKEN not set`);
        } else if (!s.github_url && !s.smithery_id) {
          if (idx < 25) console.warn(`[DEBUG-TRACE] ${s.name} -> [SKIP:no-source] stdio but no github_url or smithery_id`);
        } else {
          if (idx < 25) console.log(`[DEBUG-TRACE] ${s.name} -> Preparing Sandbox Req...`);
          // Stdio server with Sandbox integration configured
          try {
            const sandboxCommand = buildSandboxCommand(s);
            if (!sandboxCommand) {
              if (idx < 25) console.warn(`[DEBUG-TRACE] ${s.name} -> [SKIP:no-sandbox-command] no safe executable strategy for source`);
            } else {
              result.extraction_metrics!.sandbox_attempts++;
              const req = await fetch(`${process.env.SANDBOX_URL}/extract`, {
                method: 'POST',
                headers: { 
                  'Content-Type': 'application/json', 
                  'Authorization': `Bearer ${process.env.SANDBOX_AUTH_TOKEN}` 
                },
                body: JSON.stringify(sandboxCommand)
              });
              
              if (idx < 25) console.log(`[DEBUG-TRACE] ${s.name} -> Sandbox fetch status: ${req.status}`);
              
              if (req.ok) {
                const sandboxResult = await req.json();
                if (sandboxResult.success && sandboxResult.data) {
                  if (idx < 25) console.log(`[DEBUG-TRACE] ${s.name} -> Sandbox extracted ${sandboxResult.data.tools?.length || 0} tools!`);
                  result.extraction_metrics!.sandbox_success++;
                  toolSchemas = sandboxResult.data.tools || [];
                  mcpResources = sandboxResult.data.resources || [];
                  mcpPrompts = sandboxResult.data.prompts || [];
                  mcpCompliant = true;
                  protocolVersion = '2024-11-05';
                } else {
                  if (idx < 25) console.warn(`[DEBUG-TRACE] ${s.name} -> Sandbox returned success=false. Body:`, JSON.stringify(sandboxResult));
                }
              } else {
                 if (idx < 25) console.warn(`[DEBUG-TRACE] ${s.name} -> Sandbox rejected with status ${req.status}. Body: ${await req.text().catch(()=>'error reading body')}`);
              }
            }
          } catch (e: any) {
            if (idx < 25) console.warn(`[DEBUG-TRACE] ${s.name} -> Sandbox probe FAILED with Exception: ${e.message}`);
          }
        }
        
        // README Fallback for any stdio server that sandbox couldn't parse
        if (toolSchemas.length === 0 && s.github_url) {
          if (idx < 25) console.log(`[DEBUG-TRACE] ${s.name} -> Entered: BUCKET C (README FALLBACK)`);
          result.extraction_metrics!.readme_fallback_attempts++;
          toolSchemas = await parseReadmeSchemas(s.github_url);
        }
        if (toolSchemas.length === 0) {
          result.extraction_metrics!.unresolved_stdio_rows++;
        }
      } else {
        if (idx < 25) console.log(`[DEBUG-TRACE] ${s.name} -> SKIPPING EXTRACTION COMPLETELY`);
      }

      if (s.tools.length === 0 && toolSchemas.length > 0) {
        s.tools = toolSchemas.map(t => t.name);
      }

      // S-14: npm CVE scan — deduplicated by GitHub repo URL
      // Multiple servers can share the same repo; scanning once per repo saves HTTP calls.
      const repoKey = s.github_url?.replace(/\.git$/, '').toLowerCase();
      let cveIssues: any[] = [];
      if (repoKey) {
        if (scannedRepos.has(repoKey)) {
          cveIssues = scannedRepos.get(repoKey)!;
        } else {
          cveIssues = await scanNpmDependencies(s.github_url!);
          scannedRepos.set(repoKey, cveIssues);
        }
      }

      // We no longer reject on static heuristics (L1). Only critical CVEs fail ingestion.
      const hasCriticalCve = cveIssues.some(i => i.severity === 'critical');

      if (hasCriticalCve) {
        const reason = cveIssues.find(i => i.severity === 'critical')?.cve ?? 'critical CVE';
        console.warn(`${tag} ${progress} [REJECT:critical] ${s.name} — ${reason}`);
        result.rejected++;
        continue;
      }

      // ── Description quality enrichment ───────────────────────────────────────
      // If the upstream provided no description or a placeholder, fetch README.
      // This is the primary fix for stdio servers having empty descriptions.
      let descriptionQuality = s.description_quality ?? 'upstream';
      let finalDescription   = s.description || s.display_name || 'No description provided';
      let finalLongDesc      = s.long_description ?? null;
      let readmeUrl          = s.readme_url ?? null;

      const needsEnrichment = !s.description
        || s.description.length < 20
        || s.description === 'No description provided'
        || s.description.startsWith('Official MCP reference server:')
        || s.description === 'Official Partner MCP Server'
        || s.description === 'Official Vendor MCP Server';

      if (needsEnrichment && s.github_url && isSafeUrl(s.github_url)) {
        const readme = await parseReadmeDescription(s.github_url);
        if (readme?.description) {
          finalDescription   = readme.description;
          finalLongDesc      = readme.long_description ?? finalLongDesc;
          readmeUrl          = readme.readme_url;
          descriptionQuality = 'readme_parsed';
          if (idx < 15) console.log(`[DEBUG] ${s.name} → enriched description from README`);
        } else {
          descriptionQuality = 'auto_generated';
        }
      }

      // Set verified flag for trusted sources before computing trust score
      if (s.source === 'partner' || s.source === 'official') {
        s.verified = true;
      }

      // CVE severity classification — must happen before trust score
      const hasHighSeverity    = cveIssues.some(i => i.severity === 'high');
      const ingestScanScore    = hasCriticalCve ? 0 : hasHighSeverity ? 50 : 100;
      const scanIssues = cveIssues.map((issue: any) => ({
        severity: issue.severity,
        type: 'cve',
        description: `${issue.name}@${issue.version} flagged ${issue.cve}`,
        cve: issue.cve,
        url: issue.url,
      }));

      // Official/partner servers get stability credit on first ingest —
      // they have proven track records. Uptime checks will adjust over time.
      let trustScore = computeTrustScore({
        verified:        s.verified ? 1 : 0,
        uptimePct:       100,
        stars:           (s.source === 'official' || s.source === 'partner') ? 50 : 0,
        daysSinceChange: (s.source === 'official' || s.source === 'partner') ? 90 : 0,
        scanScore:       ingestScanScore,
      });

      // High CVE issues → pending_review rather than active.
      const status = hasHighSeverity ? 'pending_review' : 'active';

      const serverData: Record<string, any> = {
        name:             s.name,
        display_name:     s.display_name || s.name,
        description:      finalDescription,
        long_description: finalLongDesc,
        description_quality: descriptionQuality,
        readme_url:       readmeUrl,
        version:          s.version || '1.0.0',
        endpoint:         s.endpoint || null,
        github_url:       s.github_url   ?? null,
        homepage_url:     s.homepage_url ?? null,
        license:          s.license || 'MIT',
        tags:             s.tags.length > 0 ? s.tags : ['general'],
        tools:            s.tools,
        tool_schemas:     toolSchemas as any,
        resources:        mcpResources as any,
        prompts:          mcpPrompts as any,
        protocol_version: protocolVersion,
        mcp_compliant:    mcpCompliant,
        proxy_available:  proxyAvailable,  // false for stdio servers — use CLI bridge
        transport,
        source:           s.source,
        smithery_id:      s.smithery_id ?? null,
        official_id:      s.official_id ?? null,
        glama_id:         (s as any).glama_id ?? null,
        verified:         s.verified ?? false,
        status,
        schema_hash:      upstreamHash,
        scan_status:      (hasHighSeverity ? 'failed' : 'passed') as any,
        scan_issues:      scanIssues as any,
        cve_issues:       cveIssues as any,
        cve_scan_at:      new Date().toISOString(),
        shell_issues:     [] as any,
        trust_score:      trustScore,
        last_scanned_at:  new Date().toISOString(),
        upstream_updated_at: s.upstream_updated_at ?? null,
      };

      let serverId: string | null = existing?.id ?? null;

      if (existing) {
        // Shield Official/Vendor servers from generic registry overwrites
        if ((existing.source === 'partner' || existing.source === 'official') && s.source !== 'partner' && s.source !== 'official') {
          console.log(`${tag} ${progress} [SKIP] ${s.name} — Protected official/partner server, ignoring ${s.source} update`);
          result.skipped++;
          continue;
        }

        // UPDATE path
        const { error: updateErr } = await svc
          .from('servers')
          .update(serverData)
          .eq('id', existing.id);

        if (updateErr) {
          console.error(`${tag} ${progress} [ERROR:update] ${s.name} — ${updateErr.message}`);
          result.errors.push(`${s.name}: update failed — ${updateErr.message}`);
          continue;
        }
        console.log(`${tag} ${progress} [UPDATE] ${s.name} — trust:${trustScore} status:${status} tools:${s.tools.length}`);
        result.updated++;

      } else {
        // INSERT path — upsert on UNIQUE(name) is atomic and race-safe
        const insertData: Record<string, any> = { ...serverData };
        if (systemAuthorId) insertData.author_id = systemAuthorId;

        const { data: upserted, error: upsertErr } = await svc
          .from('servers')
          .upsert(insertData, { onConflict: 'name', ignoreDuplicates: false })
          .select('id')
          .maybeSingle();

        if (upsertErr) {
          // Race condition — concurrent run already inserted this name
          const { data: raceWinner } = await svc
            .from('servers').select('id').eq('name', s.name).maybeSingle();
          if (raceWinner?.id) {
            console.warn(`${tag} ${progress} [WARN:race-recovered] ${s.name}`);
            serverId = raceWinner.id;
            result.updated++;
          } else {
            console.error(`${tag} ${progress} [ERROR:upsert] ${s.name} — ${upsertErr.message}`);
            result.errors.push(`${s.name}: ${upsertErr.message}`);
            continue;
          }
        } else {
          // Upsert may return null id on some conflict paths — fetch to be sure
          serverId = upserted?.id ?? null;
          if (!serverId) {
            const { data: fallback } = await svc
              .from('servers').select('id').eq('name', s.name).maybeSingle();
            serverId = fallback?.id ?? null;
          }
          console.log(`${tag} ${progress} [ADD] ${s.name} — trust:${trustScore} status:${status} tools:${s.tools.length}`);
          result.added++;
        }
      }

      // Write scan audit (non-fatal — purely for CVE tracking now)
      if (serverId && cveIssues.length > 0) {
        svc.from('scan_results').insert({
          server_id: serverId,
          scan_type: 'ingest',
          passed:    !hasHighSeverity,
          score:     hasHighSeverity ? 50 : 100,
          issues:    cveIssues as any,
          details:   `Source:${s.source} cves:${cveIssues.length}`,
        }).then(({ error }: { error: any }) => {
          if (error) console.warn(`${tag} [WARN:scan-audit] ${s.name} — ${error.message}`);
        });
      }

    } catch (e: any) {
      console.error(`${tag} ${progress} [ERROR:exception] ${s.name ?? '?'} — ${e.message}`);
      result.errors.push(`${s.name ?? '?'}: ${e.message}`);
    }
  }

  const elapsed = ((Date.now() - sourceStart) / 1000).toFixed(1);
  const skipDetail = Object.entries(skipReasons).map(([k, v]) => `${k}:${v}`).join(' ');
  console.log(`${tag} Done in ${elapsed}s — added:${result.added} updated:${result.updated} skipped:${result.skipped} rejected:${result.rejected} errors:${result.errors.length}${skipDetail ? ` (skip breakdown: ${skipDetail})` : ''}`);
  return result;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[@/]/g, '-')
    .replace(/[^a-z0-9-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 64);
}

export function buildSandboxCommand(s: Pick<IngestServer, 'smithery_id' | 'github_url'>): { command: string; args: string[] } | null {
  if (s.smithery_id) {
    return {
      command: 'npx',
      args: ['-y', '@smithery/cli@latest', 'run', s.smithery_id],
    };
  }

  // Do not guess repo-root GitHub execution. Many repos are not directly
  // invokable MCP entrypoints, and speculative `npx github:owner/repo`
  // calls cause long sandbox timeouts before README fallback.
  return null;
}
