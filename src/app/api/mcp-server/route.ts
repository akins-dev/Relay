import { NextRequest, NextResponse } from 'next/server';
import { rateLimit, getLimitConfig } from '@/lib/ratelimit';
import { BRAND } from '@/lib/brand';
import { resolveApiKey } from '@/lib/auth-server';
import { corsHeaders } from '@/lib/utils';
import { after } from '@/lib/after';
import { getMcpInitializeInstructions, getRateLimitAuthHint } from '@/lib/agent-guidance';
import { ensureSearchContracts } from '@/lib/runtime-contracts';
import { hashIntent, recordSearchEvent } from '@/lib/search-analytics';
import { classifyIntent } from '@/lib/intent-classifier';
import { runSearch, MAX_TOOLS_PER_RESULT } from '@/lib/search';
import { createClient } from '@/lib/supabase/server';
import { buildRelayManifest } from '@/lib/relay-manifest';

const MCP_VERSION = '2025-03-26';
const SERVER_NAME = BRAND.name;
const SERVER_VERSION = '0.1.0';

const TOOLS = [
  {
    name: 'search_tools',
    description: [
      `Searches the ${BRAND.name} registry and returns MCP servers matching your intent,`,
      `with tool schemas and ${BRAND.cli} run manifests for local invocation.`,
      'Call this before taking action in an external service: sending email,',
      'querying databases, creating issues, calling APIs, writing files,',
      'posting messages, or using any capability the agent does not already have.',
      'Do not call this for questions you can answer from your own knowledge.',
      'Use the returned manifest and inputSchema exactly. Do not guess tool names or arguments.',
    ].join(' '),
    inputSchema: {
      type: 'object',
      required: ['intent'],
      properties: {
        intent: {
          type: 'string',
          description: [
            'Describe what you need to do in plain language, not what tool you want.',
            'Good: "send a transactional email with an order confirmation"',
            'Good: "create a GitHub pull request from a feature branch"',
            'Good: "query a postgres database to get user records"',
            'Bad: "email tool" (too vague)',
          ].join(' '),
        },
        limit: {
          type: 'number',
          description: 'Max results to return. Default 5, max 20.',
          default: 5,
        },
      },
    },
  },
  {
    name: 'get_server_manifest',
    description: [
      `Returns the local ${BRAND.cli} manifest for a server found by search_tools.`,
      'Use this when you need the full package, remote endpoint, environment,',
      'and tool schema details before running a tool locally.',
    ].join(' '),
    inputSchema: {
      type: 'object',
      required: ['server'],
      properties: {
        server: {
          type: 'string',
          description: 'Exact server name from search_tools results. Do not guess.',
        },
      },
    },
  },
];

function mcpResponse(id: any, result: any) {
  return { jsonrpc: '2.0', id, result };
}

function mcpError(id: any, code: number, message: string) {
  return { jsonrpc: '2.0', id, error: { code, message } };
}

function resolveIp(req: NextRequest) {
  const rawIp = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim();
  if (rawIp && rawIp !== 'unknown') return rawIp;
  return `fp:${Buffer.from((req.headers.get('user-agent') ?? '') + (req.headers.get('accept-language') ?? '')).toString('base64').slice(0, 16)}`;
}

async function handleInitialize(id: any) {
  return mcpResponse(id, {
    protocolVersion: MCP_VERSION,
    capabilities: { tools: { listChanged: false } },
    serverInfo: { name: SERVER_NAME, version: SERVER_VERSION },
    instructions: getMcpInitializeInstructions(),
  });
}

async function handleToolsList(id: any) {
  return mcpResponse(id, { tools: TOOLS });
}

async function handleSearchTools(id: any, args: any, ip: string, auth?: { userId: string | null }) {
  const handlerStart = Date.now();
  const rlKey = auth?.userId ? `mcp-search:user:${auth.userId}` : `mcp-search:ip:${ip}`;
  const rlConfig = auth?.userId ? await getLimitConfig('proxyAuth') : await getLimitConfig('search');
  const rl = await rateLimit(rlKey, rlConfig);
  if (!rl.allowed) return mcpError(id, -32000, `Rate limit exceeded. ${getRateLimitAuthHint()}`);

  const intent = String(args?.intent ?? '').trim();
  if (!intent) return mcpError(id, -32602, 'intent is required');

  const parsedLimit = Number(args?.limit ?? 5);
  const limit = Number.isFinite(parsedLimit) ? Math.min(20, Math.max(1, parsedLimit)) : 5;
  const intentHash = hashIntent(intent);
  const searchEventId = crypto.randomUUID();
  const sessionId = `${ip.slice(0, 8)}:${Date.now().toString(36)}`;

  if (classifyIntent(intent) === 'knowledge') {
    after(() => recordSearchEvent({
      searchEventId,
      userId: auth?.userId ?? null,
      sessionId,
      interface: 'mcp_server',
      intentText: intent,
      intentClass: 'knowledge',
      resultCount: 0,
      resultServers: [],
      topServer: null,
      topConfidence: null,
      cacheHit: false,
      noToolNeeded: true,
      searchLatencyMs: 0,
      totalLatencyMs: Date.now() - handlerStart,
    }));

    return mcpResponse(id, {
      content: [{ type: 'text', text: JSON.stringify({
        no_tool_needed: true,
        reason: 'This is a knowledge or reasoning task. Answer directly; no external capability is needed.',
        intent,
        intent_hash: intentHash,
        search_event_id: searchEventId,
      }, null, 2) }],
    });
  }

  const searchResult = await runSearch({ intent, limit, surface: 'mcp', intentHash });
  const formatted = searchResult.results;

  after(() => recordSearchEvent({
    searchEventId,
    userId: auth?.userId ?? null,
    sessionId,
    interface: 'mcp_server',
    intentText: intent,
    intentClass: 'action',
    resultCount: formatted.length,
    resultServers: formatted.map(s => s.name),
    topServer: formatted[0]?.name ?? null,
    topConfidence: formatted[0]?.confidence ?? null,
    cacheHit: searchResult.cacheHit,
    noToolNeeded: false,
    searchLatencyMs: searchResult.searchLatencyMs,
    totalLatencyMs: Date.now() - handlerStart,
  }));

  return mcpResponse(id, {
    content: [{ type: 'text', text: JSON.stringify({
      intent,
      intent_hash: intentHash,
      search_event_id: searchEventId,
      results: formatted,
      tip: [
        searchResult.cacheHit ? 'Cache hit.' : 'Results are ranked for capability fit.',
        `Use ${BRAND.cli} locally with the returned manifest.`,
        `Schemas are trimmed to ${MAX_TOOLS_PER_RESULT} relevant tools per server.`,
      ].join(' '),
      cache_hit: searchResult.cacheHit,
    }, null, 2) }],
  });
}

async function handleGetServerManifest(id: any, args: any, ip: string, auth?: { userId: string | null }) {
  const rlKey = auth?.userId ? `mcp-manifest:user:${auth.userId}` : `mcp-manifest:ip:${ip}`;
  const rlConfig = auth?.userId ? await getLimitConfig('proxyAuth') : await getLimitConfig('search');
  const rl = await rateLimit(rlKey, rlConfig);
  if (!rl.allowed) return mcpError(id, -32000, `Rate limit exceeded. ${getRateLimitAuthHint()}`);

  const serverName = String(args?.server ?? '').trim();
  if (!serverName) return mcpError(id, -32602, 'server is required');

  const { data: server, error } = await createClient()
    .from('servers')
    .select(`
      id, name, display_name, description, version, tags, tools, tool_schemas,
      source, verified, transport, endpoint, package_info, env_var_schema,
      github_url, homepage_url, tool_extraction_source
    `)
    .eq('name', serverName)
    .eq('status', 'active')
    .maybeSingle();

  if (error) return mcpError(id, -32000, `Manifest lookup failed: ${error.message}`);
  if (!server) return mcpError(id, -32602, `Server not found: ${serverName}`);

  return mcpResponse(id, {
    content: [{ type: 'text', text: JSON.stringify({
      server: {
        name: server.name,
        display_name: server.display_name,
        description: server.description,
        source: server.source,
        verified: server.verified,
        transport: server.transport,
        github_url: server.github_url,
        homepage_url: server.homepage_url,
        tool_extraction_source: server.tool_extraction_source ?? 'none',
      },
      manifest: buildRelayManifest(server),
      tools: (server.tool_schemas?.length ?? 0) > 0
        ? server.tool_schemas
        : (server.tools ?? []).map((name: string) => ({ name })),
    }, null, 2) }],
  });
}

async function handleToolsCall(id: any, params: any, req: NextRequest) {
  const { name, arguments: args } = params;
  const ip = resolveIp(req);
  const auth = await resolveApiKey(req);

  if (name === 'search_tools') return handleSearchTools(id, args, ip, auth);
  if (name === 'get_server_manifest') return handleGetServerManifest(id, args, ip, auth);

  return mcpError(id, -32601, `Tool not found: ${name}`);
}

export async function POST(req: NextRequest) {
  try {
    await ensureSearchContracts();
  } catch (e: any) {
    return NextResponse.json(
      { jsonrpc: '2.0', id: null, error: { code: -32000, message: `Runtime contract check failed: ${e?.message ?? 'unknown'}` } },
      { status: 500 }
    );
  }

  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } },
      { status: 400 }
    );
  }

  const { method, id, params } = body;
  const response = method === 'initialize'
    ? await handleInitialize(id)
    : method === 'tools/list'
      ? await handleToolsList(id)
      : method === 'tools/call'
        ? await handleToolsCall(id, params, req)
        : method === 'ping'
          ? mcpResponse(id, {})
          : mcpError(id, -32601, `Method not found: ${method}`);

  return NextResponse.json(response, {
    headers: {
      'Content-Type': 'application/json',
      ...corsHeaders(req.headers.get('origin')),
    },
  });
}

export async function GET(req: NextRequest) {
  const encoder = new TextEncoder();
  const sessionId = crypto.randomUUID();

  const stream = new ReadableStream({
    start(controller) {
      const postEndpoint = new URL(req.url).origin + '/api/mcp-server';
      controller.enqueue(encoder.encode(`event: endpoint\ndata: ${postEndpoint}\n\n`));

      const keepAlive = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(': ka\n\n'));
        } catch {
          clearInterval(keepAlive);
        }
      }, 25_000);

      req.signal.addEventListener('abort', () => {
        clearInterval(keepAlive);
        try { controller.close(); } catch {}
      });
    },
  });

  return new NextResponse(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
      'X-MCP-Server': SERVER_NAME,
      'X-MCP-Version': MCP_VERSION,
      'Mcp-Session-Id': sessionId,
      ...corsHeaders(req.headers.get('origin')),
    },
  });
}

export async function OPTIONS(req: NextRequest) {
  return new NextResponse(null, {
    status: 204,
    headers: corsHeaders(req.headers.get('origin')),
  });
}
