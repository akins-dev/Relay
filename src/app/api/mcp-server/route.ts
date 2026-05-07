/**
 * {BRAND.name} — Native MCP Server
 *
 * Exposes {BRAND.name} itself as a standard MCP server.
 * Agents add ONE connection and get access to every verified server.
 *
 * Transport: StreamableHTTP (primary) + SSE (compatibility)
 * Auth: API key via Authorization: Bearer header (optional for read, required for invoke)
 *
 * Two tools exposed:
 *   search_tools(intent, limit?)  — intent search returning servers + full schemas
 *   invoke_tool(server, tool, args) — proxied through 15-layer security stack
 *
 * Config for Claude Desktop / Cursor / any MCP client:
 * {
 *   "mcpServers": {
 *     "<your-brand-slug>": {
 *       "url": "https://<your-domain>/api/mcp-server"
 *     }
 *   }
 * }
 */

import { NextRequest, NextResponse }   from 'next/server';
import { rateLimit, getLimitConfig }   from '@/lib/ratelimit';
import { BRAND }                        from '@/lib/brand';
import { resolveApiKey }                from '@/lib/auth-server';
import { corsHeaders }                  from '@/lib/utils';
import { after }                        from '@/lib/after';
import { executeProxyCall }             from '@/lib/proxy-execute';
import { getMcpInitializeInstructions, getRateLimitAuthHint } from '@/lib/agent-guidance';
import { ensureRuntimeContracts }       from '@/lib/runtime-contracts';
import { hashIntent, recordSearchEvent } from '@/lib/search-analytics';
import { runSearch, MAX_TOOLS_PER_RESULT } from '@/lib/search';

// ── MCP Protocol constants ────────────────────────────────────────────────────
const MCP_VERSION     = '2025-03-26';
const SERVER_NAME     = BRAND.name;
const SERVER_VERSION  = '0.1.0';

// ── Tool definitions — the entire {BRAND.name} API surface ──────────────────────
//
// LEVER 1: Descriptions encode *when* to use each tool, not just what they do.
// The activation condition ("before taking any real-world action") is explicit.
// The non-activation condition ("not for knowledge questions") is explicit.
// This is the single highest-ROI change for tool-calling reliability.
//
const TOOLS = [
  {
    name: 'search_tools',
    description: [
      // What it does
      `Searches the ${BRAND.name} registry and returns MCP servers matching your intent,`,
      'with full tool schemas (inputSchema) ready to use with invoke_tool.',
      // WHEN to call it — the activation condition
      'Call this BEFORE taking any action that affects external systems:',
      'sending emails, querying databases, creating issues, calling APIs,',
      'writing files, posting messages, processing payments, or interacting',
      'with any service. Always search before you invoke.',
      // WHEN NOT to call it — the non-activation condition
      'Do NOT call this for questions you can answer from your own knowledge',
      '(definitions, explanations, calculations, writing, reasoning tasks).',
      // How to use results
      'Use trust_score >= 65 for production. Copy the inputSchema exactly when',
      'constructing args for invoke_tool.',
    ].join(' '),
    inputSchema: {
      type: 'object',
      required: ['intent'],
      properties: {
        intent: {
          type: 'string',
          description: [
            'Describe what you need to DO in plain language — not what tool you want.',
            'Good: "send a transactional email with an order confirmation"',
            'Good: "create a GitHub pull request from a feature branch"',
            'Good: "query a postgres database to get user records"',
            'Bad: "email tool" (too vague)',
            'Bad: "what is sendgrid" (knowledge question — answer from training)',
          ].join(' '),
        },
        limit: {
          type: 'number',
          description: 'Max results to return. Default 5, max 20. Increase if first results are not a strong match.',
          default: 5,
        },
      },
    },
  },
  {
    name: 'invoke_tool',
    description: [
      // What it does
      `Executes a tool on a verified MCP server through the ${BRAND.name} security proxy.`,
      // Security guarantees — agent should know what it gets for free
      'Every call is automatically: DLP-scanned (blocks leaked credentials),',
      'shell-injection checked, PII-detected, policy-enforced, and audit-logged.',
      'Credentials are vault-injected automatically — never pass API keys in args.',
      // How to use it correctly
      'Use the server name and tool name exactly as returned by search_tools.',
      'Build args by following the inputSchema from search_tools results precisely.',
      // Error handling guidance
      'If you receive authentication_required, follow the setup_url instructions.',
      'If you receive confirmation_required, resend with the X-Confirm-Token header.',
    ].join(' '),
    inputSchema: {
      type: 'object',
      required: ['server', 'tool', 'args'],
      properties: {
        server: {
          type: 'string',
          description: 'Exact server name from search_tools results. E.g. "sendgrid-mail". Do not guess — always use search_tools first.',
        },
        tool: {
          type: 'string',
          description: 'Exact tool name from the server\'s tools list in search_tools results. E.g. "send_email".',
        },
        args: {
          type: 'object',
          description: 'Tool arguments matching the inputSchema exactly. Business data only — no API keys, tokens, or secrets.',
        },
        search_event_id: {
          type: 'string',
          description: 'Optional correlation ID returned by search_tools. Pass it through unchanged so Relay can learn from the search -> invoke chain.',
        },
        intent: {
          type: 'string',
          description: 'Optional original intent string from search_tools. Pass it through unchanged to strengthen Relay ranking feedback.',
        },
      },
    },
  },
];

// ── Request handlers ──────────────────────────────────────────────────────────

async function handleInitialize(id: any) {
  return mcpResponse(id, {
    protocolVersion: MCP_VERSION,
    capabilities: { tools: { listChanged: false } },
    serverInfo: {
      name:    SERVER_NAME,
      version: SERVER_VERSION,
    },
    instructions: getMcpInitializeInstructions(),
  });
}

async function handleToolsList(id: any) {
  return mcpResponse(id, { tools: TOOLS });
}

async function handleToolsCall(id: any, params: any, req: NextRequest) {
  const { name, arguments: args } = params;
  // Never use 'unknown' as a rate limit key — all unknown IPs would share one bucket
  // Use a fingerprint combining multiple headers as fallback
  const rawIp = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim();
  const ip    = rawIp && rawIp !== 'unknown' && rawIp.length > 0
    ? rawIp
    : `fp:${Buffer.from((req.headers.get('user-agent') ?? '') + (req.headers.get('accept-language') ?? '')).toString('base64').slice(0, 16)}`;
  const auth = await resolveApiKey(req);

  if (name === 'search_tools') {
    return handleSearchTools(id, args, ip, auth);
  }
  if (name === 'invoke_tool') {
    return handleInvokeTool(id, args, req, ip, auth);
  }

  return mcpError(id, -32601, `Tool not found: ${name}`);
}

async function handleSearchTools(
  id: any,
  args: any,
  ip: string,
  auth?: { userId: string | null }
) {
  const handlerStart = Date.now();
  const rlKey = auth?.userId ? `mcp-search:user:${auth.userId}` : `mcp-search:ip:${ip}`;
  const rlConfig = auth?.userId ? await getLimitConfig('proxyAuth') : await getLimitConfig('search');
  const rl = await rateLimit(rlKey, rlConfig);
  if (!rl.allowed) return mcpError(id, -32000, `Rate limit exceeded. ${getRateLimitAuthHint()}`);

  const intent = String(args?.intent ?? '').trim();
  if (!intent) return mcpError(id, -32602, 'intent is required');

  const parsedLimit = Number(args?.limit ?? 5);
  const limit = Number.isFinite(parsedLimit)
    ? Math.min(20, Math.max(1, parsedLimit))
    : 5;
  const intentHash = hashIntent(intent);
  const searchEventId = crypto.randomUUID();
  const sessionId  = `${ip.slice(0, 8)}:${Date.now().toString(36)}`;

  // ── LEVER 3A: Heuristic intent classifier ────────────────────────────────────
  // Intercepts knowledge queries before touching the database.
  // Teaches agents the correct activation boundary through in-loop feedback.
  // Every no_tool_needed response is logged as a knowledge deflection — this
  // becomes training data for Lever 3B (ML classifier, Sprint 6).
  const KNOWLEDGE_PATTERNS: RegExp[] = [
    // S10: ^ anchors removed — patterns now match anywhere in the intent string.
    // "I need to know how to send email" was not deflected by ^how because the
    // sentence doesn't start with "how". Anchor-free matching fixes this.
    /(what|who|when|where|why|how)\s+(is|are|was|were|does|do|did|has|have|can|could|would|should|will)\b/i,
    /(explain|define|describe|tell me about|what does .+ mean|what is the difference)\b/i,
    /(compare|vs\.?|versus|difference between|which is better)\b/i,
    /(calculate|compute|solve|what is \d|convert \d)/i,
    /(write|draft|summarize|translate|rewrite|fix|improve|edit)\s+(a |an |the |this |my )?(text|paragraph|sentence|email template|summary|description|copy)\b/i,
    /(list|name|give me|tell me)\s+(the\s+)?(top|best|main|key|common|example|type)/i,
    /(history of|background on|overview of|introduction to)\b/i,
  ];
  const ACTION_OVERRIDES: RegExp[] = [
    /\b(send|create|delete|update|fetch|get|post|push|pull|deploy|run|execute|invoke|call|trigger|schedule|notify|email|message|upload|download|save|store|insert|query|search(?! for tools| registry))\b/i,
  ];

  const looksLikeKnowledge = KNOWLEDGE_PATTERNS.some(p => p.test(intent));
  const hasActionOverride  = ACTION_OVERRIDES.some(p => p.test(intent));

  if (looksLikeKnowledge && !hasActionOverride) {
    // Record as knowledge deflection — non-blocking
    after(() => recordSearchEvent({
      searchEventId,
      userId: auth?.userId ?? null, sessionId,
      interface: 'mcp_server', intentText: intent,
      intentClass: 'knowledge', resultCount: 0,
      resultServers: [], topServer: null, topConfidence: null,
      cacheHit: false, noToolNeeded: true,
      searchLatencyMs: 0, totalLatencyMs: Date.now() - handlerStart,
    }));

    return mcpResponse(id, {
      content: [{ type: 'text', text: JSON.stringify({
        no_tool_needed: true,
        reason: 'This is a knowledge or reasoning task. Answer from your training — no external tool needed.',
        intent,
        intent_hash: intentHash,
        search_event_id: searchEventId,
        hint: 'Call search_tools when you need to take action on an external system (send, create, query, update, delete, etc.).',
      }, null, 2) }],
    });
  }

  // ── S15: Shared search pipeline ───────────────────────────────────────────────
  // Delegates to runSearch() — identical pipeline used by REST surface too.
  const searchResult = await runSearch({ intent, limit, surface: 'mcp', intentHash });
  const { results: formatted, cacheHit, searchLatencyMs } = searchResult;

  if (formatted.length === 0) {
    after(() => recordSearchEvent({
      searchEventId,
      userId: auth?.userId ?? null, sessionId,
      interface: 'mcp_server', intentText: intent,
      intentClass: 'action', resultCount: 0,
      resultServers: [], topServer: null, topConfidence: null,
      cacheHit: false, noToolNeeded: false,
      searchLatencyMs, totalLatencyMs: Date.now() - handlerStart,
    }));

    return mcpResponse(id, {
      content: [{ type: 'text', text: JSON.stringify({
        results: [],
        message: `No servers found for: "${intent}". Try broader terms or check spelling.`,
        intent,
        intent_hash: intentHash,
        search_event_id: searchEventId,
      }, null, 2) }],
    });
  }

  const topResult = formatted[0];

  // ── Record search event (non-blocking) ────────────────────────────────────────
  after(() => recordSearchEvent({
    searchEventId,
    userId:       auth?.userId ?? null,
    sessionId,
    interface:    'mcp_server',
    intentText:   intent,
    intentClass:  'action',
    resultCount:  formatted.length,
    resultServers: formatted.map(s => s.name),
    topServer:    topResult?.name ?? null,
    topConfidence: topResult?.confidence ?? null,
    cacheHit,
    noToolNeeded: false,
    searchLatencyMs,
    totalLatencyMs: Date.now() - handlerStart,
  }));

  return mcpResponse(id, {
    content: [{ type: 'text', text: JSON.stringify({
      intent,
      intent_hash: intentHash,
      search_event_id: searchEventId,
      results: formatted,
      tip: [
        cacheHit
          ? 'Cache hit — server ordering comes from historical success for this intent.'
          : 'Results ordered by confidence (position + trust + history).',
        'Use invoke_tool with the exact server and tool names shown.',
        'Pass search_event_id and intent through to invoke_tool so Relay can learn from successful chains.',
        `Schemas trimmed to ${MAX_TOOLS_PER_RESULT} most relevant tools per server — use total_tools to see if more exist.`,
      ].join(' '),
      cache_hit: cacheHit,
    }, null, 2) }],
  });
}

async function handleInvokeTool(id: any, args: any, req: NextRequest, ip: string, auth?: { userId: string | null; keyId?: string | null }) {
  const rlKey    = auth?.userId ? `mcp-invoke:user:${auth.userId}` : `mcp-invoke:ip:${ip}`;
  const rlConfig = auth?.userId ? await getLimitConfig('proxyAuth') : await getLimitConfig('proxy');
  const rl = await rateLimit(rlKey, rlConfig);
  if (!rl.allowed) return mcpError(id, -32000, `Rate limit exceeded. ${getRateLimitAuthHint()}`);

  const {
    server: serverName,
    tool: toolName,
    args: toolArgs,
    search_event_id: searchEventId,
    intent,
  } = args ?? {};
  if (!serverName || !toolName) {
    return mcpError(id, -32602, 'server and tool are required');
  }

  // Call proxy execution directly — no internal HTTP round-trip
  let result;
  try {
    result = await executeProxyCall({
      serverName,
      toolName,
      rawBody:       JSON.stringify(toolArgs ?? {}),
      callerUserId:  auth?.userId ?? null,
      callerKeyId:   auth?.keyId ?? null,
      ip,
      userAgent:     req.headers.get('user-agent') ?? '',
      confirmHeader: req.headers.get('x-confirm-token'),
      callInterface: 'mcp_server',
      searchEventId: typeof searchEventId === 'string' ? searchEventId : null,
      intentText: typeof intent === 'string' ? intent : undefined,
      intentHash: typeof intent === 'string' ? hashIntent(intent) : undefined,
    });
  } catch (e: any) {
    return mcpError(id, -32000, `Proxy execution failed: ${e.message}`);
  }

  const dlpWarning = result.headers['X-Registry-DLP-Warning'];
  const meta = {
    server:      serverName,
    tool:        toolName,
    trust_score: result.headers['X-Registry-Trust-Score'] ? Number(result.headers['X-Registry-Trust-Score']) : null,
    latency_ms:  result.headers['X-Registry-Latency']     ? Number(result.headers['X-Registry-Latency'])     : null,
    warnings:    dlpWarning ? dlpWarning.split('; ').filter(Boolean) : [],
  };

  // Surface confirmation requirement back to agent
  if (result.status === 202 || result.status === 401) {
    let payload: any = result.body;
    try { payload = JSON.parse(result.body); } catch {}
    return mcpResponse(id, {
      content: [{ type: 'text', text: JSON.stringify({ status: result.status, ...meta, response: payload }, null, 2) }],
    });
  }

  if (result.status >= 400) {
    return mcpError(id, -32000, `Proxy error ${result.status}: ${result.body.replace(/<[^>]*>/g, '').slice(0, 200)}`);
  }

  let parsed: any = result.body;
  try { parsed = JSON.parse(result.body); } catch {}

  return mcpResponse(id, {
    content: [{ type: 'text', text: JSON.stringify({ result: parsed, meta }, null, 2) }],
  });
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function mcpResponse(id: any, result: any) {
  return { jsonrpc: '2.0', id, result };
}

function mcpError(id: any, code: number, message: string) {
  return { jsonrpc: '2.0', id, error: { code, message } };
}

// ── StreamableHTTP transport ──────────────────────────────────────────────────
export async function POST(req: NextRequest) {
  try {
    await ensureRuntimeContracts();
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
  let response: any;

  switch (method) {
    case 'initialize':
      response = await handleInitialize(id);
      break;
    case 'tools/list':
      response = await handleToolsList(id);
      break;
    case 'tools/call':
      response = await handleToolsCall(id, params, req);
      break;
    case 'ping':
      response = mcpResponse(id, {});
      break;
    default:
      response = mcpError(id, -32601, `Method not found: ${method}`);
  }

  return NextResponse.json(response, {
    headers: {
      'Content-Type': 'application/json',
      ...corsHeaders(req.headers.get('origin')),
    },
  });
}

// ── SSE transport (compatibility for 2024-11-05 clients) ─────────────────────
// For Streamable HTTP (2025-03-26) clients the POST handler is sufficient.
// SSE GET is kept for older clients (Claude Desktop pre-2025, some frameworks).
// Per spec: on connect, send the endpoint event then wait for client to POST.
export async function GET(req: NextRequest) {
  const encoder  = new TextEncoder();
  const sessionId = crypto.randomUUID();

  const stream = new ReadableStream({
    start(controller) {
      // Per 2024-11-05 SSE spec: first event must be the POST endpoint URL
      const postEndpoint = new URL(req.url).origin + '/api/mcp-server';
      controller.enqueue(encoder.encode(`event: endpoint\ndata: ${postEndpoint}\n\n`));

      // Keep-alive comments every 25s (Cloudflare drops idle SSE after 30s)
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
      'Content-Type':    'text/event-stream',
      'Cache-Control':   'no-cache, no-transform',
      'Connection':      'keep-alive',
      'X-MCP-Server':    SERVER_NAME,
      'X-MCP-Version':   MCP_VERSION,
      'Mcp-Session-Id':  sessionId,
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
