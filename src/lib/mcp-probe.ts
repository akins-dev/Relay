/**
 * mcp-probe.ts
 *
 * Expert-level MCP protocol probe utilities for registry ingest and uptime checks.
 *
 * KEY MCP PROTOCOL FACTS every implementor must know:
 *
 * 1. TRANSPORTS (as of spec 2025-03-26):
 *    - stdio:           Local process. NEVER reachable over HTTP. Registry cannot proxy these.
 *    - SSE:             Legacy HTTP. Server sends SSE stream; client POSTs to a separate endpoint.
 *                       Deprecated in spec 2025-03-26 but still the majority of public servers.
 *    - Streamable HTTP: Current standard. Single endpoint accepts both GET (SSE stream) and POST.
 *                       POST returns either full JSON or streams via SSE depending on Accept header.
 *
 * 2. INITIALIZATION HANDSHAKE (MANDATORY per spec):
 *    Every MCP session MUST start with:
 *      client → POST initialize { protocolVersion, capabilities, clientInfo }
 *      server → { protocolVersion, capabilities, serverInfo }
 *      client → POST initialized {}   (notification, no response expected)
 *    Only THEN can the client call tools/list, resources/list, etc.
 *    Servers following the spec WILL reject any request before initialization.
 *    Skipping this is the #1 mistake in MCP client implementations.
 *
 * 3. THREE PRIMITIVES:
 *    - Tools:     Callable functions with JSON Schema input validation.
 *    - Resources: File-like data contexts (text, binary, URI templates).
 *    - Prompts:   Pre-defined prompt templates with optional arguments.
 *    A complete registry entry should capture all three, not just tools.
 *
 * 4. CAPABILITIES (reported in initialize response):
 *    Server can declare: { tools, resources, prompts, logging, sampling }
 *    Only call tools/list if server.capabilities.tools exists.
 *    Only call resources/list if server.capabilities.resources exists.
 *    Only call prompts/list if server.capabilities.prompts exists.
 *
 * 5. PROTOCOL VERSIONS in the wild:
 *    - "2024-11-05": Original. SSE transport only. Most Smithery/Glama servers.
 *    - "2025-03-26": Current. Streamable HTTP. Official MCP registry servers.
 *    We negotiate by offering the latest and accepting whatever the server returns.
 *
 * 6. SSRF RISKS:
 *    Any endpoint that the registry probes must be validated before contact.
 *    Private IPs (10.x, 192.168.x, 169.254.x) must be blocked.
 *
 * References:
 *   https://modelcontextprotocol.io/specification/2025-03-26/basic/lifecycle
 *   https://modelcontextprotocol.io/specification/2025-03-26/basic/transports
 */

import { isSafeUrl } from '@/lib/utils';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface MCPToolSchema {
  name:         string;
  description?: string;
  inputSchema?: Record<string, any>;
}

export interface MCPResource {
  uri:          string;
  name:         string;
  description?: string;
  mimeType?:    string;
}

export interface MCPPrompt {
  name:         string;
  description?: string;
}

export interface MCPCapabilities {
  tools?:     Record<string, any>;
  resources?: Record<string, any>;
  prompts?:   Record<string, any>;
  logging?:   Record<string, any>;
  sampling?:  Record<string, any>;
}

export type MCPTransport = 'streamable_http' | 'sse' | 'stdio' | 'unknown';

export interface MCPProbeResult {
  /** Whether the server is reachable and speaks MCP */
  alive:           boolean;
  /** Whether the full MCP handshake succeeded */
  mcpCompliant:    boolean;
  /** Protocol version the server responded with */
  protocolVersion: string | null;
  /** Transport type detected */
  transport:       MCPTransport;
  /** Server capabilities from initialize response */
  capabilities:    MCPCapabilities;
  /** Fetched tool schemas (empty if not supported) */
  tools:           MCPToolSchema[];
  /** Resource descriptors (empty if not supported) */
  resources:       MCPResource[];
  /** Prompt descriptors (empty if not supported) */
  prompts:         MCPPrompt[];
  /** Server info from initialize response */
  serverInfo:      { name?: string; version?: string } | null;
  /** Round-trip latency in ms for the initialize call */
  latencyMs:       number;
  /** Human-readable probe status */
  status:          string;
}

// ── Client identity we send in initialize ─────────────────────────────────────

const CLIENT_INFO = {
  name:    'openMCP-registry',
  version: '1.0.0',
};

const CLIENT_CAPABILITIES: MCPCapabilities = {
  // We are a read-only registry probe — we don't support sampling or roots
};

const PROTOCOL_VERSION = '2025-03-26';

// ── Core: MCP Initialization Handshake ───────────────────────────────────────

/**
 * Perform the MCP initialize → initialized handshake.
 * Returns null if the server isn't reachable or doesn't speak MCP.
 *
 * This MUST be called before any tools/list, resources/list, or prompts/list.
 * Servers strictly following the spec will reject requests without this.
 */
async function mcpInitialize(
  endpoint: string,
  timeoutMs = 8_000
): Promise<{
  protocolVersion: string;
  capabilities:    MCPCapabilities;
  serverInfo:      { name?: string; version?: string } | null;
} | null> {
  try {
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept':        'application/json, text/event-stream',
        'User-Agent':    'openMCP-registry/1.0',
        'X-Registry-Probe': 'initialize',
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id:      1,
        method:  'initialize',
        params: {
          protocolVersion: PROTOCOL_VERSION,
          capabilities:    CLIENT_CAPABILITIES,
          clientInfo:      CLIENT_INFO,
        },
      }),
      signal: AbortSignal.timeout(timeoutMs),
    });

    if (!res.ok) return null;

    // Handle both plain JSON and SSE-streamed responses (Streamable HTTP)
    const contentType = res.headers.get('content-type') ?? '';
    let data: any;

    if (contentType.includes('text/event-stream')) {
      // Streamable HTTP: parse first SSE data event
      const text = await res.text();
      const match = text.match(/^data:\s*(.+)$/m);
      if (!match) return null;
      data = JSON.parse(match[1]);
    } else {
      data = await res.json();
    }

    const result = data?.result;
    if (!result?.protocolVersion) return null;

    // Send the required `initialized` notification (fire-and-forget, no response)
    fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type':     'application/json',
        'User-Agent':       'openMCP-registry/1.0',
        'X-Registry-Probe': 'initialized',
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        method:  'notifications/initialized',
        // Notifications have no id
      }),
      signal: AbortSignal.timeout(3_000),
    }).catch(() => {}); // Non-fatal; server may not even respond

    return {
      protocolVersion: result.protocolVersion as string,
      capabilities:    (result.capabilities ?? {}) as MCPCapabilities,
      serverInfo:      result.serverInfo ?? null,
    };
  } catch {
    return null;
  }
}

// ── List helpers (always called AFTER initialize) ─────────────────────────────

async function listTools(endpoint: string, timeoutMs = 8_000): Promise<MCPToolSchema[]> {
  const allTools: MCPToolSchema[] = [];
  let cursor: string | undefined;

  // MCP supports cursor-based pagination on tools/list (nextCursor)
  // Servers with many tools (e.g. filesystem servers) return pages of results.
  do {
    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'User-Agent': 'openMCP-registry/1.0' },
        body: JSON.stringify({
          jsonrpc: '2.0', id: 2, method: 'tools/list',
          params: cursor ? { cursor } : {},
        }),
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (!res.ok) break;
      const data = await res.json();
      const tools: any[] = data?.result?.tools ?? data?.tools ?? [];
      const page = tools
        .map(t => ({
          name:        String(t.name ?? '').trim(),
          description: t.description ?? '',
          inputSchema: t.inputSchema ?? t.input_schema ?? null,
        }))
        .filter(t => t.name && /^[a-zA-Z0-9_-]+$/.test(t.name)); // MCP tool name convention
      allTools.push(...page);
      cursor = data?.result?.nextCursor ?? undefined;
    } catch {
      break;
    }
    // Safety cap: max 500 tools total (avoids unbounded loops on malicious servers)
  } while (cursor && allTools.length < 500);

  return allTools;
}


async function listResources(endpoint: string, timeoutMs = 8_000): Promise<MCPResource[]> {
  try {
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'User-Agent': 'openMCP-registry/1.0' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 3, method: 'resources/list', params: {} }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) return [];
    const data = await res.json();
    const resources: any[] = data?.result?.resources ?? [];
    return resources.map(r => ({
      uri:         r.uri ?? '',
      name:        r.name ?? r.uri ?? '',
      description: r.description ?? '',
      mimeType:    r.mimeType ?? undefined,
    })).filter(r => r.uri);
  } catch {
    return [];
  }
}

async function listPrompts(endpoint: string, timeoutMs = 8_000): Promise<MCPPrompt[]> {
  try {
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'User-Agent': 'openMCP-registry/1.0' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 4, method: 'prompts/list', params: {} }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) return [];
    const data = await res.json();
    const prompts: any[] = data?.result?.prompts ?? [];
    return prompts.map(p => ({
      name:        p.name ?? '',
      description: p.description ?? '',
    })).filter(p => p.name);
  } catch {
    return [];
  }
}

// ── Transport detection (MCP-aware) ───────────────────────────────────────────

/**
 * Detect if endpoint is SSE-based (legacy transport).
 * SSE servers accept GET with Accept: text/event-stream.
 * Streamable HTTP servers accept both GET and POST.
 * stdio servers are unreachable over HTTP by definition.
 */
async function detectTransportFromLiveProbe(
  endpoint: string
): Promise<MCPTransport | null> {
  try {
    // Try SSE GET — if the server opens an event stream, it's SSE or Streamable HTTP
    const res = await fetch(endpoint, {
      method:  'GET',
      headers: { 'Accept': 'text/event-stream', 'User-Agent': 'openMCP-registry/1.0' },
      signal:  AbortSignal.timeout(5_000),
    });
    const ct = res.headers.get('content-type') ?? '';
    if (ct.includes('text/event-stream')) {
      // Streamable HTTP serves SSE for GET AND accepts POST
      // Legacy SSE only serves the stream for GET; POST goes to a /messages endpoint
      return 'streamable_http'; // default assumption for HTTP-accessible MCP servers
    }
    if (res.ok) return 'streamable_http'; // responded to GET — HTTP transport
    return null;
  } catch {
    return null;
  }
}

// ── Main probe entrypoint ─────────────────────────────────────────────────────

/**
 * Full MCP protocol probe.
 *
 * Performs the correct MCP lifecycle:
 *   1. initialize handshake (spec-required)
 *   2. Read capabilities from response
 *   3. Selectively call tools/list, resources/list, prompts/list based on capabilities
 *
 * @param endpoint  The server's HTTP endpoint
 * @param timeoutMs Per-request timeout (default 8s)
 */
export async function probeMCPServer(
  endpoint: string,
  timeoutMs = 8_000
): Promise<MCPProbeResult> {
  const start = Date.now();

  const empty: MCPProbeResult = {
    alive:           false,
    mcpCompliant:    false,
    protocolVersion: null,
    transport:       'unknown',
    capabilities:    {},
    tools:           [],
    resources:       [],
    prompts:         [],
    serverInfo:      null,
    latencyMs:       0,
    status:          'unreachable',
  };

  if (!isSafeUrl(endpoint)) {
    return { ...empty, status: 'blocked:ssrf' };
  }

  // Step 1: MCP initialization handshake
  const init = await mcpInitialize(endpoint, timeoutMs);
  const latencyMs = Date.now() - start;

  if (!init) {
    // Server didn't respond to MCP initialize — check if it's at least HTTP-alive
    const transport = await detectTransportFromLiveProbe(endpoint);
    return {
      ...empty,
      alive:     transport !== null,
      transport: transport ?? 'unknown',
      latencyMs,
      status:    transport ? 'alive:non-mcp' : 'unreachable',
    };
  }

  const { protocolVersion, capabilities, serverInfo } = init;

  // Step 2: Fetch primitives based on capabilities
  // Only call tools/list if server declared tools capability (or if we don't know — try anyway)
  const [tools, resources, prompts] = await Promise.all([
    capabilities.tools !== undefined || Object.keys(capabilities).length === 0
      ? listTools(endpoint, timeoutMs)
      : Promise.resolve([] as MCPToolSchema[]),
    capabilities.resources !== undefined
      ? listResources(endpoint, timeoutMs)
      : Promise.resolve([] as MCPResource[]),
    capabilities.prompts !== undefined
      ? listPrompts(endpoint, timeoutMs)
      : Promise.resolve([] as MCPPrompt[]),
  ]);

  return {
    alive:           true,
    mcpCompliant:    true,
    protocolVersion,
    transport:       'streamable_http',
    capabilities,
    tools,
    resources,
    prompts,
    serverInfo,
    latencyMs,
    status:          `ok:${protocolVersion}`,
  };
}

/**
 * Fast uptime probe — performs only the MCP initialize handshake.
 * Returns { up, latencyMs, mcpCompliant }.
 *
 * Rationale: full tools/list is expensive for 15-min uptime checks.
 * initialize alone proves the server is alive AND speaking MCP.
 */
export async function probeUptime(
  endpoint: string
): Promise<{ up: boolean; latencyMs: number; mcpCompliant: boolean }> {
  if (!isSafeUrl(endpoint)) return { up: false, latencyMs: 0, mcpCompliant: false };

  const start = Date.now();

  // Try MCP initialize first (authoritative: proves server speaks protocol)
  const init = await mcpInitialize(endpoint, 6_000);
  if (init) {
    return { up: true, latencyMs: Date.now() - start, mcpCompliant: true };
  }

  // Fallback 1: HEAD / — server is alive but may not speak MCP
  try {
    const res = await fetch(endpoint, {
      method: 'HEAD',
      headers: { 'User-Agent': 'openMCP-registry/1.0', 'X-Registry-Probe': 'uptime' },
      signal: AbortSignal.timeout(5_000),
    });
    if (res.ok || res.status === 405 || res.status === 401) {
      return { up: true, latencyMs: Date.now() - start, mcpCompliant: false };
    }
  } catch { /* continue */ }

  // Fallback 2: GET /health
  try {
    const healthUrl = endpoint.replace(/\/$/, '') + '/health';
    if (isSafeUrl(healthUrl)) {
      const res = await fetch(healthUrl, {
        signal: AbortSignal.timeout(4_000),
        headers: { 'User-Agent': 'openMCP-registry/1.0' },
      });
      if (res.ok) return { up: true, latencyMs: Date.now() - start, mcpCompliant: false };
    }
  } catch { /* server is down */ }

  return { up: false, latencyMs: Date.now() - start, mcpCompliant: false };
}
