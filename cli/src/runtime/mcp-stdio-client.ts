/**
 * mcp-stdio-client.ts — MCP-over-stdio protocol client.
 *
 * Speaks JSON-RPC 2.0 over a child process's stdin/stdout.
 * Handles the MCP handshake (initialize + notifications/initialized)
 * and tool calls (tools/call).
 *
 * This is the bridge between Relay Local and downstream MCP servers.
 */

import { createInterface } from 'node:readline';
import type { McpSubprocess } from './subprocess.js';
import { SubprocessError, TimeoutError } from '../util/errors.js';
import { RELAY_CLIENT_NAME, RELAY_VERSION } from '../util/config.js';

const MCP_PROTOCOL_VERSION = '2025-03-26';

interface JsonRpcRequest {
  jsonrpc: '2.0';
  id: number;
  method: string;
  params?: Record<string, unknown>;
}

interface JsonRpcNotification {
  jsonrpc: '2.0';
  method: string;
  params?: Record<string, unknown>;
}

interface JsonRpcResponse {
  jsonrpc: '2.0';
  id: number;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

export class McpStdioClient {
  private nextId = 1;
  private pending = new Map<number, {
    resolve: (value: unknown) => void;
    reject: (reason: unknown) => void;
    timer: ReturnType<typeof setTimeout>;
  }>();
  private lineReader: ReturnType<typeof createInterface> | null = null;

  constructor(
    private sub: McpSubprocess,
    private defaultTimeoutMs = 30_000,
  ) {}

  /**
   * Start reading JSON-RPC responses from the subprocess stdout.
   */
  start(): void {
    this.lineReader = createInterface({ input: this.sub.stdout as NodeJS.ReadableStream });
    this.lineReader.on('line', (line: string) => {
      const trimmed = line.trim();
      if (!trimmed || !trimmed.startsWith('{')) return;

      try {
        const msg = JSON.parse(trimmed) as JsonRpcResponse;
        if (msg.id != null && this.pending.has(msg.id)) {
          const entry = this.pending.get(msg.id)!;
          clearTimeout(entry.timer);
          this.pending.delete(msg.id);
          if (msg.error) {
            entry.reject(new SubprocessError(
              `MCP error ${msg.error.code}: ${msg.error.message}`,
              { mcpError: msg.error },
            ));
          } else {
            entry.resolve(msg.result);
          }
        }
      } catch {
        // Ignore non-JSON lines (stderr leaking, debug output, etc.)
      }
    });
  }

  /**
   * Send a JSON-RPC request and wait for the response.
   */
  private request(method: string, params?: Record<string, unknown>, timeoutMs?: number): Promise<unknown> {
    const id = this.nextId++;
    const timeout = timeoutMs ?? this.defaultTimeoutMs;

    const msg: JsonRpcRequest = { jsonrpc: '2.0', id, method };
    if (params) msg.params = params;

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new TimeoutError(
          `MCP request '${method}' timed out after ${timeout}ms`,
          { method, id },
        ));
      }, timeout);
      timer.unref();

      this.pending.set(id, { resolve, reject, timer });

      try {
        this.sub.stdin.write(JSON.stringify(msg) + '\n');
      } catch (err: unknown) {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(new SubprocessError(
          `Failed to write to MCP server stdin: ${err instanceof Error ? err.message : String(err)}`,
        ));
      }
    });
  }

  /**
   * Send a JSON-RPC notification (no response expected).
   */
  private notify(method: string, params?: Record<string, unknown>): void {
    const msg: JsonRpcNotification = { jsonrpc: '2.0', method };
    if (params) msg.params = params;
    try {
      this.sub.stdin.write(JSON.stringify(msg) + '\n');
    } catch {
      // Fire-and-forget — notification failures are non-fatal
    }
  }

  /**
   * Perform the MCP handshake: initialize + notifications/initialized.
   */
  async initialize(): Promise<{ protocolVersion: string; capabilities: unknown; serverInfo: unknown }> {
    const result = await this.request('initialize', {
      protocolVersion: MCP_PROTOCOL_VERSION,
      capabilities: {},
      clientInfo: { name: RELAY_CLIENT_NAME, version: RELAY_VERSION },
    }, 15_000) as { protocolVersion: string; capabilities: unknown; serverInfo: unknown };

    // Send initialized notification
    this.notify('notifications/initialized');

    return result;
  }

  /**
   * List available tools on the MCP server.
   */
  async listTools(): Promise<Array<{ name: string; description?: string; inputSchema?: unknown }>> {
    const result = await this.request('tools/list') as { tools: Array<{ name: string; description?: string; inputSchema?: unknown }> };
    return result.tools ?? [];
  }

  /**
   * Call a tool on the MCP server.
   */
  async callTool(
    name: string,
    args: Record<string, unknown>,
    timeoutMs?: number,
  ): Promise<{ content: Array<{ type: string; text?: string; [key: string]: unknown }> }> {
    const result = await this.request('tools/call', { name, arguments: args }, timeoutMs) as {
      content: Array<{ type: string; text?: string; [key: string]: unknown }>;
    };
    return result;
  }

  /**
   * Clean up: stop reading, clear pending requests.
   */
  close(): void {
    this.lineReader?.close();
    for (const [id, entry] of this.pending) {
      clearTimeout(entry.timer);
      entry.reject(new SubprocessError('MCP client closed'));
    }
    this.pending.clear();
  }
}
