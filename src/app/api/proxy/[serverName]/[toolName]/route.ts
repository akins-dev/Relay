/**
 * openMCP — Security Proxy
 *
 * All MCP tool calls route through here. Security layers in order:
 *   Rate limit → Server lookup + SSRF guard → Body size limit →
 *   HMAC confirm token → Policy → DLP (req) → Sampling → Shell injection →
 *   URL elicitation → Vault injection (all name variants) →
 *   Upstream call (bounded response) → DLP/PII/Leak/Indirect (resp) →
 *   Metering → Audit
 */
import { NextRequest, NextResponse }         from 'next/server';
import { createClient, createServiceClient } from '@/lib/supabase/server';
import { rateLimit, LIMITS }                 from '@/lib/ratelimit';
import { extractIp }                         from '@/lib/api';
import { signToken, verifyToken, isSafeUrl, readBoundedResponse } from '@/lib/utils';
import { createHash }                        from 'crypto';
import { SITE_URL }                          from '@/lib/site';
import {
  dlpScan, samplingDlpScan, piiScan,
  checkElicitationUrl, contextLeakScan,
  shellInjectionScan, indirectInjectionScan,
} from '@/lib/security';

// All secret name patterns a server might expect —
// vault tries each in order and injects the first one found.
function secretVariants(serverName: string): string[] {
  const b = serverName.toUpperCase().replace(/-/g, '_').replace(/[^A-Z0-9_]/g, '');
  return [`${b}_API_KEY`, `${b}_TOKEN`, `${b}_SECRET`, `${b}_ACCESS_TOKEN`, b];
}

const ua  = (r: NextRequest) => r.headers.get('user-agent') ?? '';
const xip = (r: NextRequest) => extractIp(r);

async function resolveApiKeyUser(
  req: NextRequest,
  svc: ReturnType<typeof createServiceClient>
): Promise<{ userId: string | null; keyId: string | null }> {
  const authHeader = req.headers.get('authorization');
  if (!authHeader?.startsWith('Bearer ')) return { userId: null, keyId: null };

  const token = authHeader.slice(7);
  if (!token.startsWith('sk_mcp_')) return { userId: null, keyId: null };

  const keyHash = createHash('sha256').update(token).digest('hex');
  const { data } = await svc
    .from('api_keys')
    .select('id, user_id')
    .eq('key_hash', keyHash)
    .single();

  if (!data) return { userId: null, keyId: null };

  svc.from('api_keys')
    .update({ last_used_at: new Date().toISOString() })
    .eq('id', data.id)
    .catch(() => {});

  return { userId: data.user_id, keyId: data.id };
}

export async function POST(
  req: NextRequest,
  { params }: { params: { serverName: string; toolName: string } }
) {
  const { serverName, toolName } = params;
  const start    = Date.now();
  const supabase = createClient();
  const svc      = createServiceClient();
  const ip       = xip(req);
  const apiKey   = await resolveApiKeyUser(req, svc);
  const { data: { user: sessionUser } } = await supabase.auth.getUser().catch(() => ({ data: { user: null } }));

  if (sessionUser && apiKey.userId && sessionUser.id !== apiKey.userId) {
    return NextResponse.json({ error: 'Authorization API key does not match the current session' }, { status: 401 });
  }

  const callerUserId = sessionUser?.id ?? apiKey.userId;

  // ── Rate limit ───────────────────────────────────────────────────────────────
  const rlKey    = callerUserId ? `proxy:user:${callerUserId}` : `proxy:ip:${ip}`;
  const rlConfig = callerUserId ? LIMITS.proxyAuth : LIMITS.proxy;
  const rl = await rateLimit(rlKey, rlConfig);
  if (!rl.allowed) {
    return NextResponse.json(
      { error: 'Rate limit exceeded', hint: 'Add Authorization: Bearer sk_mcp_... for 200/min' },
      { status: 429, headers: { 'Retry-After': String(Math.ceil((rl.resetAt - Date.now()) / 1000)) } }
    );
  }

  // ── Server lookup — also fetches auth_type for 401 handling ─────────────────
  const { data: server, error: serverErr } = await supabase
    .from('servers')
    .select('id, name, endpoint, tools, trust_score, latency_ms, auth_type, auth_setup_url, oauth_authorization_url')
    .eq('name', serverName)
    .eq('status', 'active')
    .single();

  if (serverErr || !server) {
    return NextResponse.json({ error: `Server '${serverName}' not found` }, { status: 404 });
  }

  // ── SSRF guard — validate endpoint before every call ────────────────────────
  if (!isSafeUrl(server.endpoint)) {
    return NextResponse.json({ error: 'Server endpoint failed safety validation' }, { status: 400 });
  }

  if (!server.tools.includes(toolName)) {
    return NextResponse.json(
      { error: `Tool '${toolName}' not found on '${serverName}'`, available_tools: server.tools },
      { status: 404 }
    );
  }

  // ── Request body — enforce 1 MB limit ────────────────────────────────────────
  const rawBody = await req.text();
  if (rawBody.length > 1_000_000) {
    return NextResponse.json({ error: 'Request body exceeds 1 MB limit' }, { status: 413 });
  }
  // ── HMAC confirm token (replaces plain base64 — forgeable) ──────────────────
  let confirmationVerified = false;
  const confirmHeader = req.headers.get('x-confirm-token');
  if (confirmHeader) {
    const decoded = verifyToken<{ server: string; tool: string }>(confirmHeader);
    confirmationVerified = !!(decoded?.server === serverName && decoded?.tool === toolName);
  }

  // ── Tool policy ──────────────────────────────────────────────────────────────
  if (callerUserId) {
    const { data: policy } = await svc.rpc('check_tool_policy', {
      p_user_id: callerUserId, p_server: serverName, p_tool: toolName,
    });

    if (policy === 'blocked') {
      await audit(svc, { server_id: server.id, action: 'policy_blocked', tool_name: toolName,
        request_size: 0, response_size: 0, latency_ms: Date.now() - start,
        status_code: 403, dlp_triggered: false, dlp_issues: [`Blocked: ${toolName}`], ip, user_agent: ua(req) });
      return NextResponse.json(
        { error: `Tool '${toolName}' is blocked by your policy`, hint: 'Update at /dashboard/policies' },
        { status: 403 }
      );
    }

    if (policy === 'require_confirmation' && !confirmationVerified) {
      const token = signToken({ server: serverName, tool: toolName, uid: callerUserId });
      return NextResponse.json({
        status: 'confirmation_required',
        message: `'${toolName}' requires your confirmation before running`,
        confirm_token: token,
        confirm_hint: `Resend with header X-Confirm-Token: ${token}`,
      }, { status: 202 });
    }
  }

  // ── L4: DLP — block credentials in request ───────────────────────────────────
  const reqDlp = dlpScan(rawBody);
  if (reqDlp.length > 0) {
    await audit(svc, { server_id: server.id, action: 'dlp_blocked_request', tool_name: toolName,
      request_size: rawBody.length, response_size: 0, latency_ms: Date.now() - start,
      status_code: 400, dlp_triggered: true, dlp_issues: reqDlp, ip, user_agent: ua(req) });
    return NextResponse.json({
      error: 'Request blocked — credential in tool arguments',
      pattern: reqDlp[0],
      explanation: 'Tool arguments must contain only business data. API keys belong in the vault, not arguments.',
      fix: {
        wrong:   '{ "api_key": "sk_live_...", "amount": 4900 }',
        correct: '{ "amount": 4900, "currency": "usd" }',
        vault:   `Store your key once at ${SITE_URL}/dashboard/secrets`,
      },
    }, { status: 400 });
  }

  // ── L9: Sampling injection ───────────────────────────────────────────────────
  const samplingIssues = samplingDlpScan(rawBody);
  if (samplingIssues.length > 0) {
    await audit(svc, { server_id: server.id, action: 'sampling_injection_blocked', tool_name: toolName,
      request_size: rawBody.length, response_size: 0, latency_ms: Date.now() - start,
      status_code: 400, dlp_triggered: true, dlp_issues: samplingIssues, ip, user_agent: ua(req) });
    return NextResponse.json({ error: 'Request blocked — sampling injection pattern', issues: samplingIssues }, { status: 400 });
  }

  // ── S-12: Shell injection ────────────────────────────────────────────────────
  const shellIssues = shellInjectionScan(rawBody);
  if (shellIssues.length > 0) {
    await audit(svc, { server_id: server.id, action: 'shell_injection_blocked', tool_name: toolName,
      request_size: rawBody.length, response_size: 0, latency_ms: Date.now() - start,
      status_code: 400, dlp_triggered: true, dlp_issues: shellIssues, ip, user_agent: ua(req) });
    return NextResponse.json({ error: 'Request blocked — shell injection pattern', issues: shellIssues }, { status: 400 });
  }

  // ── L11: URL elicitation ─────────────────────────────────────────────────────
  try {
    const parsed = JSON.parse(rawBody);
    for (const field of ['url', 'redirect', 'elicitation_url', 'callback_url', 'webhook']) {
      if (typeof parsed[field] === 'string') {
        const danger = checkElicitationUrl(parsed[field]);
        if (danger) return NextResponse.json({ error: `URL elicitation blocked: ${danger}`, field }, { status: 400 });
      }
    }
  } catch { /* not JSON */ }

  // ── Vault: try all secret name variants ─────────────────────────────────────
  const upstreamHeaders: Record<string, string> = {
    'Content-Type':     'application/json',
    'X-Registry-Proxy': 'openmcp',
    'X-Request-Id':     crypto.randomUUID(),
  };

  const isOAuthServer = Boolean((server as any).oauth_authorization_url);

  if (callerUserId) {
    // Try OAuth token first (for oauth auth_type servers)
    if (isOAuthServer) {
      const { data: oauthToken } = await svc.rpc('get_oauth_token', {
        p_user_id: callerUserId, p_server_name: serverName,
      });
      if (oauthToken) upstreamHeaders['Authorization'] = `Bearer ${oauthToken}`;
    } else {
      // Try all static key variants from vault
      for (const secretName of secretVariants(serverName)) {
        const { data: val } = await svc.rpc('get_user_secret', {
          p_user_id: callerUserId, p_server_name: serverName, p_secret_name: secretName,
        });
        if (val) { upstreamHeaders['Authorization'] = `Bearer ${val}`; break; }
      }
    }
  }

  // ── Forward to upstream ──────────────────────────────────────────────────────
  const targetUrl = `${server.endpoint}/tools/${toolName}`;
  let responseBody: string;
  let upstreamStatus: number;
  let upstreamContentType: string;
  let responseTruncated = false;

  try {
    const upstream = await fetch(targetUrl, {
      method: 'POST', headers: upstreamHeaders, body: rawBody,
      signal: AbortSignal.timeout(30_000),
    });
    upstreamStatus      = upstream.status;
    upstreamContentType = upstream.headers.get('content-type') ?? 'application/json';

    // ── Structured 401 — OAuth vs API key ────────────────────────────────────
    if (upstreamStatus === 401) {
      const isOAuth    = isOAuthServer;
      const base       = serverName.toUpperCase().replace(/-/g, '_');
      const keyName    = `${base}_API_KEY`;

      if (isOAuth) {
        return NextResponse.json({
          error:        'authentication_required',
          auth_type:    'oauth',
          server:       serverName,
          tool:         toolName,
          message:      `${serverName} requires you to connect your account via OAuth before calling tools.`,
          connect_url:  `${SITE_URL}/registry/${serverName}?connect=1`,
          instructions: [
            `1. Visit: ${SITE_URL}/registry/${serverName}`,
            '2. Click "Connect your account"',
            '3. Complete the sign-in flow on the service',
            '4. Return here — this call will work automatically',
          ],
        }, { status: 401 });
      }

      // API key path
      return NextResponse.json({
        error:          'authentication_required',
        auth_type:      'api_key',
        server:         serverName,
        tool:           toolName,
        message:        `${serverName} requires an API key. Store it once — the proxy injects it on every call automatically.`,
        suggested_name: keyName,
        setup_url:      `${SITE_URL}/dashboard/secrets?server=${serverName}&name=${keyName}`,
        instructions:   [
          `1. Get your API key for ${serverName} from its dashboard`,
          `2. Go to: ${SITE_URL}/dashboard/secrets`,
          `3. Name: ${keyName}   Value: your key`,
          '4. Re-run this call — it works automatically from now on',
        ],
      }, { status: 401 });
    }

    // ── Bounded response read — 10 MB max ────────────────────────────────────
    const bounded      = await readBoundedResponse(upstream);
    responseBody       = bounded.body;
    responseTruncated  = bounded.truncated;

  } catch (err: any) {
    await audit(svc, { server_id: server.id, action: 'proxy_error', tool_name: toolName,
      request_size: rawBody.length, response_size: 0, latency_ms: Date.now() - start,
      status_code: 502, dlp_triggered: false, dlp_issues: [], ip, user_agent: ua(req) });
    return NextResponse.json({ error: 'Upstream error', message: err.message }, { status: 502 });
  }

  const latency = Date.now() - start;

  // ── Response security scans ──────────────────────────────────────────────────
  const resDlp         = dlpScan(responseBody);
  const piiIssues      = piiScan(responseBody);
  const leakIssues     = contextLeakScan(responseBody);
  const indirectIssues = indirectInjectionScan(responseBody); // was missing — caused ReferenceError crash
  const allIssues      = [...new Set([...resDlp, ...piiIssues, ...leakIssues, ...indirectIssues])];

  // ── Stats + metering — non-blocking, errors suppressed (observability only) ──
  const ewma = Math.round(latency * 0.1 + (server.latency_ms ?? latency) * 0.9);
  svc.from('servers').update({ latency_ms: ewma }).eq('id', server.id).catch(() => {});
  svc.rpc('increment_calls', { server_id: server.id }).catch(() => {});
  const callInterface = req.headers.get('x-openmcp-interface') === 'mcp_server' ? 'mcp_server' : 'rest';
  svc.from('metering_events').insert({
    server_id: server.id, user_id: callerUserId ?? null, tool_name: toolName,
    interface: callInterface, request_bytes: rawBody.length, response_bytes: responseBody.length,
    latency_ms: latency, status_code: upstreamStatus, dlp_triggered: allIssues.length > 0,
  }).catch(() => {});

  // ── Audit log ────────────────────────────────────────────────────────────────
  await audit(svc, {
    server_id: server.id, action: allIssues.length > 0 ? 'proxy_dlp_warning_response' : 'proxy_call',
    tool_name: toolName, request_size: rawBody.length, response_size: responseBody.length,
    latency_ms: latency, status_code: upstreamStatus,
    dlp_triggered: allIssues.length > 0, dlp_issues: allIssues, ip, user_agent: ua(req),
  });

  // ── Response ─────────────────────────────────────────────────────────────────
  const resHeaders: Record<string, string> = {
    'Content-Type':           upstreamContentType,
    'X-Registry-Latency':     String(latency),
    'X-Registry-Server':      serverName,
    'X-Registry-Trust-Score': String(server.trust_score),
  };
  if (allIssues.length > 0)  resHeaders['X-Registry-DLP-Warning'] = allIssues.slice(0, 3).join('; ');
  if (responseTruncated)     resHeaders['X-Registry-Truncated']   = 'true';

  return new NextResponse(responseBody, { status: upstreamStatus, headers: resHeaders });
}

export async function GET(
  _req: NextRequest,
  { params }: { params: { serverName: string; toolName: string } }
) {
  const { data: server } = await createClient()
    .from('servers')
    .select('name, display_name, description, tools, trust_score, latency_ms, uptime_pct, verified, auth_type')
    .eq('name', params.serverName).eq('status', 'active').single();
  if (!server) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  return NextResponse.json(server);
}

async function audit(svc: ReturnType<typeof createServiceClient>, data: {
  server_id: string; action: string; tool_name: string;
  request_size: number; response_size: number; latency_ms: number;
  status_code: number; dlp_triggered: boolean; dlp_issues: string[];
  ip: string; user_agent: string;
}) {
  try { await svc.from('audit_log').insert(data); } catch {}
}
