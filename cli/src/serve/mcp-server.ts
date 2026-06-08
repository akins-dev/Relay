/**
 * mcp-server.ts — Local MCP stdio server for `relay serve`.
 *
 * Reads JSON-RPC from stdin, dispatches to tool handlers, writes responses to stdout.
 * This is the MCP adapter for MCP-native agents — the other side of the same
 * runtime that the CLI adapter uses.
 *
 * Agent hosts start this as:
 *   { "command": "relay", "args": ["serve"] }
 *
 * The agent then sees three tools: search_tools, get_server_manifest, invoke_tool.
 */

import { createInterface } from 'node:readline';
import { RELAY_VERSION, RELAY_CLIENT_NAME } from '../util/config.js';
import {
  LOCAL_MCP_TOOLS,
  handleSearchTools,
  handleGetServerManifest,
  handleInvokeTool,
} from './tools.js';

const MCP_PROTOCOL_VERSION = '2025-03-26';
const SERVER_NAME = RELAY_CLIENT_NAME;

// ── JSON-RPC helpers ───────────────────────────────────────────────────────────

function rpcResponse(id: unknown, result: unknown): string {
  return JSON.stringify({ jsonrpc: '2.0', id, result });
}

function rpcError(id: unknown, code: number, message: string): string {
  return JSON.stringify({ jsonrpc: '2.0', id, error: { code, message } });
}

// ── Instructions ───────────────────────────────────────────────────────────────

const INSTRUCTIONS = [
  'You are connected to Relay Local, a runtime discovery and invocation layer for MCP tools.',
  '',
  'RULES:',
  '1. Before taking action in an external service, call search_tools to find the right server and tool.',
  '2. After searching, use invoke_tool to execute the tool directly. Relay handles the subprocess.',
  '3. For knowledge, reasoning, writing, or calculation tasks, answer directly without searching.',
  '4. Never put credentials in tool arguments. They are resolved from the local environment.',
  '5. Use the inputSchema from search results exactly. Do not guess tool names or arguments.',
  '6. If invoke_tool fails with missing env vars, tell the user which variables to set.',
  '7. Construct search intent with provider/product + operation + resource when those details are known.',
  '8. Use provider/product names only when the user or task context named them. Do not invent provider names.',
].join('\n');

// ── Request handling ───────────────────────────────────────────────────────────

async function handleRequest(raw: string): Promise<string | null> {
  let msg: { jsonrpc?: string; id?: unknown; method?: string; params?: Record<string, unknown> };
  try {
    msg = JSON.parse(raw);
  } catch {
    return rpcError(null, -32700, 'Parse error');
  }

  const { id, method, params } = msg;

  // ── Lifecycle methods ──────────────────────────────────────────────────────

  if (method === 'initialize') {
    return rpcResponse(id, {
      protocolVersion: MCP_PROTOCOL_VERSION,
      capabilities: { tools: { listChanged: false } },
      serverInfo: { name: SERVER_NAME, version: RELAY_VERSION },
      instructions: INSTRUCTIONS,
    });
  }

  if (method === 'notifications/initialized') {
    // Notification — no response
    return null;
  }

  if (method === 'ping') {
    return rpcResponse(id, {});
  }

  // ── Tool methods ───────────────────────────────────────────────────────────

  if (method === 'tools/list') {
    return rpcResponse(id, { tools: LOCAL_MCP_TOOLS });
  }

  if (method === 'tools/call') {
    const toolName = params?.name as string | undefined;
    const toolArgs = (params?.arguments ?? {}) as Record<string, unknown>;

    if (!toolName) {
      return rpcError(id, -32602, 'Missing tool name in params.name');
    }

    try {
      let result: unknown;

      switch (toolName) {
        case 'search_tools':
          result = await handleSearchTools(toolArgs);
          break;
        case 'get_server_manifest':
          result = await handleGetServerManifest(toolArgs);
          break;
        case 'invoke_tool':
          result = await handleInvokeTool(toolArgs);
          break;
        default:
          return rpcError(id, -32601, `Tool not found: ${toolName}`);
      }

      return rpcResponse(id, {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      return rpcError(id, -32000, message);
    }
  }

  return rpcError(id, -32601, `Method not found: ${method}`);
}

// ── Main loop ──────────────────────────────────────────────────────────────────

export function startMcpServer(): void {
  const rl = createInterface({ input: process.stdin });

  // Log to stderr so agents don't parse it
  process.stderr.write(`${SERVER_NAME}: MCP server started (v${RELAY_VERSION})\n`);

  rl.on('line', async (line: string) => {
    const trimmed = line.trim();
    if (!trimmed) return;

    const response = await handleRequest(trimmed);
    if (response !== null) {
      process.stdout.write(response + '\n');
    }
  });

  rl.on('close', () => {
    process.stderr.write(`${SERVER_NAME}: stdin closed, shutting down\n`);
    process.exit(0);
  });

  // Handle parent process signals gracefully
  process.on('SIGINT', () => {
    process.stderr.write(`${SERVER_NAME}: received SIGINT, shutting down\n`);
    process.exit(0);
  });

  process.on('SIGTERM', () => {
    process.stderr.write(`${SERVER_NAME}: received SIGTERM, shutting down\n`);
    process.exit(0);
  });
}
