/**
 * invoke-tool.ts — The single shared runtime function.
 *
 * This is the heart of Relay Local. Both the CLI `relay invoke` command
 * and the local MCP `invoke_tool` handler call this same function.
 *
 * Flow:
 *   1. Fetch manifest from Relay Cloud
 *   2. Validate tool exists
 *   3. Check required env vars
 *   4. Route by run_mode (local_stdio | remote_mcp | discovery_only)
 *   5. MCP handshake + tool call
 *   6. Return structured result
 *   7. Clean up subprocess
 */

import { getServerManifest, type ManifestResponse, type ServerManifest } from './relay-client.js';
import { spawnMcpServer, waitForReady } from './subprocess.js';
import { McpStdioClient } from './mcp-stdio-client.js';
import { ConfigError, RelayError, SubprocessError, TimeoutError } from '../util/errors.js';
import { writeStatus } from '../util/output.js';
import { RELAY_CLIENT_NAME, RELAY_VERSION } from '../util/config.js';

// ── Types ──────────────────────────────────────────────────────────────────────

export interface InvokeParams {
  serverName: string;
  toolName: string;
  args: Record<string, unknown>;
  timeoutMs?: number;
  /** Skip the manifest fetch — use this pre-fetched manifest instead. */
  cachedManifest?: ManifestResponse;
}

export interface InvokeResult {
  success: boolean;
  server: string;
  tool: string;
  content: Array<{ type: string; text?: string; [key: string]: unknown }>;
  latencyMs: number;
  run_mode: string;
  error?: string;
}

const SAFE_ENV_ALLOWLIST = [
  'PATH',
  'HOME',
  'USER',
  'USERNAME',
  'SHELL',
  'TMPDIR',
  'TEMP',
  'TMP',
  'SystemRoot',
  'ComSpec',
] as const;

// ── Core function ──────────────────────────────────────────────────────────────

export async function invokeTool(params: InvokeParams): Promise<InvokeResult> {
  const startTime = Date.now();
  const timeoutMs = params.timeoutMs ?? 30_000;

  // 1. Fetch or use cached manifest
  const manifestData = params.cachedManifest ?? await getServerManifest(params.serverName);
  const manifest = manifestData.manifest;
  const tools = manifestData.tools;

  // 2. Validate tool exists
  const toolExists = tools.some((t) => t.name === params.toolName);
  const selectedTool = tools.find((t) => t.name === params.toolName);
  if (!selectedTool) {
    const available = tools.map((t) => t.name).join(', ');
    throw new RelayError(
      `Tool '${params.toolName}' not found on server '${params.serverName}'. Available: ${available || 'none'}`,
      'USAGE',
      { server: params.serverName, tool: params.toolName, available_tools: tools.map((t) => t.name) },
    );
  }

  validateInputSchema(selectedTool.inputSchema, params.args, params.serverName, params.toolName);

  // 3. Check required env vars
  const missingEnv = manifest.env
    .filter((v) => v.required && !process.env[v.name])
    .map((v) => v.name);

  if (missingEnv.length > 0) {
    throw new ConfigError(
      `Missing required environment variables: ${missingEnv.join(', ')}`,
      {
        server: params.serverName,
        missing_env: missingEnv,
        hint: `Set these in your environment before running: ${missingEnv.map((v) => `export ${v}=<value>`).join('; ')}`,
      },
    );
  }

  // 4. Route by run_mode
  switch (manifest.run_mode) {
    case 'local_stdio':
      return invokeLocalStdio(params, manifest, timeoutMs, startTime);

    case 'remote_mcp':
      return invokeRemoteMcp(params, manifest, timeoutMs, startTime);

    case 'discovery_only':
      throw new RelayError(
        `Server '${params.serverName}' is discovery-only — no runnable manifest available. ${manifest.cli.note}`,
        'ERROR',
        {
          server: params.serverName,
          run_mode: 'discovery_only',
          note: manifest.cli.note,
          hint: 'This server was found in the registry but has no package or endpoint Relay can use to launch it.',
        },
      );

    default:
      throw new RelayError(
        `Unknown run_mode '${manifest.run_mode}' for server '${params.serverName}'`,
        'ERROR',
      );
  }
}

function validateInputSchema(
  schema: Record<string, unknown> | undefined,
  args: Record<string, unknown>,
  serverName: string,
  toolName: string,
): void {
  if (!schema || typeof schema !== 'object') return;
  if ((schema as any).type && (schema as any).type !== 'object') return;

  const required = Array.isArray((schema as any).required) ? (schema as any).required as string[] : [];
  const properties = ((schema as any).properties && typeof (schema as any).properties === 'object')
    ? (schema as any).properties as Record<string, any>
    : {};

  const missing = required.filter((key) => args[key] === undefined || args[key] === null);
  if (missing.length > 0) {
    throw new RelayError(
      `Missing required arguments for ${serverName}.${toolName}: ${missing.join(', ')}`,
      'USAGE',
      { server: serverName, tool: toolName, missing_arguments: missing },
    );
  }

  const typeErrors: string[] = [];
  for (const [key, value] of Object.entries(args)) {
    const expected = properties[key]?.type;
    if (!expected || value === null) continue;
    const accepted = Array.isArray(expected) ? expected : [expected];
    if (!accepted.some((type) => jsonSchemaTypeMatches(type, value))) {
      typeErrors.push(`${key} expected ${accepted.join('|')}`);
    }
  }

  if (typeErrors.length > 0) {
    throw new RelayError(
      `Invalid arguments for ${serverName}.${toolName}: ${typeErrors.join(', ')}`,
      'USAGE',
      { server: serverName, tool: toolName, argument_errors: typeErrors },
    );
  }
}

function jsonSchemaTypeMatches(type: string, value: unknown): boolean {
  switch (type) {
    case 'string': return typeof value === 'string';
    case 'number': return typeof value === 'number' && Number.isFinite(value);
    case 'integer': return Number.isInteger(value);
    case 'boolean': return typeof value === 'boolean';
    case 'array': return Array.isArray(value);
    case 'object': return typeof value === 'object' && value !== null && !Array.isArray(value);
    case 'null': return value === null;
    default: return true;
  }
}

function buildChildEnv(manifest: ServerManifest): Record<string, string | undefined> {
  const env: Record<string, string | undefined> = {};
  for (const key of SAFE_ENV_ALLOWLIST) {
    if (process.env[key]) env[key] = process.env[key];
  }
  for (const item of manifest.env) {
    if (process.env[item.name]) env[item.name] = process.env[item.name];
    else if (item.default !== null && item.default !== undefined) env[item.name] = item.default;
  }
  return env;
}

// ── Local stdio invocation ─────────────────────────────────────────────────────

async function invokeLocalStdio(
  params: InvokeParams,
  manifest: ServerManifest,
  timeoutMs: number,
  startTime: number,
): Promise<InvokeResult> {
  const launch = manifest.launch;
  if (!launch || launch.type !== 'stdio' || !launch.command?.length) {
    throw new SubprocessError(
      `Server '${params.serverName}' has run_mode=local_stdio but no valid launch command`,
      { server: params.serverName },
    );
  }

  writeStatus(`spawning ${params.serverName} (${launch.command.join(' ')})`);

  // Spawn the downstream MCP server as a child process
  const sub = spawnMcpServer({
    command: launch.command,
    env: buildChildEnv(manifest),
    timeoutMs: timeoutMs + 5_000, // subprocess timeout slightly longer than tool timeout
  });

  const client = new McpStdioClient(sub, timeoutMs);

  try {
    // Wait for process to be alive
    await waitForReady(sub, 10_000);

    // Start reading JSON-RPC responses
    client.start();

    // MCP handshake
    writeStatus('initializing MCP connection...');
    await client.initialize();

    // Call the tool
    writeStatus(`calling ${params.toolName}...`);
    const result = await client.callTool(params.toolName, params.args, timeoutMs);

    return {
      success: true,
      server: params.serverName,
      tool: params.toolName,
      content: result.content,
      latencyMs: Date.now() - startTime,
      run_mode: 'local_stdio',
    };
  } catch (err: unknown) {
    const latencyMs = Date.now() - startTime;
    if (err instanceof RelayError) {
      throw err;
    }
    throw new SubprocessError(
      `Tool call failed: ${err instanceof Error ? err.message : String(err)}`,
      {
        server: params.serverName,
        tool: params.toolName,
        latencyMs,
        stderr: sub.stderr.slice(-500),
      },
    );
  } finally {
    // Always clean up
    client.close();
    sub.kill();
  }
}

// ── Remote MCP invocation ──────────────────────────────────────────────────────

async function invokeRemoteMcp(
  params: InvokeParams,
  manifest: ServerManifest,
  timeoutMs: number,
  startTime: number,
): Promise<InvokeResult> {
  const launch = manifest.launch;
  if (!launch || launch.type !== 'remote' || !launch.url) {
    throw new RelayError(
      `Server '${params.serverName}' has run_mode=remote_mcp but no endpoint URL`,
      'ERROR',
      { server: params.serverName },
    );
  }

  const isSse = launch.transport === 'sse';
  writeStatus(`connecting to remote ${params.serverName} (${launch.url}) [${isSse ? 'SSE' : 'HTTP'}]`);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    // Shared JSON-RPC payloads
    const initBody = {
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: '2025-03-26',
        capabilities: {},
        clientInfo: { name: RELAY_CLIENT_NAME, version: RELAY_VERSION },
      },
    };

    const callBody = {
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/call',
      params: { name: params.toolName, arguments: params.args },
    };

    if (isSse) {
      return await invokeRemoteSse(launch.url, initBody, callBody, controller, params, timeoutMs, startTime);
    } else {
      return await invokeRemoteHttp(launch.url, initBody, callBody, controller, params, timeoutMs, startTime);
    }
  } catch (err: unknown) {
    if (err instanceof RelayError) throw err;
    if ((err as Error)?.name === 'AbortError') {
      throw new TimeoutError(
        `Remote MCP call timed out after ${timeoutMs}ms`,
        { server: params.serverName, url: launch.url },
      );
    }
    throw new RelayError(
      `Remote MCP call failed: ${err instanceof Error ? err.message : String(err)}`,
      'NETWORK',
      { server: params.serverName, url: launch.url },
    );
  } finally {
    clearTimeout(timeout);
  }
}

// ── Transport implementations ──────────────────────────────────────────────────

async function invokeRemoteHttp(
  url: string,
  initBody: unknown,
  callBody: unknown,
  controller: AbortController,
  params: InvokeParams,
  timeoutMs: number,
  startTime: number,
): Promise<InvokeResult> {
  const initResponse = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(initBody),
    signal: controller.signal,
  });

  if (!initResponse.ok) {
    throw new RelayError(`Remote MCP server returned ${initResponse.status} during initialization`, 'NETWORK', { url, status: initResponse.status });
  }

  fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }),
  }).catch(() => {});

  writeStatus(`calling ${params.toolName}...`);
  const callResponse = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(callBody),
    signal: controller.signal,
  });

  if (!callResponse.ok) {
    throw new RelayError(`Remote MCP tool call returned ${callResponse.status}`, 'NETWORK', { url, status: callResponse.status });
  }

  const callResult = await callResponse.json() as any;

  if (callResult.error) {
    throw new SubprocessError(`Remote MCP error ${callResult.error.code}: ${callResult.error.message}`, { server: params.serverName, mcpError: callResult.error });
  }

  return {
    success: true,
    server: params.serverName,
    tool: params.toolName,
    content: callResult.result?.content ?? [],
    latencyMs: Date.now() - startTime,
    run_mode: 'remote_mcp',
  };
}

async function invokeRemoteSse(
  url: string,
  initBody: unknown,
  callBody: unknown,
  controller: AbortController,
  params: InvokeParams,
  timeoutMs: number,
  startTime: number,
): Promise<InvokeResult> {
  const sseResponse = await fetch(url, {
    method: 'GET',
    headers: { 'Accept': 'text/event-stream' },
    signal: controller.signal,
  });

  if (!sseResponse.ok || !sseResponse.body) {
    throw new RelayError(`Failed to connect to SSE endpoint (HTTP ${sseResponse.status})`, 'NETWORK', { url, status: sseResponse.status });
  }

  const reader = sseResponse.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let postUrl = '';

  let resolveCall!: (value: any) => void;
  let rejectCall!: (reason: any) => void;
  const callPromise = new Promise<any>((resolve, reject) => {
    resolveCall = resolve;
    rejectCall = reject;
  });

  // Read SSE stream in background
  (async () => {
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        
        let boundary = buffer.indexOf('\n\n');
        while (boundary !== -1) {
          const chunk = buffer.slice(0, boundary);
          buffer = buffer.slice(boundary + 2);
          boundary = buffer.indexOf('\n\n');

          let eventType = 'message';
          let data = '';
          for (const line of chunk.split('\n')) {
            if (line.startsWith('event: ')) {
              eventType = line.slice(7).trim();
            } else if (line.startsWith('data: ')) {
              data += line.slice(6) + '\n';
            }
          }
          data = data.trim();

          if (eventType === 'endpoint') {
            // Absolute URL resolution for the POST endpoint
            postUrl = new URL(data, url).toString();
            
            // Fire sequence once endpoint is known
            (async () => {
              try {
                // Initialize
                const initRes = await fetch(postUrl, {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify(initBody),
                  signal: controller.signal,
                });
                if (!initRes.ok) throw new Error(`Initialize POST returned ${initRes.status}`);

                // Initialized notification
                await fetch(postUrl, {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }),
                  signal: controller.signal,
                });

                // Call Tool
                writeStatus(`calling ${params.toolName}...`);
                const callRes = await fetch(postUrl, {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify(callBody),
                  signal: controller.signal,
                });
                if (!callRes.ok) throw new Error(`Call POST returned ${callRes.status}`);
              } catch (err) {
                rejectCall(err);
              }
            })();
          } else if (eventType === 'message' && data) {
            try {
              const parsed = JSON.parse(data);
              // Match response by ID
              if (parsed.id === 2) {
                resolveCall(parsed);
                controller.abort(); // Close the SSE stream
              }
            } catch (e) {
              // Ignore non-JSON messages
            }
          }
        }
      }
    } catch (err: any) {
      if (err.name !== 'AbortError') rejectCall(err);
    }
  })();

  const callResult = await callPromise;
  
  if (callResult.error) {
    throw new SubprocessError(`Remote MCP error ${callResult.error.code}: ${callResult.error.message}`, { server: params.serverName, mcpError: callResult.error });
  }

  return {
    success: true,
    server: params.serverName,
    tool: params.toolName,
    content: callResult.result?.content ?? [],
    latencyMs: Date.now() - startTime,
    run_mode: 'remote_mcp',
  };
}
