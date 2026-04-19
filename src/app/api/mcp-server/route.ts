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
 *   search_tools(intent, limit?)  — semantic search returning servers + full schemas
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
import { unstable_after as after }      from 'next/server';
import { createClient }                 from '@/lib/supabase/server';
import { rateLimit, LIMITS }            from '@/lib/ratelimit';
import { SITE_URL }                     from '@/lib/site';
import { BRAND }                        from '@/lib/brand';
import { resolveApiKey }                from '@/lib/auth-server';
import { corsHeaders }                  from '@/lib/utils';
import { executeProxyCall }             from '@/lib/proxy-execute';
import {
  hashIntent, getIntentCache, setIntentCache,
  getIntentBoosts, trimSchemasToIntent, computeConfidence,
  recordSearchEvent, recordInvokeOutcome, classifyError,
  MAX_TOOLS_PER_RESULT,
  type CachedServer,
} from '@/lib/search-analytics';

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
      'Use trust_score > 80 for production. Copy the inputSchema exactly when',
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
      },
    },
  },
];

// ── Request handlers ──────────────────────────────────────────────────────────

async function handleInitialize(id: any) {
  // LEVER 2: The instructions field is injected directly into the agent's system
  // context by the MCP client — not as a tool description but as a persistent
  // behavioral rule that applies across the entire conversation.
  // This is the spec's mechanism for shaping agent posture, not just tool selection.
  const instructions = [
    `You are connected to ${BRAND.name}, a universal MCP tool proxy with access to thousands of verified servers.`,
    '',
    'RULES:',
    '1. Before taking ANY action that affects external systems (email, databases, APIs,',
    '   files, code repositories, messages, payments, or any third-party service),',
    '   call search_tools to find the right server and tool first.',
    '2. Never assume you already have the right tool configured — always search first.',
    '3. Never put credentials, API keys, or tokens in tool arguments.',
    '   Credentials are stored in the vault and injected automatically.',
    '4. For knowledge questions, calculations, writing, or reasoning tasks,',
    '   answer directly from your training — do NOT call search_tools.',
    '5. If invoke_tool returns authentication_required, follow the setup_url',
    '   instructions and inform the user what to configure.',
    '6. If invoke_tool returns confirmation_required, ask the user to confirm',
    '   before resending with the provided X-Confirm-Token.',
    '',
    `Full documentation: ${SITE_URL}${BRAND.agentMdRoute}`,
  ].join('\n');

  return mcpResponse(id, {
    protocolVersion: MCP_VERSION,
    capabilities: { tools: { listChanged: false } },
    serverInfo: {
      name:    SERVER_NAME,
      version: SERVER_VERSION,
    },
    instructions,
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
  const rlConfig = auth?.userId ? LIMITS.proxyAuth : LIMITS.search;
  const rl = await rateLimit(rlKey, rlConfig);
  if (!rl.allowed) return mcpError(id, -32000, 'Rate limit exceeded. Add Authorization: Bearer sk_mcp_... for higher limits (200/min)');

  const intent = String(args?.intent ?? '').trim();
  if (!intent) return mcpError(id, -32602, 'intent is required');

  const limit      = Math.min(Number(args?.limit ?? 5), 20);
  const intentHash = hashIntent(intent);
  const sessionId  = `${ip.slice(0, 8)}:${Date.now().toString(36)}`;

  // ── LEVER 3A: Heuristic intent classifier ────────────────────────────────────
  // Intercepts knowledge queries before touching the database.
  // Teaches agents the correct activation boundary through in-loop feedback.
  // Every no_tool_needed response is logged as a knowledge deflection — this
  // becomes training data for Lever 3B (ML classifier, Sprint 6).
  const KNOWLEDGE_PATTERNS: RegExp[] = [
    /^(what|who|when|where|why|how)\s+(is|are|was|were|does|do|did|has|have|can|could|would|should|will)\b/i,
    /^(explain|define|describe|tell me about|what does .+ mean|what is the difference)\b/i,
    /^(compare|vs\.?|versus|difference between|which is better)\b/i,
    /^(calculate|compute|solve|what is \d|convert \d)/i,
    /^(write|draft|summarize|translate|rewrite|fix|improve|edit)\s+(a |an |the |this |my )?(text|paragraph|sentence|email template|summary|description|copy)\b/i,
    /^(list|name|give me|tell me)\s+(the\s+)?(top|best|main|key|common|example|type)/i,
    /^(history of|background on|overview of|introduction to)\b/i,
  ];
  const ACTION_OVERRIDES: RegExp[] = [
    /\b(send|create|delete|update|fetch|get|post|push|pull|deploy|run|execute|invoke|call|trigger|schedule|notify|email|message|upload|download|save|store|insert|query|search(?! for tools| registry))\b/i,
  ];

  const looksLikeKnowledge = KNOWLEDGE_PATTERNS.some(p => p.test(intent));
  const hasActionOverride  = ACTION_OVERRIDES.some(p => p.test(intent));

  if (looksLikeKnowledge && !hasActionOverride) {
    // Record as knowledge deflection — non-blocking
    after(() => recordSearchEvent({
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
        hint: 'Call search_tools when you need to take action on an external system (send, create, query, update, delete, etc.).',
      }, null, 2) }],
    });
  }

  // ── Intent cache — check before DB query ──────────────────────────────────────
  // Frequent intent→server mappings are cached aggressively.
  // Cache hit: return pre-computed results in ~0ms, skip DB entirely.
  const cached = getIntentCache(intentHash);
  if (cached && cached.servers.length > 0) {
    after(() => recordSearchEvent({
      userId: auth?.userId ?? null, sessionId,
      interface: 'mcp_server', intentText: intent,
      intentClass: 'action', resultCount: cached.servers.length,
      resultServers: cached.servers.map(s => s.server_name),
      topServer: cached.servers[0]?.server_name ?? null,
      topConfidence: cached.servers[0]?.success_rate ?? null,
      cacheHit: true, noToolNeeded: false,
      searchLatencyMs: 0, totalLatencyMs: Date.now() - handlerStart,
    }));

    // Format cached results — these are pre-trimmed server names only.
    // For full schemas, fall through to DB. Cache is a fast-path for known mappings.
    return mcpResponse(id, {
      content: [{ type: 'text', text: JSON.stringify({
        intent,
        results: cached.servers.slice(0, limit).map(s => ({
          name:           s.server_name,
          confidence:     s.success_rate,
          invoke_count:   s.invoke_count,
          avg_latency_ms: s.avg_latency_ms,
          source:         'intent_cache',
          note:           'This server has a strong history of successfully serving this intent. Full schema available on invoke.',
          usage:          `invoke_tool({ server: "${s.server_name}", tool: "${s.tool_name ?? '<tool>'}", args: {...} })`,
        })),
        tip: 'Cache hit — these servers have a proven track record for this intent. Use invoke_tool directly.',
        cache_hit: true,
      }, null, 2) }],
    });
  }

  // ── Full DB search ────────────────────────────────────────────────────────────
  const searchStart = Date.now();
  const supabase    = createClient();

  const { data: results } = await supabase
    .rpc('search_servers', { query_text: intent, result_limit: limit });

  const searchLatencyMs = Date.now() - searchStart;

  if (!results || results.length === 0) {
    after(() => recordSearchEvent({
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
      }, null, 2) }],
    });
  }

  // ── Confidence scoring + historical boost ─────────────────────────────────────
  // Fetch historical success rates for the returned servers (one RPC call for all).
  const serverNames = results.map((s: any) => s.name);
  const boosts      = await getIntentBoosts(intentHash, serverNames);

  // ── Format results with confidence scores and trimmed schemas ─────────────────
  const formatted = results.map((s: any, idx: number) => {
    const boost    = boosts.get(s.name);
    const confidence = computeConfidence({
      rank:         idx,
      totalResults: results.length,
      trustScore:   s.trust_score ?? 50,
      successRate:  boost?.successRate ?? 0,
      invokeCount:  boost?.invokeCount ?? 0,
    });

    // Schema trimming: only return tools relevant to the intent (max 3)
    const rawTools: any[] = (s.tool_schemas?.length ?? 0) > 0
      ? s.tool_schemas
      : (s.tools ?? []).map((t: any) =>
          typeof t === 'string' ? { name: t } : { name: t.name, description: t.description, inputSchema: t.inputSchema }
        );
    const trimmedTools = trimSchemasToIntent(rawTools, intent);

    return {
      name:           s.name,
      display_name:   s.display_name,
      description:    s.description,
      confidence,                              // 0–1 ranking signal for the model
      trust_score:    s.trust_score,
      latency_ms:     boost?.avgLatencyMs ?? s.latency_ms,  // prefer behavioral data
      uptime_pct:     s.uptime_pct,
      source:         s.source ?? 'direct',
      verified:       s.verified,
      scan_status:    s.scan_status,
      invoke_history: boost ? {
        success_rate: Math.round((boost.successRate ?? 0) * 100),
        invoke_count: boost.invokeCount,
      } : null,
      tools:          trimmedTools,
      total_tools:    rawTools.length,         // so agent knows if we trimmed
      proxy_available: s.proxy_available ?? true,
      usage: s.proxy_available === false
        ? `This is a local stdio process. Use: npx -y @${BRAND.slug}/cli invoke ${s.name} <tool_name>`
        : `invoke_tool({ server: "${s.name}", tool: "<tool_name>", args: {...} })`,
      is_new: s.is_new ?? false,
    };
  });

  const topResult = formatted[0];

  // ── Populate intent cache for next time ───────────────────────────────────────
  // Only cache results with reasonable confidence. Low quality results
  // should always re-query so search quality improvements apply immediately.
  if (topResult && topResult.confidence > 0.5) {
    const cacheableServers: CachedServer[] = formatted
      .filter(r => r.confidence > 0.4)
      .map(r => ({
        server_name:    r.name,
        tool_name:      r.tools?.[0]?.name ?? null,
        success_rate:   r.confidence,
        invoke_count:   r.invoke_history?.invoke_count ?? 0,
        avg_latency_ms: r.latency_ms ?? null,
      }));
    setIntentCache(intentHash, cacheableServers);
  }

  // ── Record search event (non-blocking) ────────────────────────────────────────
  after(() => recordSearchEvent({
    userId:       auth?.userId ?? null,
    sessionId,
    interface:    'mcp_server',
    intentText:   intent,
    intentClass:  'action',
    resultCount:  formatted.length,
    resultServers: serverNames,
    topServer:    topResult?.name ?? null,
    topConfidence: topResult?.confidence ?? null,
    cacheHit:     false,
    noToolNeeded: false,
    searchLatencyMs,
    totalLatencyMs: Date.now() - handlerStart,
  }));

  return mcpResponse(id, {
    content: [{ type: 'text', text: JSON.stringify({
      intent,
      results: formatted,
      tip: [
        'Results ordered by confidence (position + trust + history).',
        'Use invoke_tool with the exact server and tool names shown.',
        `Schemas trimmed to ${MAX_TOOLS_PER_RESULT} most relevant tools per server — use total_tools to see if more exist.`,
      ].join(' '),
    }, null, 2) }],
  });
}

async function handleInvokeTool(id: any, args: any, req: NextRequest, ip: string, auth?: { userId: string | null; keyId?: string | null }) {
  const rlKey    = auth?.userId ? `mcp-invoke:user:${auth.userId}` : `mcp-invoke:ip:${ip}`;
  const rlConfig = auth?.userId ? LIMITS.proxyAuth : LIMITS.proxy;
  const rl = await rateLimit(rlKey, rlConfig);
  if (!rl.allowed) return mcpError(id, -32000, 'Rate limit exceeded. Add Authorization: Bearer sk_mcp_... for higher limits (200/min)');

  const { server: serverName, tool: toolName, args: toolArgs } = args ?? {};
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