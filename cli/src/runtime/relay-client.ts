/**
 * relay-client.ts — HTTP client for Relay Cloud API.
 *
 * Pure fetch-based client. No framework dependencies.
 * All Relay Cloud communication goes through this module.
 */

import { getConfig, RELAY_USER_AGENT } from '../util/config.js';
import { NetworkError } from '../util/errors.js';

// ── Types ──────────────────────────────────────────────────────────────────────

export interface SearchResultServer {
  name: string;
  display_name: string | null;
  description: string | null;
  confidence: number;
  trust_score: number | null;
  source: string;
  verified: boolean;
  tools: Array<{
    name: string;
    description?: string;
    inputSchema?: Record<string, unknown>;
  }>;
  total_tools: number;
  transport: string | null;
  manifest: ServerManifest;
  next: string;
}

export interface ServerManifest {
  run_mode: 'local_stdio' | 'remote_mcp' | 'discovery_only';
  runnable: boolean;
  transport: string;
  cli: { command: string; note: string };
  launch: StdioLaunch | RemoteLaunch | null;
  env: EnvVar[];
}

export interface StdioLaunch {
  type: 'stdio';
  package: string | null;
  registry: string | null;
  command: string[];
}

export interface RemoteLaunch {
  type: 'remote';
  transport: string;
  url: string;
}

export interface EnvVar {
  name: string;
  description: string | null;
  required: boolean;
  secret: boolean;
  format: string;
  default: string | null;
  placeholder: string | null;
}

export interface SearchResponse {
  results: SearchResultServer[];
  intent_hash?: string;
  [key: string]: unknown;
}

export interface ServerDetailResponse {
  id: string;
  name: string;
  display_name: string | null;
  description: string | null;
  tools: string[] | null;
  tool_schemas: Array<{
    name: string;
    description?: string;
    inputSchema?: Record<string, unknown>;
  }> | null;
  transport: string | null;
  endpoint: string | null;
  source: string;
  verified: boolean;
  package_info: Array<{
    registryType?: string;
    identifier?: string;
    version?: string;
    runtimeHint?: string;
    transport?: string;
  }> | null;
  env_var_schema: Array<{
    name?: string;
    description?: string;
    isRequired?: boolean;
    isSecret?: boolean;
    defaultValue?: string;
    format?: string;
    placeholder?: string;
  }> | null;
  [key: string]: unknown;
}

export interface ManifestResponse {
  server: {
    name: string;
    display_name: string | null;
    description: string | null;
    source: string;
    verified: boolean;
    transport: string | null;
    github_url: string | null;
    homepage_url: string | null;
    tool_extraction_source: string;
  };
  manifest: ServerManifest;
  tools: Array<{
    name: string;
    description?: string;
    inputSchema?: Record<string, unknown>;
  }>;
}

export interface InvokeOutcomeReport {
  serverName: string;
  toolName: string;
  intentHash: string;
  intentText: string;
  success: boolean;
  latencyMs: number;
  statusCode?: number;
  errorType?: 'auth' | 'policy' | 'dlp' | 'upstream' | 'timeout' | null;
  searchEventId?: string | null;
}

// ── Client ─────────────────────────────────────────────────────────────────────

function buildHeaders(): Record<string, string> {
  const config = getConfig();
  const headers: Record<string, string> = {
    'User-Agent': RELAY_USER_AGENT,
    'Accept': 'application/json',
  };
  if (config.apiKey) {
    headers['Authorization'] = `Bearer ${config.apiKey}`;
  }
  return headers;
}

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(url, {
      ...init,
      headers: { ...buildHeaders(), ...(init?.headers as Record<string, string> ?? {}) },
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new NetworkError(`Failed to connect to Relay Cloud: ${msg}`, { url });
  }

  if (!response.ok) {
    let body = '';
    try { body = await response.text(); } catch {}
    throw new NetworkError(
      `Relay Cloud returned ${response.status}: ${body.slice(0, 200)}`,
      { url, status: response.status },
    );
  }

  try {
    return await response.json() as T;
  } catch {
    throw new NetworkError('Invalid JSON response from Relay Cloud', { url });
  }
}

/**
 * Search for MCP servers by intent.
 */
export async function searchServers(intent: string, limit = 5): Promise<SearchResponse> {
  const config = getConfig();
  const params = new URLSearchParams({ q: intent, limit: String(limit) });
  return fetchJson<SearchResponse>(`${config.apiBase}/api/servers/search?${params}`);
}

/**
 * Get full server details by name.
 */
export async function getServerDetail(name: string): Promise<ServerDetailResponse> {
  const config = getConfig();
  return fetchJson<ServerDetailResponse>(`${config.apiBase}/api/servers/${encodeURIComponent(name)}`);
}

/**
 * Get server manifest via MCP endpoint (JSON-RPC).
 */
const manifestCache = new Map<string, { expiresAt: number; value: ManifestResponse }>();
const MANIFEST_CACHE_TTL_MS = 5 * 60 * 1000;

export async function getServerManifest(serverName: string): Promise<ManifestResponse> {
  const cacheKey = serverName.toLowerCase();
  const cached = manifestCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return cached.value;

  const config = getConfig();
  const rpcBody = {
    jsonrpc: '2.0',
    id: 1,
    method: 'tools/call',
    params: {
      name: 'get_server_manifest',
      arguments: { server: serverName },
    },
  };

  const response = await fetchJson<{ result?: { content?: Array<{ text: string }> }; error?: { message: string } }>(
    `${config.apiBase}/api/mcp-server`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(rpcBody),
    },
  );

  if (response.error) {
    throw new NetworkError(`Manifest lookup failed: ${response.error.message}`, { server: serverName });
  }

  const text = response.result?.content?.[0]?.text;
  if (!text) {
    throw new NetworkError('Empty manifest response', { server: serverName });
  }

  const manifest = JSON.parse(text) as ManifestResponse;
  manifestCache.set(cacheKey, {
    expiresAt: Date.now() + MANIFEST_CACHE_TTL_MS,
    value: manifest,
  });
  return manifest;
}

/**
 * Report a local invocation outcome back to Relay Cloud so future searches can
 * learn which server/tool actually worked for the preceding intent.
 *
 * This is intentionally best-effort. A telemetry/reporting failure must never
 * make the local tool invocation fail.
 */
export async function reportInvokeOutcome(outcome: InvokeOutcomeReport): Promise<void> {
  const config = getConfig();
  if (!config.apiKey) return;

  try {
    await fetchJson(`${config.apiBase}/api/invoke-outcome`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        statusCode:  outcome.statusCode ?? (outcome.success ? 200 : 500),
        errorType:   outcome.errorType ?? null,
        searchEventId: outcome.searchEventId ?? null,
        ...outcome,
      }),
    });
  } catch {
    // Non-fatal. Local invocation result is the source of truth for the caller.
  }
}
