import { isSafeUrl } from '@/lib/utils';
/**
 * openMCP — Registry Ingest Pipeline
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

import { scanServer, computeTrustScore, scanNpmDependencies } from '@/lib/security';
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
  source:           'official' | 'smithery' | 'github' | 'glama' | 'pulsemcp' | 'direct';
  smithery_id?:     string;
  official_id?:     string;
  glama_id?:        string;
  verified?:        boolean;
  transport?:       'stdio' | 'sse' | 'streamable_http' | 'unknown';
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
}> {
  const empty = { toolSchemas: [], resources: [], prompts: [], protocolVersion: null, mcpCompliant: false };

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
    };
  }

  return {
    toolSchemas,
    resources:       probe.resources,
    prompts:         probe.prompts,
    protocolVersion: probe.protocolVersion,
    mcpCompliant:    probe.mcpCompliant,
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
    // Convert github.com URL to raw.githubusercontent.com
    const rawUrl = githubUrl
      .replace('github.com', 'raw.githubusercontent.com')
      .replace(/\/tree\/[^/]+/, '')
      + '/main/README.md';

    if (!isSafeUrl(rawUrl)) return [];
    const res = await fetch(rawUrl, {
      headers: { 'User-Agent': 'openMCP-ingest/0.1' },
      signal: AbortSignal.timeout(8_000),
    });
    if (!res.ok) return [];
    const text = await res.text();

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


// ── Official MCP Registry ─────────────────────────────────────────────────────

export async function fetchOfficialServers(): Promise<IngestServer[]> {
  const servers: IngestServer[] = [];
  let cursor: string | null = null;

  do {
    const pageUrl: string = cursor
      ? `https://registry.modelcontextprotocol.io/v0/servers?limit=100&cursor=${cursor}`
      : 'https://registry.modelcontextprotocol.io/v0/servers?limit=100';

    const pageRes: Response = await fetch(pageUrl, {
      headers: { 'User-Agent': 'openMCP-ingest/0.1' },
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
      });
    }

    cursor = pageData.nextCursor ?? pageData.cursor ?? null;
  } while (cursor);

  return servers;
}

// ── Smithery ──────────────────────────────────────────────────────────────────


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
          'User-Agent': 'openMCP-ingest/0.1',
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

      servers.push({
        name,
        display_name: s.displayName ?? name,
        description:  s.description ?? '',
        endpoint:     s.connections?.[0]?.url ?? s.url ?? `https://server.smithery.ai/${s.qualifiedName}`,
        version:      '1.0.0',
        github_url:   s.repository ?? undefined,
        license:      'MIT',
        tags:         s.tags ?? [],
        tools:        s.tools?.map((t: any) => t.name ?? t) ?? [],
        tool_schemas: [],
        source:       'smithery',
        smithery_id:  s.qualifiedName ?? undefined,
        verified:     s.security?.scanPassed ?? false,
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
  // The official MCP servers repo has a well-known README listing servers
  // We pull the JSON manifest if available, otherwise fall back to readme parsing
  try {
    const res = await fetch(
      'https://raw.githubusercontent.com/modelcontextprotocol/servers/main/servers.json',
      { signal: AbortSignal.timeout(10_000) }
    );
    if (!res.ok) return [];
    const data = await res.json();
    return (data.servers ?? []).map((s: any) => ({
      name:         slugify(s.name ?? ''),
      display_name: s.name ?? '',
      description:  s.description ?? '',
      endpoint:     s.url ?? s.endpoint ?? '',
      version:      s.version ?? '1.0.0',
      github_url:   s.repository ?? undefined,
      license:      s.license ?? 'MIT',
      tags:         s.tags ?? [],
      tools:        s.tools ?? [],
      tool_schemas: [],
      source:       'github' as const,
      verified:     true, // GitHub-listed servers are curated
    }));
  } catch {
    return [];
  }
}

// ── Glama ─────────────────────────────────────────────────────────────────────
// 14,274 servers, automated quality checks — best quality signal after official
// Glama validates READMEs, licenses, and runs basic vuln checks before listing

export async function fetchGlamaServers(): Promise<IngestServer[]> {
  const servers: IngestServer[] = [];
  let page = 1;
  const pageSize = 50;

  while (true) {
    try {
      const res = await fetch(
        `https://glama.ai/api/mcp/v1/servers?page=${page}&perPage=${pageSize}`,
        {
          headers: { 'User-Agent': 'openMCP-ingest/0.1', 'Accept': 'application/json' },
          signal: AbortSignal.timeout(15_000),
        }
      );
      if (!res.ok) break;

      const data = await res.json();
      const items: any[] = data.servers ?? data.data ?? [];
      if (items.length === 0) break;

      for (const s of items) {
        const name = slugify(s.name ?? s.id ?? '');
        if (!name) continue;

        servers.push({
          name,
          display_name: s.name ?? name,
          description:  s.description ?? s.shortDescription ?? '',
          endpoint:     s.url ?? s.endpoint ?? s.sseUrl ?? '',
          version:      s.version ?? '1.0.0',
          github_url:   s.repository ?? s.githubUrl ?? undefined,
          homepage_url: s.homepage ?? s.websiteUrl ?? undefined,
          license:      s.license ?? 'MIT',
          tags:         s.tags ?? s.categories ?? [],
          tools:        s.tools?.map((t: any) => t.name ?? t) ?? [],
          tool_schemas: [],
          source:       'glama' as any,
          verified:     s.verified ?? s.isVerified ?? false,
        });
      }

      if (items.length < pageSize) break;
      page++;
      await new Promise(r => setTimeout(r, 300)); // polite rate limiting
    } catch {
      break;
    }
  }

  return servers;
}


// ── PulseMCP ──────────────────────────────────────────────────────────────────
// 11,800+ servers, daily updated, popularity signals, marks official vs community

export async function fetchPulseMCPServers(): Promise<IngestServer[]> {
  const servers: IngestServer[] = [];
  let page = 1;
  const pageSize = 100;

  while (true) {
    try {
      const res = await fetch(
        `https://www.pulsemcp.com/api/servers?page=${page}&limit=${pageSize}`,
        {
          headers: { 'User-Agent': 'openMCP-ingest/0.1', 'Accept': 'application/json' },
          signal: AbortSignal.timeout(15_000),
        }
      );
      if (!res.ok) break;

      const data = await res.json();
      const items: any[] = data.servers ?? data.data ?? data ?? [];
      if (!Array.isArray(items) || items.length === 0) break;

      for (const s of items) {
        const name = slugify(s.name ?? s.title ?? s.id ?? '');
        if (!name) continue;

        servers.push({
          name,
          display_name: s.name ?? s.title ?? name,
          description:  s.description ?? s.shortDescription ?? '',
          endpoint:     s.url ?? s.endpoint ?? s.mcpUrl ?? '',
          version:      s.version ?? '1.0.0',
          github_url:   s.githubUrl ?? s.repository ?? undefined,
          homepage_url: s.websiteUrl ?? s.homepage ?? undefined,
          license:      s.license ?? 'MIT',
          tags:         s.tags ?? s.categories ?? [],
          tools:        s.tools?.map((t: any) => t.name ?? t) ?? [],
          tool_schemas: [],
          source:       'pulsemcp' as const,
          verified:     s.isOfficial ?? s.verified ?? false,
        });
      }

      if (items.length < pageSize) break;
      page++;
      await new Promise(r => setTimeout(r, 300));
    } catch {
      break;
    }
  }

  return servers;
}


/**
 * Detect MCP server transport type from endpoint URL.
 * This determines whether the server is invokable through the openMCP proxy.
 *
 * stdio: local process — cannot be reached over HTTP, excluded from agent search
 * sse | streamable_http: public HTTP endpoint — invokable through proxy
 * unknown: no clear signal — treated as stdio (excluded) until proven otherwise
 */
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
    // StreamableHTTP pattern: /mcp, /api/mcp, /mcp-server
    if (e.includes('/mcp') || e.includes('/sse') || e.includes('/stream')) {
      return 'streamable_http';
    }
    return 'sse'; // default HTTP assumption
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

export async function upsertServers(
  servers: IngestServer[],
  svc: any
): Promise<IngestResult> {
  const result: IngestResult = { added: 0, updated: 0, rejected: 0, skipped: 0, errors: [] };
  const tag = '[ingest:upsert]';
  const skipReasons: Record<string, number> = {};

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
  const { data: allExisting, error: prefetchErr } = await svc
    .from('servers')
    .select('id, name, schema_hash, smithery_id, official_id, glama_id, last_scanned_at');

  if (prefetchErr) {
    console.error(`${tag} Pre-fetch FAILED: ${prefetchErr.message}. Will treat all servers as new.`);
  }

  const existingByName     = new Map<string, any>();
  const existingBySmithery = new Map<string, any>();
  const existingByOfficial = new Map<string, any>();
  const existingByGlama    = new Map<string, any>();

  for (const row of allExisting ?? []) {
    if (row.name)        existingByName.set(row.name, row);
    if (row.smithery_id) existingBySmithery.set(row.smithery_id, row);
    if (row.official_id) existingByOfficial.set(row.official_id, row);
    if (row.glama_id)    existingByGlama.set(row.glama_id, row);
  }

  console.log(`${tag} Pre-fetched ${existingByName.size} existing servers. Processing ${servers.length} incoming...`);

  for (const s of servers) {
    try {
      // Guard: name required
      if (!s.name) { result.skipped++; skipReasons['no_name'] = (skipReasons['no_name'] ?? 0) + 1; continue; }

      // Normalise name first so logging is readable
      s.name = slugify(s.name).slice(0, 64);
      if (!s.name || !/^[a-z0-9-]+$/.test(s.name)) { result.skipped++; skipReasons['invalid_name'] = (skipReasons['invalid_name'] ?? 0) + 1; continue; }

      // SSRF protection
      if (s.endpoint && !isSafeUrl(s.endpoint)) {
        console.warn(`${tag} [SKIP:unsafe-url] ${s.name} endpoint rejected`);
        result.skipped++;
        skipReasons['unsafe_url'] = (skipReasons['unsafe_url'] ?? 0) + 1;
        continue;
      }

      // Classify transport — DO NOT skip stdio servers.
      // Discovery (search/browse) and proxying are independent concerns.
      // Stdio servers are stored with proxy_available=false so users can
      // find them and invoke them via the CLI or a future container bridge.
      const transport = s.transport ?? detectTransport(s.endpoint, s.github_url);
      const proxyAvailable = transport !== 'stdio' && Boolean(s.endpoint);

      // Skip only if there is genuinely nothing to store (no name, no endpoint, no github)
      if (!s.endpoint && !s.github_url && transport === 'stdio') {
        result.skipped++;
        skipReasons['stdio_no_source'] = (skipReasons['stdio_no_source'] ?? 0) + 1;
        continue;
      }

      // Lookup existing record via any matching ID
      let existing: any = null;
      if (s.smithery_id)                    existing = existingBySmithery.get(s.smithery_id);
      if (!existing && s.official_id)       existing = existingByOfficial.get(s.official_id);
      if (!existing && (s as any).glama_id) existing = existingByGlama.get((s as any).glama_id);
      if (!existing)                        existing = existingByName.get(s.name);

      // Upstream hash — lightweight change detection
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

      // Skip: hash unchanged and scanned recently
      if (existing && existing.schema_hash === upstreamHash && hoursSinceScan < 24) {
        result.skipped++;
        skipReasons['unchanged'] = (skipReasons['unchanged'] ?? 0) + 1;
        continue;
      }

      // Fetch MCP primitives — skip live probe for stdio servers (no HTTP endpoint).
      // Stdio servers only get README-parsed tool hints; live probing requires the CLI bridge.
      let toolSchemas = s.tool_schemas ?? [];
      let mcpResources: any[] = [];
      let mcpPrompts:   any[] = [];
      let protocolVersion: string | null = null;
      let mcpCompliant = false;

      if (proxyAvailable && s.endpoint) {
        // HTTP-accessible server: do full MCP probe with initialize handshake
        const primitives = await fetchMCPPrimitives(s.endpoint, s.github_url);
        if (primitives.toolSchemas.length > 0 || toolSchemas.length === 0) {
          toolSchemas = primitives.toolSchemas;
        }
        mcpResources    = primitives.resources;
        mcpPrompts      = primitives.prompts;
        protocolVersion = primitives.protocolVersion;
        mcpCompliant    = primitives.mcpCompliant;
      } else if (transport === 'stdio' && process.env.SANDBOX_URL && (s.github_url || s.smithery_id)) {
        // Stdio server with Sandbox integration configured
        try {
          // Use Smithery's universal runner as a reliable way to execute any GitHub MCP repo
          const target = s.smithery_id || s.github_url;
          const req = await fetch(`${process.env.SANDBOX_URL}/extract`, {
            method: 'POST',
            headers: { 
              'Content-Type': 'application/json', 
              'Authorization': `Bearer ${process.env.SANDBOX_AUTH_TOKEN || 'dev-sandbox-token'}` 
            },
            body: JSON.stringify({
              command: 'npx',
              args: ['-y', '@smithery/cli@latest', 'run', target]
            })
          });
          
          if (req.ok) {
            const result = await req.json();
            if (result.success && result.data) {
              toolSchemas = result.data.tools || [];
              mcpResources = result.data.resources || [];
              mcpPrompts = result.data.prompts || [];
              mcpCompliant = true;
              protocolVersion = '2024-11-05';
              console.log(`${tag} Sandbox extracted ${toolSchemas.length} tools for ${s.name}`);
            }
          } else {
             console.warn(`${tag} Sandbox rejected ${s.name} with status ${req.status}`);
          }
        } catch (e) {
          console.warn(`${tag} Sandbox probe failed for ${s.name}:`, e);
        }
      } else if (toolSchemas.length === 0 && s.github_url) {
        // Stdio/no-endpoint server (NO Sandbox): parse README for tool hints only
        toolSchemas = await parseReadmeSchemas(s.github_url);
      }

      if (s.tools.length === 0 && toolSchemas.length > 0) {
        s.tools = toolSchemas.map(t => t.name);
      }

      // L1: Static security scan
      // CRITICAL FIX: Always provide a fallback description — empty string causes scan
      // to silently score as if the server has no issues but score 0.
      // Also: do NOT hard-reject on 'no_tools' (high severity). Many valid servers
      // only expose tools at runtime (e.g. Smithery stdio wrappers, GitHub-listed servers).
      const scanResult = scanServer({
        name:        s.name,
        description: s.description || s.display_name || 'No description provided',
        endpoint:    s.endpoint,
        tools:       s.tools,
        tags:        s.tags,
      });

      // S-14: npm CVE scan
      let cveIssues: any[] = [];
      if (s.github_url) {
        cveIssues = await scanNpmDependencies(s.github_url);
      }

      // CRITICAL FIX: Only hard-reject CRITICAL issues.
      // Previously, rejecting on 'high' (which includes 'no_tools') caused almost
      // ALL ingested servers to be rejected before being written to the DB.
      const hasCritical    = scanResult.issues.some(i => i.severity === 'critical');
      const hasCriticalCve = cveIssues.some(i => i.severity === 'critical');

      if (hasCritical || hasCriticalCve) {
        const reason = scanResult.issues.find(i => i.severity === 'critical')?.description
          ?? cveIssues.find(i => i.severity === 'critical')?.cve
          ?? 'critical issue';
        console.warn(`${tag} [REJECT:critical] ${s.name} — ${reason}`);
        result.rejected++;
        continue;
      }

      const trustScore = computeTrustScore({
        verified:        s.verified ? 1 : 0,
        scanScore:       scanResult.score,
        uptimePct:       100,
        stars:           0,
        daysSinceChange: 0,
      });

      // High issues → pending_review rather than active.
      // Server is stored for admin review without being surfaced to end users.
      const hasHighSeverity = scanResult.issues.some(i => i.severity === 'high')
        || cveIssues.some(i => i.severity === 'high');
      const status = hasHighSeverity ? 'pending_review' : 'active';

      const serverData: Record<string, any> = {
        name:             s.name,
        display_name:     s.display_name || s.name,
        description:      s.description  || s.display_name || 'No description provided',
        long_description: s.long_description ?? null,
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
        scan_status:      (scanResult.passed ? 'passed' : 'failed') as any,
        scan_issues:      scanResult.issues as any,
        cve_issues:       cveIssues as any,
        cve_scan_at:      new Date().toISOString(),
        shell_issues:     [] as any,
        trust_score:      trustScore,
        last_scanned_at:  new Date().toISOString(),
      };

      let serverId: string | null = existing?.id ?? null;

      if (existing) {
        // UPDATE path
        const { error: updateErr } = await svc
          .from('servers')
          .update(serverData)
          .eq('id', existing.id);

        if (updateErr) {
          console.error(`${tag} [ERROR:update] ${s.name} — ${updateErr.message}`);
          result.errors.push(`${s.name}: update failed — ${updateErr.message}`);
          continue;
        }
        console.log(`${tag} [UPDATE] ${s.name} trust:${trustScore} status:${status}`);
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
            console.warn(`${tag} [WARN:race-recovered] ${s.name}`);
            serverId = raceWinner.id;
            result.updated++;
          } else {
            console.error(`${tag} [ERROR:upsert] ${s.name} — ${upsertErr.message}`);
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
          console.log(`${tag} [ADD] ${s.name} trust:${trustScore} status:${status}`);
          result.added++;
        }
      }

      // Write scan audit (non-fatal — never blocks ingest)
      if (serverId) {
        svc.from('scan_results').insert({
          server_id: serverId,
          scan_type: 'ingest',
          passed:    scanResult.passed,
          score:     scanResult.score,
          issues:    [...scanResult.issues, ...cveIssues] as any,
          details:   `Source:${s.source} score:${scanResult.score} cves:${cveIssues.length}`,
        }).then(({ error }: { error: any }) => {
          if (error) console.warn(`${tag} [WARN:scan-audit] ${s.name} — ${error.message}`);
        });
      }

    } catch (e: any) {
      console.error(`${tag} [ERROR:exception] ${s.name ?? '?'} — ${e.message}`);
      result.errors.push(`${s.name ?? '?'}: ${e.message}`);
    }
  }

  const skipDetail = Object.entries(skipReasons).map(([k, v]) => `${k}:${v}`).join(' ');
  console.log(`${tag} Done — added:${result.added} updated:${result.updated} skipped:${result.skipped} rejected:${result.rejected} errors:${result.errors.length}${skipDetail ? ` (skip breakdown: ${skipDetail})` : ''}`);
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
