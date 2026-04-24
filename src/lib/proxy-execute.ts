/**
 * proxy-execute.ts — Core MCP tool proxy execution.
 *
 * Bugs fixed vs previous version:
 *   1. Anonymous invocations now blocked (401 required — no userId, no invoke)
 *   2. 401/502 early returns now fall through to metering + feedback loop
 *   3. Single vault lookup via server_credential_hints (not 5-variant serial search)
 *   4. MCP initialize handshake sent for SSE/unknown transport servers
 *   5. All params destructured consistently at top of function
 *   6. server.auth_type used directly (no more `as any` cast)
 */

import { createClient, createServiceClient } from '@/lib/supabase/server';
import { withCache }                         from '@/lib/cache';
import { signToken, verifyToken, isSafeUrl, readBoundedResponse } from '@/lib/utils';
import { SITE_URL }                          from '@/lib/site';
import { BRAND }                             from '@/lib/brand';
import { after }                             from '@/lib/after';
import { API_KEY_HEADER }                    from '@/lib/agent-guidance';
import {
  dlpScan, samplingDlpScan, piiScan,
  checkElicitationUrl, contextLeakScan,
  shellInjectionScan, indirectInjectionScan,
} from '@/lib/security';
import { recordInvokeOutcome, classifyError } from '@/lib/search-analytics';

export interface ProxyCallParams {
  serverName:     string;
  toolName:       string;
  rawBody:        string;
  callerUserId:   string | null;
  callerKeyId:    string | null;
  ip:             string;
  userAgent:      string;
  confirmHeader:  string | null;
  callInterface:  'rest' | 'mcp_server';
  intentText?:    string;
  intentHash?:    string;
  searchEventId?: string | null;
  wasRetry?:      boolean;
  retryServer?:   string | null;
}

export interface ProxyCallResult {
  status:           number;
  body:             string;
  contentType:      string;
  headers:          Record<string, string>;
  confirmRequired?: { token: string; hint: string };
}

function audit(svc: ReturnType<typeof createServiceClient>, data: {
  server_id: string; action: string; tool_name: string;
  request_size: number; response_size: number; latency_ms: number;
  status_code: number; dlp_triggered: boolean; dlp_issues: string[];
  ip: string; user_agent: string;
}) { void svc.from('audit_log').insert(data as any); }

// Single vault lookup via server_credential_hints — one DB call, standard naming
async function injectCredential(
  svc: ReturnType<typeof createServiceClient>,
  callerUserId: string, serverName: string, authType: string,
  headers: Record<string, string>
): Promise<void> {
  if (authType === 'oauth') {
    const token = await withCache(`oauth:${callerUserId}:${serverName}`, 60, async () => {
      const { data } = await svc.rpc('get_oauth_token', { p_user_id: callerUserId, p_server_name: serverName });
      return data ?? null;
    });
    if (token) headers['Authorization'] = `Bearer ${token}`;
    return;
  }
  if (authType === 'none') return;

  // Standard: read declared secret name from server_credential_hints
  // Fallback: {SERVER_SLUG}_API_KEY
  const hint = await withCache(`hint:${serverName}`, 600, async () => {
    const { data } = await svc
      .from('server_credential_hints')
      .select('secret_name')
      .eq('server_name', serverName)
      .eq('required', true)
      .order('created_at', { ascending: true })
      .limit(1)
      .maybeSingle();
    return data ?? null;
  });

  const secretName = hint?.secret_name
    ?? `${serverName.toUpperCase().replace(/-/g, '_').replace(/[^A-Z0-9_]/g, '')}_API_KEY`;

  const val = await withCache(`vault:${callerUserId}:${serverName}:${secretName}`, 300, async () => {
    const { data } = await svc.rpc('get_user_secret', {
      p_user_id: callerUserId, p_server_name: serverName, p_secret_name: secretName,
    });
    return data ?? null;
  });
  if (val) headers['Authorization'] = `Bearer ${val}`;
}

// MCP initialize handshake for stateful servers (SSE, 2024-11-05 strict)
async function mcpHandshake(endpoint: string, headers: Record<string, string>): Promise<string | null> {
  try {
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0', id: 0, method: 'initialize',
        params: { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: BRAND.slug, version: '1.0.0' } },
      }),
      signal: AbortSignal.timeout(8_000), redirect: 'manual',
    });
    if (!res.ok) return null;
    const sessionId = res.headers.get('mcp-session-id');
    // Fire-and-forget initialized notification
    const notifH: Record<string, string> = { ...headers, 'Content-Type': 'application/json' };
    if (sessionId) notifH['Mcp-Session-Id'] = sessionId;
    fetch(endpoint, {
      method: 'POST', headers: notifH,
      body: JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }),
      signal: AbortSignal.timeout(3_000), redirect: 'manual',
    }).catch(() => {});
    return sessionId;
  } catch { return null; }
}

function flattenJsonStrings(raw: string): string {
  try {
    const strings: string[] = [];
    function collect(v: unknown, depth = 0) {
      if (depth > 10) return;
      if (typeof v === 'string') strings.push(v.replace(/\\u([0-9a-fA-F]{4})/g, (_, h) => String.fromCharCode(parseInt(h, 16))));
      else if (Array.isArray(v)) v.forEach(i => collect(i, depth + 1));
      else if (v !== null && typeof v === 'object') Object.values(v).forEach(val => collect(val, depth + 1));
    }
    collect(JSON.parse(raw));
    return strings.join('\n');
  } catch { return raw; }
}

export async function executeProxyCall(params: ProxyCallParams): Promise<ProxyCallResult> {
  const {
    serverName, toolName, rawBody,
    callerUserId, callerKeyId,
    ip, userAgent, confirmHeader, callInterface,
    intentText, intentHash, searchEventId,
    wasRetry, retryServer,
  } = params;

  const start = Date.now();
  const svc   = createServiceClient();

  // ── 1. Auth required ─────────────────────────────────────────────────────────
  if (!callerUserId) {
    return { status: 401, body: JSON.stringify({
      error: 'Authentication required for invoke_tool',
      hint: `Add header: ${API_KEY_HEADER}`,
      get_key: `${SITE_URL}/dashboard`,
    }), contentType: 'application/json', headers: {} };
  }

  // ── 2. Body size ──────────────────────────────────────────────────────────────
  if (rawBody.length > 1_000_000) {
    return { status: 413, body: JSON.stringify({ error: 'Request body exceeds 1 MB limit' }), contentType: 'application/json', headers: {} };
  }

  // ── 3. Server lookup ──────────────────────────────────────────────────────────
  const server = await withCache(`server:${serverName}`, 60, async () => {
    const { data } = await createClient()
      .from('servers')
      .select('id, name, endpoint, tools, trust_score, latency_ms, auth_type, proxy_available, transport')
      .eq('name', serverName).eq('status', 'active').single();
    return data ?? null;
  });

  if (!server) return { status: 404, body: JSON.stringify({ error: `Server '${serverName}' not found` }), contentType: 'application/json', headers: {} };

  if (server.proxy_available === false) {
    return { status: 400, body: JSON.stringify({
      error: `'${serverName}' is a stdio server — not invocable via Cloud Proxy.`,
      resolution: `Use ${BRAND.cli}: npx -y @${BRAND.slug}/cli invoke ${serverName} ${toolName}`,
      is_stdio: true,
    }), contentType: 'application/json', headers: {} };
  }

  if (!server.endpoint || !isSafeUrl(server.endpoint)) {
    return { status: 400, body: JSON.stringify({ error: 'Server endpoint failed SSRF validation' }), contentType: 'application/json', headers: {} };
  }

  if (!Array.isArray(server.tools) || !server.tools.includes(toolName)) {
    return { status: 404, body: JSON.stringify({
      error: `Tool '${toolName}' not found on '${serverName}'`,
      available_tools: server.tools ?? [],
    }), contentType: 'application/json', headers: {} };
  }

  // ── 4. HMAC confirm token ─────────────────────────────────────────────────────
  let confirmationVerified = false;
  if (confirmHeader) {
    const decoded = verifyToken<{ server: string; tool: string }>(confirmHeader);
    confirmationVerified = !!(decoded?.server === serverName && decoded?.tool === toolName);
  }

  // ── 5. Tool policy ────────────────────────────────────────────────────────────
  const policy = await withCache(`policy:${callerUserId}:${serverName}:${toolName}`, 300, async () => {
    const { data } = await svc.rpc('check_tool_policy', { p_user_id: callerUserId, p_server: serverName, p_tool: toolName });
    return data ?? 'allowed';
  });

  if (policy === 'blocked') {
    after(() => audit(svc, { server_id: server.id, action: 'policy_blocked', tool_name: toolName, request_size: 0, response_size: 0, latency_ms: Date.now() - start, status_code: 403, dlp_triggered: false, dlp_issues: [`Blocked: ${toolName}`], ip, user_agent: userAgent }));
    return { status: 403, body: JSON.stringify({ error: `Tool '${toolName}' is blocked by your policy`, hint: `Update at ${SITE_URL}/dashboard/policies` }), contentType: 'application/json', headers: {} };
  }
  if (policy === 'require_confirmation' && !confirmationVerified) {
    const token = signToken({ server: serverName, tool: toolName, uid: callerUserId });
    return { status: 202, body: JSON.stringify({
      status: 'confirmation_required',
      message: `'${toolName}' requires your confirmation`,
      confirm_token: token,
      confirm_hint: `Resend with: X-Confirm-Token: ${token}`,
    }), contentType: 'application/json', headers: {}, confirmRequired: { token, hint: `X-Confirm-Token: ${token}` } };
  }

  // ── 6. L4 DLP request scan ────────────────────────────────────────────────────
  const reqDlp = dlpScan(rawBody);
  if (reqDlp.length > 0) {
    after(() => audit(svc, { server_id: server.id, action: 'dlp_blocked_request', tool_name: toolName, request_size: rawBody.length, response_size: 0, latency_ms: Date.now() - start, status_code: 400, dlp_triggered: true, dlp_issues: reqDlp, ip, user_agent: userAgent }));
    return { status: 400, body: JSON.stringify({ error: 'Request blocked — credential in args', pattern: reqDlp[0], vault: `${SITE_URL}/dashboard/secrets` }), contentType: 'application/json', headers: {} };
  }

  // ── 7. L9 Sampling injection ──────────────────────────────────────────────────
  const samplingIssues = samplingDlpScan(rawBody);
  if (samplingIssues.length > 0) {
    after(() => audit(svc, { server_id: server.id, action: 'sampling_injection_blocked', tool_name: toolName, request_size: rawBody.length, response_size: 0, latency_ms: Date.now() - start, status_code: 400, dlp_triggered: true, dlp_issues: samplingIssues, ip, user_agent: userAgent }));
    return { status: 400, body: JSON.stringify({ error: 'Request blocked — sampling injection', issues: samplingIssues }), contentType: 'application/json', headers: {} };
  }

  // ── 8. S-12 Shell injection (recursive JSON scan) ─────────────────────────────
  const shellIssues = shellInjectionScan(flattenJsonStrings(rawBody));
  if (shellIssues.length > 0) {
    after(() => audit(svc, { server_id: server.id, action: 'shell_injection_blocked', tool_name: toolName, request_size: rawBody.length, response_size: 0, latency_ms: Date.now() - start, status_code: 400, dlp_triggered: true, dlp_issues: shellIssues, ip, user_agent: userAgent }));
    return { status: 400, body: JSON.stringify({ error: 'Request blocked — shell injection', issues: shellIssues }), contentType: 'application/json', headers: {} };
  }

  // ── 9. L11 URL elicitation ────────────────────────────────────────────────────
  try {
    const parsed = JSON.parse(rawBody);
    for (const field of ['url', 'redirect', 'elicitation_url', 'callback_url', 'webhook', 'endpoint']) {
      if (typeof parsed[field] === 'string') {
        const danger = checkElicitationUrl(parsed[field]);
        if (danger) return { status: 400, body: JSON.stringify({ error: `URL elicitation blocked: ${danger}`, field }), contentType: 'application/json', headers: {} };
      }
    }
  } catch {}

  // ── 10. Vault credential injection (single lookup) ────────────────────────────
  const upstreamHeaders: Record<string, string> = {
    'Content-Type': 'application/json',
    'X-Forwarded-By': BRAND.slug,
    'X-Request-Id': crypto.randomUUID(),
  };
  await injectCredential(svc, callerUserId, serverName, server.auth_type ?? 'managed', upstreamHeaders);

  // ── 11. MCP initialize handshake (SSE / unknown transport only) ───────────────
  if (server.transport === 'sse' || server.transport === 'unknown') {
    const sessionId = await mcpHandshake(server.endpoint, upstreamHeaders);
    if (sessionId) upstreamHeaders['Mcp-Session-Id'] = sessionId;
  }

  // ── 12. Build tools/call body ─────────────────────────────────────────────────
  let toolArguments: Record<string, unknown> = {};
  try {
    const parsed = JSON.parse(rawBody);
    toolArguments = parsed?.arguments ?? parsed?.params ?? parsed ?? {};
    delete toolArguments.jsonrpc; delete toolArguments.method; delete toolArguments.id;
  } catch { toolArguments = rawBody ? { input: rawBody } : {}; }

  const mcpBody = JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: toolName, arguments: toolArguments } });

  // ── 13. Upstream call ─────────────────────────────────────────────────────────
  let responseBody = '';
  let upstreamStatus = 502;
  let upstreamContentType = 'application/json';
  let responseTruncated = false;
  let upstreamError: string | null = null;

  try {
    const upstream = await fetch(server.endpoint, { method: 'POST', headers: upstreamHeaders, body: mcpBody, redirect: 'manual', signal: AbortSignal.timeout(30_000) });

    if (upstream.status >= 300 && upstream.status < 400) {
      const location = upstream.headers.get('location') ?? '';
      if (!isSafeUrl(location)) return { status: 502, body: JSON.stringify({ error: 'Upstream redirected to blocked URL (SSRF guard)' }), contentType: 'application/json', headers: {} };
      const rr = await fetch(location, { method: 'POST', headers: upstreamHeaders, body: mcpBody, redirect: 'manual', signal: AbortSignal.timeout(20_000) });
      upstreamStatus = rr.status; upstreamContentType = rr.headers.get('content-type') ?? 'application/json';
      const b = await readBoundedResponse(rr); responseBody = b.body; responseTruncated = b.truncated;
    } else {
      upstreamStatus = upstream.status; upstreamContentType = upstream.headers.get('content-type') ?? 'application/json';
      const b = await readBoundedResponse(upstream); responseBody = b.body; responseTruncated = b.truncated;
    }
  } catch (err: any) {
    upstreamStatus = 502; upstreamError = err.message;
    responseBody = JSON.stringify({ error: 'Upstream unreachable', message: err.message });
  }

  const latency = Date.now() - start;
  const success = upstreamStatus >= 200 && upstreamStatus < 300;

  // ── 14. Response security scans (on successful responses only) ────────────────
  const resDlp         = success ? dlpScan(responseBody)               : [];
  const piiIssues      = success ? piiScan(responseBody)               : [];
  const leakIssues     = success ? contextLeakScan(responseBody)       : [];
  const indirectIssues = success ? indirectInjectionScan(responseBody) : [];
  const allIssues      = [...new Set([...resDlp, ...piiIssues, ...leakIssues, ...indirectIssues])];

  // ── 15. Metering + feedback loop + audit (always runs — even 401/502) ─────────
  after(() => {
    if (success) {
      void (svc.from('servers') as any).update({ latency_ms: Math.round(latency * 0.1 + (server.latency_ms ?? latency) * 0.9) }).eq('id', server.id);
      void svc.rpc('increment_calls', { server_id: server.id });
    }
    void svc.from('metering_events').insert({ server_id: server.id, user_id: callerUserId, tool_name: toolName, interface: callInterface, request_bytes: rawBody.length, response_bytes: responseBody.length, latency_ms: latency, status_code: upstreamStatus, dlp_triggered: allIssues.length > 0 } as any);
    recordInvokeOutcome({ searchEventId: searchEventId ?? null, userId: callerUserId, serverId: server.id, serverName, toolName, intentHash: intentHash ?? null, intentText: intentText ?? null, statusCode: upstreamStatus, success, latencyMs: latency, errorType: classifyError(upstreamStatus, allIssues.length > 0, responseBody), dlpTriggered: allIssues.length > 0, wasRetry: wasRetry ?? false, retryServer: retryServer ?? null }).catch(() => {});
    audit(svc, { server_id: server.id, action: upstreamError ? 'proxy_error' : upstreamStatus === 401 ? 'proxy_auth_failure' : allIssues.length > 0 ? 'proxy_dlp_warning' : 'proxy_call', tool_name: toolName, request_size: rawBody.length, response_size: responseBody.length, latency_ms: latency, status_code: upstreamStatus, dlp_triggered: allIssues.length > 0, dlp_issues: allIssues, ip, user_agent: userAgent });
  });

  // ── 16. Structured 401 response (after metering is scheduled) ────────────────
  if (upstreamStatus === 401) {
    const base = serverName.toUpperCase().replace(/-/g, '_').replace(/[^A-Z0-9_]/g, '');
    return { status: 401, body: JSON.stringify(
      server.auth_type === 'oauth'
        ? { error: 'authentication_required', auth_type: 'oauth', server: serverName, connect_url: `${SITE_URL}/registry/${serverName}?connect=1` }
        : { error: 'authentication_required', auth_type: 'api_key', server: serverName, suggested_name: `${base}_API_KEY`, setup_url: `${SITE_URL}/dashboard/secrets?server=${serverName}&name=${base}_API_KEY` }
    ), contentType: 'application/json', headers: {} };
  }

  if (upstreamError) {
    return { status: 502, body: responseBody, contentType: 'application/json', headers: {} };
  }

  // ── 17. Build final response ──────────────────────────────────────────────────
  const resHeaders: Record<string, string> = {
    'Content-Type': (upstreamContentType.startsWith('application/json') || upstreamContentType.startsWith('text/plain')) ? upstreamContentType : 'application/json',
    'X-Registry-Latency': String(latency),
    'X-Registry-Server': serverName,
    'X-Registry-Trust-Score': String(server.trust_score ?? 0),
    'X-Content-Type-Options': 'nosniff',
  };
  if (allIssues.length > 0) resHeaders['X-Registry-DLP-Warning'] = allIssues.slice(0, 3).join('; ');
  if (responseTruncated)    resHeaders['X-Registry-Truncated']   = 'true';

  return { status: upstreamStatus, body: responseBody, contentType: resHeaders['Content-Type'], headers: resHeaders };
}
