/**
 * tools.ts — Local MCP tool definitions and handlers.
 *
 * These tools are exposed when running `relay serve` as a local stdio MCP server.
 * The key difference from Cloud MCP: invoke_tool is available here because
 * execution happens locally through the shared runtime.
 */

import { searchServers, getServerManifest } from '../runtime/relay-client.js';
import { invokeTool } from '../runtime/invoke-tool.js';

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
            'Describe what you need to do in plain language.',
            'Good: "send a transactional email with an order confirmation"',
            'Good: "create a GitHub pull request from a feature branch"',
            'Bad: "email tool" (too vague)',
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

  return {
    intent,
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
  const server = String(args.server ?? '').trim();
  const tool = String(args.tool ?? '').trim();
  const toolArgs = (args.arguments ?? {}) as Record<string, unknown>;

  if (!server) throw new Error('server is required');
  if (!tool) throw new Error('tool is required');

  const result = await invokeTool({
    serverName: server,
    toolName: tool,
    args: toolArgs,
  });

  return result;
}
