import { isSafeUrl } from '@/lib/utils';
/**
 * openMCP — Registry Ingest Pipeline
 *
 * Pulls servers from three upstream sources:
 *   1. Official MCP Registry (registry.modelcontextprotocol.io)
 *   2. Smithery (registry.smithery.ai) — requires SMITHERY_API_KEY
 *   3. Glama (glama.ai/mcp/servers) — 14,274 servers, automated quality checks
 *   4. GitHub MCP servers (github.com/modelcontextprotocol/servers)
 *
 * Every ingested server is:
 *   - Deduplicated by endpoint URL + GitHub repo
 *   - Run through L1 static scan
 *   - Run through npm CVE scan if GitHub URL present
 *   - Trust scored
 *   - Upserted into Supabase
 */

import { scanServer, computeTrustScore, scanNpmDependencies } from '@/lib/security';
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
  source:           'official' | 'smithery' | 'github' | 'glama' | 'direct';
  smithery_id?:     string;
  official_id?:     string;
  glama_id?:        string;
  verified?:        boolean;
  transport?:       'stdio' | 'sse' | 'streamable_http' | 'unknown';
}

/**
 * Fetch full tool schemas from an MCP server's tools/list endpoint.
 * Returns { name, description, inputSchema } per tool.
 * Non-fatal — falls back to empty array on any error.
 */
export async function fetchToolSchemas(endpoint: string): Promise<ToolSchema[]> {
  try {
    if (!isSafeUrl(endpoint)) return [];
    const res = await fetch(endpoint, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }),
      signal:  AbortSignal.timeout(8_000),
    });
    if (!res.ok) return [];
    const data = await res.json();
    const tools = data?.result?.tools ?? data?.tools ?? [];
    return tools
      .map((t: any) => ({
        name:        t.name ?? '',
        description: t.description ?? '',
        inputSchema: t.inputSchema ?? t.input_schema ?? null,
      }))
      .filter((t: ToolSchema) => t.name);
  } catch {
    return [];
  }
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
    const url = cursor
      ? `https://registry.modelcontextprotocol.io/v0/servers?limit=100&cursor=${cursor}`
      : 'https://registry.modelcontextprotocol.io/v0/servers?limit=100';

    const res = await fetch(url, {
      headers: { 'User-Agent': 'openMCP-ingest/0.1' },
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) break;

    const data = await res.json();
    const items = data.servers ?? data.items ?? [];

    for (const s of items) {
      servers.push({
        name:         slugify(s.name ?? s.qualifiedName ?? ''),
        display_name: s.displayName ?? s.name ?? '',
        description:  s.description ?? '',
        endpoint:     s.url ?? s.endpoint ?? '',
        version:      s.version ?? '1.0.0',
        github_url:   s.repository?.url ?? s.githubUrl ?? undefined,
        homepage_url: s.homepage ?? undefined,
        license:      s.license ?? 'MIT',
        tags:         s.tags ?? s.categories ?? [],
        tools:        s.tools?.map((t: any) => t.name ?? t) ?? [],
        tool_schemas: [],
        source:       'official',
        official_id:  s.id ?? s.qualifiedName ?? undefined,
        verified:     s.isVerified ?? false,
      });
    }

    cursor = data.nextCursor ?? data.cursor ?? null;
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
          source:       'direct' as const, // PulseMCP community servers treated as direct
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

  // Resolve system author_id ONCE — not per server (avoids N queries and
  // prevents the insert failing if profiles is empty mid-loop)
  const { data: systemProfile } = await svc
    .from('profiles').select('id').limit(1).maybeSingle();
  const systemAuthorId: string | null = systemProfile?.id ?? null;

  for (const s of servers) {
    try {
      // Skip if name or endpoint missing
      if (!s.name || !s.endpoint) { result.skipped++; continue; }

      // Validate endpoint URL before storing — prevents SSRF via ingest
      if (s.endpoint && !isSafeUrl(s.endpoint)) {
        result.skipped++;
        continue;
      }

      // Skip stdio-only servers — they cannot be invoked through the openMCP proxy
      // stdio servers run as local processes on the developer's machine, not as HTTP endpoints
      // They should be listed on Smithery or run locally — not in a proxy-based registry
      const transport = s.transport ?? detectTransport(s.endpoint, s.github_url);
      if (transport === 'stdio') {
        result.skipped++;
        continue;
      }

      // Sanitise name to registry format
      s.name = slugify(s.name).slice(0, 64);
      if (!s.name || !/^[a-z0-9-]+$/.test(s.name)) { result.skipped++; continue; }

      // L1: Static scan
      const scanResult = scanServer({
        name:        s.name,
        description: s.description || 'No description',
        endpoint:    s.endpoint,
        tools:       s.tools,
        tags:        s.tags,
      });

      // S-14: npm CVE scan (only for servers with GitHub URL)
      let cveIssues: any[] = [];
      if (s.github_url) {
        cveIssues = await scanNpmDependencies(s.github_url);
      }

      // Fetch full tool schemas from the live server (non-fatal)
      // Gives agents inputSchema so they don't have to guess arguments
      let toolSchemas = s.tool_schemas ?? [];
      if (toolSchemas.length === 0 && s.endpoint) {
        toolSchemas = await fetchToolSchemas(s.endpoint);
      }
      // Fallback: parse README for tool names + descriptions
      // Used when server is stdio-only (not reachable as HTTP endpoint)
      if (toolSchemas.length === 0 && s.github_url) {
        toolSchemas = await parseReadmeSchemas(s.github_url);
      }
      // Backfill tool names from schemas if tools array is empty
      if (s.tools.length === 0 && toolSchemas.length > 0) {
        s.tools = toolSchemas.map(t => t.name);
      }

      // Reject on critical scan issues
      const hasCritical = scanResult.issues.some(i => i.severity === 'critical');
      const hasCriticalCve = cveIssues.some(i => i.severity === 'critical');

      if (hasCritical || hasCriticalCve) {
        result.rejected++;
        continue;
      }

      const schemaHash = createHash('sha256')
        .update(JSON.stringify(s.tools.slice().sort()) + s.version + JSON.stringify(toolSchemas))
        .digest('hex');

      const trustScore = computeTrustScore({
        verified:        s.verified ? 1 : 0,
        scanScore:       scanResult.score,
        uptimePct:       100,
        stars:           0,
        daysSinceChange: 0,
      });

      const status = scanResult.passed ? 'active' : 'rejected';

      // Check if server already exists (by name or smithery_id or official_id)
      let existing: any = null;
      if (s.smithery_id) {
        const { data } = await svc.from('servers').select('id, schema_hash').eq('smithery_id', s.smithery_id).maybeSingle();
        existing = data;
      }
      if (!existing && s.official_id) {
        const { data } = await svc.from('servers').select('id, schema_hash').eq('official_id', s.official_id).maybeSingle();
        existing = data;
      }
      if (!existing && (s as any).glama_id) {
        const { data } = await svc.from('servers').select('id, schema_hash').eq('glama_id', (s as any).glama_id).maybeSingle();
        existing = data;
      }
      if (!existing) {
        const { data } = await svc.from('servers').select('id, schema_hash').eq('name', s.name).maybeSingle();
        existing = data;
      }

      const serverData = {
        name:             s.name,
        display_name:     s.display_name || s.name,
        description:      s.description || 'No description provided',
        long_description: s.long_description ?? null,
        version:          s.version,
        endpoint:         s.endpoint,
        github_url:       s.github_url ?? null,
        homepage_url:     s.homepage_url ?? null,
        license:          s.license || 'MIT',
        tags:             s.tags.length > 0 ? s.tags : ['general'],
        tools:            s.tools,
        tool_schemas:     toolSchemas as any,
        transport:        s.transport ?? detectTransport(s.endpoint, s.github_url),
        source:           s.source,
        smithery_id:      s.smithery_id ?? null,
        official_id:      s.official_id ?? null,
        verified:         s.verified ?? false,
        status:           status as any,
        schema_hash:      schemaHash,
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
        // Only write if schema changed — avoids pointless DB writes on every ingest run
        if (existing.schema_hash === schemaHash) { result.skipped++; continue; }

        const { error: updateErr } = await svc
          .from('servers')
          .update(serverData)
          .eq('id', existing.id);

        if (updateErr) {
          result.errors.push(`${s.name}: update failed — ${updateErr.message}`);
          continue;
        }
        result.updated++;

      } else {
        // Atomic upsert on name — prevents duplicate-insert race condition
        // when two ingest jobs run simultaneously (e.g. cron + manual trigger)
        if (!systemAuthorId) {
          result.errors.push(`${s.name}: no system profile found — run 002_seed_data.sql first`);
          continue;
        }

        const { data: inserted, error: insertErr } = await svc
          .from('servers')
          .upsert(
            { ...serverData, author_id: systemAuthorId },
            { onConflict: 'name', ignoreDuplicates: false }
          )
          .select('id')
          .single();

        if (insertErr) {
          result.errors.push(`${s.name}: upsert failed — ${insertErr.message}`);
          continue;
        }

        serverId = inserted?.id ?? null;
        result.added++;
      }

      // Write scan result — now always has a valid server_id
      if (serverId) {
        await svc.from('scan_results').insert({
          server_id: serverId,
          scan_type: 'ingest',
          passed:    scanResult.passed,
          score:     scanResult.score,
          issues:    [...scanResult.issues, ...cveIssues] as any,
          details:   `Ingested from ${s.source}. CVEs found: ${cveIssues.length}.`,
        }).catch(() => {}); // Non-fatal — never block ingest on audit write
      }

    } catch (e: any) {
      result.errors.push(`${s.name}: ${e.message}`);
    }
  }

  return result;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[@/]/g, '-')    // npm scopes: @scope/name → scope-name
    .replace(/[^a-z0-9-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 64);
}
