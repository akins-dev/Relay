/**
 * tools.ts — Local MCP tool definitions and handlers.
 *
 * These tools are exposed when running `relay serve` as a local stdio MCP server.
 * The key difference from Cloud MCP: invoke_tool is available here because
 * execution happens locally through the shared runtime.
 */

import { searchServers, getServerManifest, reportInvokeOutcome } from '../runtime/relay-client.js';
import { invokeTool } from '../runtime/invoke-tool.js';

type RecentIntent = {
  intentHash: string;
  intentText: string;
  seenAt: number;
};

const recentIntentByServerTool = new Map<string, RecentIntent>();
const RECENT_INTENT_TTL_MS = 30 * 60 * 1000;

function recentKey(server: string, tool: string) {
  return `${server}\u0000${tool}`;
}

function rememberSearchIntent(intentText: string, intentHash: string | undefined, response: Awaited<ReturnType<typeof searchServers>>) {
  if (!intentHash) return;
  const now = Date.now();

  for (const [key, value] of recentIntentByServerTool) {
    if (now - value.seenAt > RECENT_INTENT_TTL_MS) recentIntentByServerTool.delete(key);
  }

  for (const server of response.results ?? []) {
    for (const tool of server.tools ?? []) {
      recentIntentByServerTool.set(recentKey(server.name, tool.name), {
        intentHash,
        intentText,
        seenAt: now,
      });
    }
  }
}

function classifyLocalError(err: unknown): 'auth' | 'policy' | 'dlp' | 'upstream' | 'timeout' | null {
  const message = err instanceof Error ? err.message.toLowerCase() : String(err).toLowerCase();
  if (message.includes('timeout') || message.includes('timed out')) return 'timeout';
  if (message.includes('missing required environment') || message.includes('unauthorized') || message.includes('forbidden')) return 'auth';
  if (message.includes('rate limit') || message.includes('policy')) return 'policy';
  return 'upstream';
}

// ── Tool definitions ───────────────────────────────────────────────────────────

export const LOCAL_MCP_TOOLS = [
  {
    name: 'search_tools',
    description: [
      'Search the Relay registry for MCP servers matching your intent.',
      'Call this before taking action in an external service: sending email,',
      'querying databases, creating issues, calling APIs, writing files,',
      'posting messages, or using any capability you do not already have.',
      'Do not call this for questions you can answer from your own knowledge.',
      'After searching, use invoke_tool to execute the tool directly.',
    ].join(' '),
    inputSchema: {
      type: 'object' as const,
      required: ['intent'],
      properties: {
        intent: {
          type: 'string',
          description: [
            'Describe the concrete external action, not just the tool category.',
            'Include provider/product, operation verb, and resource/object when known.',
            'Use provider/product names only when the user or task context named them. Do not invent a provider.',
            'Preserve user domain words such as GitHub, Slack, Postgres, Docker, Brave, file, issue, channel, bucket, or database.',
            'If no provider is known, describe the capability and resource plainly.',
            'Good: "create a GitHub issue from a feature branch"',
            'Good: "query a Postgres database for user records"',
            'Good: "write a file to the local filesystem"',
            'Bad: "email tool" (too vague)',
            'Bad: "use S3" when the user only said "store a file" and did not name S3',
          ].join(' '),
        },
        limit: {
          type: 'number',
          description: 'Max results. Default 5, max 20.',
          default: 5,
        },
      },
    },
  },
  {
    name: 'get_server_manifest',
    description: [
      'Get the full manifest for a server found by search_tools.',
      'Returns package info, launch command, environment requirements, tools, and schemas.',
      'Use this when you need to inspect a server before invoking.',
    ].join(' '),
    inputSchema: {
      type: 'object' as const,
      required: ['server'],
      properties: {
        server: {
          type: 'string',
          description: 'Exact server name from search_tools results.',
        },
      },
    },
  },
  {
    name: 'invoke_tool',
    description: [
      'Execute a tool on an MCP server discovered by search_tools.',
      'Relay handles subprocess management, MCP handshake, environment resolution, and cleanup.',
      'Use the server name and tool name from search_tools results.',
      'Pass arguments matching the inputSchema returned by search_tools.',
    ].join(' '),
    inputSchema: {
      type: 'object' as const,
      required: ['server', 'tool'],
      properties: {
        server: {
          type: 'string',
          description: 'Server name from search_tools results.',
        },
        tool: {
          type: 'string',
          description: 'Tool name from the server tools list.',
        },
        arguments: {
          type: 'object',
          description: 'Tool arguments matching the inputSchema. Pass {} if no arguments needed.',
          default: {},
        },
      },
    },
  },
];

// ── Tool handlers ──────────────────────────────────────────────────────────────

export async function handleSearchTools(args: Record<string, unknown>): Promise<unknown> {
  const intent = String(args.intent ?? '').trim();
  if (!intent) {
    throw new Error('intent is required');
  }

  const limit = Math.min(20, Math.max(1, Number(args.limit ?? 5)));
  const response = await searchServers(intent, limit);
  rememberSearchIntent(intent, response.intent_hash, response);

  return {
    intent,
    intent_hash: response.intent_hash,
    result_count: response.results?.length ?? 0,
    results: (response.results ?? []).map((s) => ({
      name: s.name,
      description: s.description,
      confidence: s.confidence,
      run_mode: s.manifest?.run_mode ?? 'unknown',
      tools: s.tools?.map((t) => ({
        name: t.name,
        description: t.description,
        inputSchema: t.inputSchema,
      })) ?? [],
      env_required: s.manifest?.env?.filter((e) => e.required).map((e) => e.name) ?? [],
      next: `Use invoke_tool with server="${s.name}" and tool="<tool_name>"`,
    })),
    tip: 'Use invoke_tool to execute any tool from the results above.',
  };
}

export async function handleGetServerManifest(args: Record<string, unknown>): Promise<unknown> {
  const serverName = String(args.server ?? '').trim();
  if (!serverName) {
    throw new Error('server is required');
  }

  const data = await getServerManifest(serverName);

  return {
    server: data.server,
    manifest: data.manifest,
    tools: data.tools,
  };
}

export async function handleInvokeTool(args: Record<string, unknown>): Promise<unknown> {
  const start = Date.now();
  const server = String(args.server ?? '').trim();
  const tool = String(args.tool ?? '').trim();
  const toolArgs = (args.arguments ?? {}) as Record<string, unknown>;

  if (!server) throw new Error('server is required');
  if (!tool) throw new Error('tool is required');

  const recent = recentIntentByServerTool.get(recentKey(server, tool));

  try {
    const result = await invokeTool({
      serverName: server,
      toolName: tool,
      args: toolArgs,
    });

    if (recent) {
      void reportInvokeOutcome({
        serverName: server,
        toolName: tool,
        intentHash: recent.intentHash,
        intentText: recent.intentText,
        success: result.success,
        latencyMs: result.latencyMs,
        statusCode: result.success ? 200 : 500,
        errorType: result.success ? null : 'upstream',
      });
    }

    return result;
  } catch (err) {
    if (recent) {
      void reportInvokeOutcome({
        serverName: server,
        toolName: tool,
        intentHash: recent.intentHash,
        intentText: recent.intentText,
        success: false,
        latencyMs: Date.now() - start,
        statusCode: 500,
        errorType: classifyLocalError(err),
      });
    }
    throw err;
  }
}
