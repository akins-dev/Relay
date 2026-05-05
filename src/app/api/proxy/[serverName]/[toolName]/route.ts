/**
 * Security Proxy Route
 *
 * All security logic now lives in src/lib/proxy-execute.ts so it can be
 * called directly by the native MCP server (invoke_tool) without an internal
 * HTTP round-trip. This route is a thin wrapper that:
 *   1. Resolves auth (session cookie or API key)
 *   2. Rate limits the caller
 *   3. Delegates to executeProxyCall()
 *   4. Returns the response with CORS headers
 */
import { NextRequest, NextResponse } from 'next/server';
import { createClient }              from '@/lib/supabase/server';
import { rateLimit, LIMITS, getLimitConfig }         from '@/lib/ratelimit';
import { extractIp }                 from '@/lib/api';
import { corsHeaders }               from '@/lib/utils';
import { BRAND }                     from '@/lib/brand';
import { SITE_URL }                  from '@/lib/site';
import { resolveApiKey }             from '@/lib/auth-server';
import { executeProxyCall }          from '@/lib/proxy-execute';
import { getRateLimitAuthHint }      from '@/lib/agent-guidance';
import { dlpScan, shellInjectionScan } from '@/lib/security';

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ serverName: string; toolName: string }> }
) {
  const { serverName, toolName } = await params;
  const ip       = extractIp(req);
  const supabase = createClient();

  // Resolve caller
  const apiKey = await resolveApiKey(req);
  const { data: { user: sessionUser } } = await supabase.auth.getUser().catch(() => ({ data: { user: null } }));

  if (sessionUser && apiKey.userId && sessionUser.id !== apiKey.userId) {
    return NextResponse.json(
      { error: 'Authorization API key does not match the current session' },
      { status: 401 }
    );
  }

  const callerUserId = sessionUser?.id ?? apiKey.userId;

  // Rate limit
  const rlKey    = callerUserId ? `proxy:user:${callerUserId}` : `proxy:ip:${ip}`;
  const rlConfig = callerUserId ? await getLimitConfig('proxyAuth') : await getLimitConfig('proxy');
  const rl = await rateLimit(rlKey, rlConfig);
  if (!rl.allowed) {
    return NextResponse.json(
      { error: 'Rate limit exceeded', hint: getRateLimitAuthHint() },
      { status: 429, headers: { 'Retry-After': String(Math.ceil((rl.resetAt - Date.now()) / 1000)) } }
    );
  }

  const rawBody       = await req.text();

  // ── L4 DLP + shell injection (route boundary, defence-in-depth) ──────────────
  // These are pure-function checks with no DB access. Running them here makes
  // the route independently testable without un-mocking proxy-execute.
  // proxy-execute.ts runs the same checks again for calls arriving via the
  // native MCP server path (invoke_tool) — that's intentional redundancy.
  const dlpIssues = dlpScan(rawBody);
  if (dlpIssues.length > 0) {
    return NextResponse.json(
      { error: 'Request blocked — credential in args', pattern: dlpIssues[0], vault: `${SITE_URL}/dashboard/secrets` },
      { status: 400 }
    );
  }
  const shellIssues = shellInjectionScan(rawBody);
  if (shellIssues.length > 0) {
    return NextResponse.json(
      { error: 'Request blocked — shell injection', issues: shellIssues },
      { status: 400 }
    );
  }

  const callInterface = (req.headers.get(`x-${BRAND.name}-interface`) ?? req.headers.get('x-relay-interface')) === 'mcp_server' ? 'mcp_server' : 'rest';

  const result = await executeProxyCall({
    serverName,
    toolName,
    rawBody,
    callerUserId,
    callerKeyId:   apiKey.keyId,
    ip,
    userAgent:     req.headers.get('user-agent') ?? '',
    confirmHeader: req.headers.get('x-confirm-token'),
    callInterface,
  });

  return new NextResponse(result.body, {
    status: result.status,
    headers: { ...result.headers, ...corsHeaders(req.headers.get('origin')) },
  });
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ serverName: string; toolName: string }> }
) {
  const { serverName, toolName } = await params;
  const { data: server } = await createClient()
    .from('servers')
    .select('name, display_name, description, tools, trust_score, latency_ms, uptime_pct, verified, auth_type, transport, proxy_available')
    .eq('name', serverName)
    .eq('status', 'active')
    .single();

  if (!server) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  return NextResponse.json(server, { headers: corsHeaders(req.headers.get('origin')) });
}

export async function OPTIONS(req: NextRequest) {
  return new NextResponse(null, {
    status: 204,
    headers: corsHeaders(req.headers.get('origin')),
  });
}
