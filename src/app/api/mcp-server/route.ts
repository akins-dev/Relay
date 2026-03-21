/**
 * openMCP — Native MCP Server
 *
 * Exposes openMCP itself as a standard MCP server.
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
 *     "openmcp": {
 *       "url": "https://openmcp.dev/api/mcp-server"
 *     }
 *   }
 * }
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient, createServiceClient } from '@/lib/supabase/server';
import {
  dlpScan, shellInjectionScan, piiScan,
  checkElicitationUrl, contextLeakScan, indirectInjectionScan,
} from '@/lib/security';
import { rateLimit, LIMITS } from '@/lib/ratelimit';

// ── Auth helper ──────────────────────────────────────────────────────────────
// API key is optional for search_tools (public) but logged for invoke_tool.
// Authenticated callers get higher rate limits.
async function resolveApiKey(req: NextRequest): Promise<{ userId: string | null; keyId: string | null }> {
  const authHeader = req.headers.get('authorization');
  if (!authHeader?.startsWith('Bearer ')) return { userId: null, keyId: null };

  const token = authHeader.slice(7);
  if (!token.startsWith('sk_mcp_')) return { userId: null, keyId: null };

  try {
    const { createHash } = await import('crypto');
    const keyHash = createHash('sha256').update(token).digest('hex');

    const svc = createServiceClient();
    const { data } = await svc
      .from('api_keys')
      .select('id, user_id')
      .eq('key_hash', keyHash)
      .single();

    if (data) {
      // Update last used (fire-and-forget)
      svc.from('api_keys')
        .update({ last_used_at: new Date().toISOString() })
        .eq('id', data.id)
        .catch(() => {});
      return { userId: data.user_id, keyId: data.id };
    }
  } catch {}
  return { userId: null, keyId: null };
}

// ── MCP Protocol constants ────────────────────────────────────────────────────
const MCP_VERSION     = '2024-11-05';
const SERVER_NAME     = 'openMCP';
const SERVER_VERSION  = '0.1.0';

// ── Tool definitions — the entire openMCP API surface ─────────────────────────
const TOOLS = [
  {
    name: 'search_tools',
    description: [
      'Search the openMCP registry for MCP servers by natural language intent.',
      'Returns verified servers with trust scores and full tool schemas.',
      'Always call this before invoke_tool — use the inputSchema from results to construct arguments.',
      'Prefer servers with trust_score > 80 for production use.',
    ].join(' '),
    inputSchema: {
      type: 'object',
      required: ['intent'],
      properties: {
        intent: {
          type: 'string',
          description: 'Natural language description of what you need. E.g. "send a transactional email" or "create a GitHub pull request".',
        },
        limit: {
          type: 'number',
          description: 'Maximum number of results to return. Default: 5. Max: 20.',
          default: 5,
        },
      },
    },
  },
  {
    name: 'invoke_tool',
    description: [
      'Invoke a tool on a verified MCP server through the openMCP security proxy.',
      'Every call is DLP-scanned, shell-injection checked, PII-scanned, and audited.',
      'Use the inputSchema from search_tools results to construct args correctly.',
      'Never put API keys or secrets in args — credentials are injected automatically.',
    ].join(' '),
    inputSchema: {
      type: 'object',
      required: ['server', 'tool', 'args'],
      properties: {
        server: {
          type: 'string',
          description: 'Server name from search_tools results. E.g. "sendgrid-mail".',
        },
        tool: {
          type: 'string',
          description: 'Tool name from the server\'s tools list. E.g. "send_email".',
        },
        args: {
          type: 'object',
          description: 'Tool arguments matching the inputSchema exactly.',
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
    instructions: 'openMCP gives you access to 7,000+ verified MCP servers. Call search_tools first, then invoke_tool. Read https://openmcp.dev/openmcp.md for full documentation.',
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
    return handleSearchTools(id, args, ip);
  }
  if (name === 'invoke_tool') {
    return handleInvokeTool(id, args, req, ip, auth);
  }

  return mcpError(id, -32601, `Tool not found: ${name}`);
}

async function handleSearchTools(id: any, args: any, ip: string) {
  const rl = await rateLimit(`mcp-search:${ip}`, LIMITS.search);
  if (!rl.allowed) return mcpError(id, -32000, 'Rate limit exceeded. Add Authorization: Bearer sk_mcp_... for higher limits (200/min)');

  const intent = String(args?.intent ?? '').trim();
  if (!intent) return mcpError(id, -32602, 'intent is required');

  const limit = Math.min(Number(args?.limit ?? 5), 20);
  const supabase = createClient();

  const { data: results } = await supabase
    .rpc('search_servers', { query_text: intent, result_limit: limit });

  if (!results || results.length === 0) {
    return mcpResponse(id, {
      content: [{
        type: 'text',
        text: JSON.stringify({
          results: [],
          message: `No servers found for intent: "${intent}". Try broader terms.`,
        }, null, 2),
      }],
    });
  }

  const formatted = results.map((s: any) => ({
    name:         s.name,
    display_name: s.display_name,
    description:  s.description,
    trust_score:  s.trust_score,
    latency_ms:   s.latency_ms,
    uptime_pct:   s.uptime_pct,
    source:       s.source ?? 'direct',
    verified:     s.verified,
    scan_status:  s.scan_status,
    tools: (s.tools ?? []).map((t: any) => (
      typeof t === 'string'
        ? { name: t }
        : { name: t.name, description: t.description, inputSchema: t.inputSchema }
    )),
    usage: `invoke_tool({ server: "${s.name}", tool: "<tool_name>", args: {...} })`,
    credential_note: 'Pass only business data as tool arguments. Never include API keys. The server manages its own credentials.',
    is_new: s.is_new ?? false,
  }));

  return mcpResponse(id, {
    content: [{
      type: 'text',
      text: JSON.stringify({
        intent,
        results: formatted,
        tip: 'Use trust_score > 80 for production. Copy inputSchema exactly for args.',
      }, null, 2),
    }],
  });
}

async function handleInvokeTool(id: any, args: any, req: NextRequest, ip: string, auth?: { userId: string | null }) {
  // Authenticated users get the proxy limit; anonymous callers get search limit
  const rlKey    = auth?.userId ? `mcp-invoke:user:${auth.userId}` : `mcp-invoke:ip:${ip}`;
  const rlConfig = auth?.userId ? LIMITS.proxy : LIMITS.search;
  const rl = await rateLimit(rlKey, rlConfig);
  if (!rl.allowed) return mcpError(id, -32000, 'Rate limit exceeded. Add Authorization: Bearer sk_mcp_... for higher limits (200/min)');

  const { server: serverName, tool: toolName, args: toolArgs } = args ?? {};
  if (!serverName || !toolName) {
    return mcpError(id, -32602, 'server and tool are required');
  }

  const supabase    = createClient();
  const svc         = createServiceClient();
  const start       = Date.now();

  // Resolve server
  const { data: server } = await supabase
    .from('servers')
    .select('id, name, endpoint, tools, trust_score')
    .eq('name', serverName)
    .eq('status', 'active')
    .single();

  if (!server) return mcpError(id, -32602, `Server '${serverName}' not found or not active`);

  const argsStr = JSON.stringify(toolArgs ?? {});

  // S-12: Shell injection scan
  const shellIssues = shellInjectionScan(argsStr);
  if (shellIssues.length > 0) {
    return mcpError(id, -32000, `Blocked: shell injection detected — ${shellIssues[0]}`);
  }

  // L4: DLP on request
  const reqDlp = dlpScan(argsStr);
  if (reqDlp.length > 0) {
    return mcpError(id, -32000, `Blocked: credential pattern in arguments — ${reqDlp[0]}`);
  }

  // Forward to upstream MCP server
  let result: any;
  try {
    const upstream = await fetch(`${server.endpoint}/tools/call`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: toolName, arguments: toolArgs ?? {} }),
      signal: AbortSignal.timeout(30_000),
    });

    const body = await upstream.text();

    // L4: DLP on response
    const resDlp      = dlpScan(body);
    const piiIssues   = piiScan(body);
    const leakIssues  = contextLeakScan(body);
    const indirIssues = indirectInjectionScan(body);
    const allIssues   = [...resDlp, ...piiIssues, ...leakIssues, ...indirIssues];

    // Audit log
    await svc.from('audit_log').insert({
      server_id:     server.id,
      action:        'mcp_server_invoke',
      tool_name:     toolName,
      request_size:  argsStr.length,
      response_size: body.length,
      latency_ms:    Date.now() - start,
      status_code:   upstream.status,
      dlp_triggered: allIssues.length > 0,
      dlp_issues:    allIssues,
      ip,
      user_agent:    req.headers.get('user-agent') || '',
    }).catch(() => {});

    // Metering event
    svc.from('metering_events').insert({
      server_id:      server.id,
      user_id:        auth?.userId ?? null,
      tool_name:      toolName,
      interface:      'mcp_server',
      request_bytes:  argsStr.length,
      response_bytes: body.length,
      latency_ms:     Date.now() - start,
      status_code:    upstream.status,
      dlp_triggered:  allIssues.length > 0,
    }).catch(() => {});

    // Increment call counters
    svc.rpc('increment_calls', { server_id: server.id }).catch(() => {});

    if (!upstream.ok) {
      return mcpError(id, -32000, `Upstream error ${upstream.status}: ${body.slice(0, 200)}`);
    }

    result = JSON.parse(body);
  } catch (e: any) {
    return mcpError(id, -32000, `Upstream connection failed: ${e.message}`);
  }

  return mcpResponse(id, {
    content: [{
      type: 'text',
      text: JSON.stringify({
        result,
        meta: {
          server:      serverName,
          tool:        toolName,
          trust_score: server.trust_score,
          latency_ms:  Date.now() - start,
          security:    'DLP + shell injection + PII scanned',
        },
      }, null, 2),
    }],
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
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    },
  });
}

// ── SSE transport (compatibility for older MCP clients) ───────────────────────
export async function GET(req: NextRequest) {
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    start(controller) {
      // Send server capabilities on connect
      const capabilities = {
        jsonrpc: '2.0',
        method: 'notifications/initialized',
        params: {
          serverInfo:  { name: SERVER_NAME, version: SERVER_VERSION },
          tools:       TOOLS,
          instructions: 'openMCP — search_tools then invoke_tool. Read /openmcp.md for full docs.',
        },
      };
      controller.enqueue(encoder.encode(`data: ${JSON.stringify(capabilities)}\n\n`));

      // Keep alive every 30s
      const keepAlive = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(': keepalive\n\n'));
        } catch {
          clearInterval(keepAlive);
        }
      }, 30_000);

      req.signal.addEventListener('abort', () => {
        clearInterval(keepAlive);
        controller.close();
      });
    },
  });

  return new NextResponse(stream, {
    headers: {
      'Content-Type':                'text/event-stream',
      'Cache-Control':               'no-cache',
      'Connection':                  'keep-alive',
      'Access-Control-Allow-Origin': '*',
      'X-MCP-Server':                SERVER_NAME,
      'X-MCP-Version':               MCP_VERSION,
    },
  });
}

export async function OPTIONS() {
  return new NextResponse(null, {
    headers: {
      'Access-Control-Allow-Origin':  '*',
      'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    },
  });
}
