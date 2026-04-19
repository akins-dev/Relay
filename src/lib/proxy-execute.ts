/**
 * proxy-execute.ts
 *
 * Core MCP tool proxy execution logic — extracted from the route handler so
 * it can be called directly by invoke_tool in the native MCP server without
 * an internal HTTP round-trip.
 *
 * Security layers applied in order:
 *   Rate limit (caller) → server lookup + SSRF → body size → HMAC confirm →
 *   policy → L4 DLP (req) → L9 sampling → S-12 shell → L11 URL elicitation →
 *   vault inject → upstream call → L4/L10/L12/S-13 (resp) → metering → audit
 */

import { createClient, createServiceClient } from '@/lib/supabase/server';
import { getCache, withCache }               from '@/lib/cache';
import { signToken, verifyToken, isSafeUrl, readBoundedResponse, corsHeaders } from '@/lib/utils';
import { createHash }                        from 'crypto';
import { SITE_URL }                          from '@/lib/site';
import { BRAND }                             from '@/lib/brand';
import { unstable_after as after }           from 'next/server';
import {
  dlpScan, samplingDlpScan, piiScan,
  checkElicitationUrl, contextLeakScan,
  shellInjectionScan, indirectInjectionScan,
} from '@/lib/security';
import {
  recordInvokeOutcome, classifyError, hashIntent,
} from '@/lib/search-analytics';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface ProxyCallParams {
  serverName:      string;
  toolName:        string;
  rawBody:         string;
  callerUserId:    string | null;
  callerKeyId:     string | null;
  ip:              string;
  userAgent:       string;
  confirmHeader:   string | null;
  callInterface:   'rest' | 'mcp_server';
  // Analytics — optional, passed from MCP server when search preceded this invoke
  intentText?:     string;
  intentHash?:     string;
  searchEventId?:  string | null;
  wasRetry?:       boolean;
  retryServer?:    string | null;
}

export interface ProxyCallResult {
  status:      number;
  body:        string;
  contentType: string;
  headers:     Record<string, string>;
  /** Set when policy requires confirmation before proceeding */
  confirmRequired?: { token: string; hint: string };
}

// ── Vault helpers ─────────────────────────────────────────────────────────────

function secretVariants(serverName: string): string[] {
  const b = serverName.toUpperCase().replace(/-/g, '_').replace(/[^A-Z0-9_]/g, '');
  return [`${b}_API_KEY`, `${b}_TOKEN`, `${b}_SECRET`, `${b}_ACCESS_TOKEN`, b];
}

// ── Audit helper ──────────────────────────────────────────────────────────────

function audit(
  svc: ReturnType<typeof createServiceClient>,
  data: {
    server_id:    string; action: string; tool_name: string;
    request_size: number; response_size: number; latency_ms: number;
    status_code:  number; dlp_triggered: boolean; dlp_issues: string[];
    ip:           string; user_agent: string;
  }
) {
  svc.from('audit_log').insert(data).catch(() => {});
}

// ── Core execute function ─────────────────────────────────────────────────────

export async function executeProxyCall(params: ProxyCallParams): Promise<ProxyCallResult> {
  const {
    serverName, toolName, rawBody, callerUserId, callerKeyId,
    ip, userAgent, confirmHeader, callInterface,
  } = params;

  const start  = Date.now();
  const svc    = createServiceClient();

  // Body size — 1 MB hard limit
  if (rawBody.length > 1_000_000) {
    return { status: 413, body: JSON.stringify({ error: 'Request body exceeds 1 MB limit' }), contentType: 'application/json', headers: {} };
  }

  // ── Server lookup ────────────────────────────────────────────────────────────
  const serverCacheKey = `server:${serverName}`;
  const server = await withCache(serverCacheKey, 60, async () => {
    const { data } = await createClient()
      .from('servers')
      .select('id, name, endpoint, tools, trust_score, latency_ms, auth_type, auth_setup_url, oauth_authorization_url, proxy_available')
      .eq('name', serverName)
      .eq('status', 'active')
      .single();
    return data;
  });

  if (!server) {
    return { status: 404, body: JSON.stringify({ error: `Server '${serverName}' not found` }), contentType: 'application/json', headers: {} };
  }

  // Stdio check — guide agent to CLI
  if (server.proxy_available === false) {
    return {
      status: 400,
      body: JSON.stringify({
        error:       `Server '${serverName}' is a local stdio process and cannot be executed via Cloud Proxy.`,
        resolution:  `Spawn this tool locally using the ${BRAND.cli}.`,
        cli_command: `npx -y @${BRAND.slug}/cli invoke ${serverName} ${toolName}`,
        is_stdio:    true,
      }),
      contentType: 'application/json', headers: {},
    };
  }

  // SSRF guard
  if (!isSafeUrl(server.endpoint)) {
    return { status: 400, body: JSON.stringify({ error: 'Server endpoint failed safety validation' }), contentType: 'application/json', headers: {} };
  }

  // Tool existence check
  if (!server.tools.includes(toolName)) {
    return {
      status: 404,
      body: JSON.stringify({ error: `Tool '${toolName}' not found on '${serverName}'`, available_tools: server.tools }),
      contentType: 'application/json', headers: {},
    };
  }

  // ── HMAC confirm token ───────────────────────────────────────────────────────
  let confirmationVerified = false;
  if (confirmHeader) {
    const decoded = verifyToken<{ server: string; tool: string }>(confirmHeader);
    confirmationVerified = !!(decoded?.server === serverName && decoded?.tool === toolName);
  }

  // ── Tool policy ──────────────────────────────────────────────────────────────
  if (callerUserId) {
    const policyCacheKey = `policy:${callerUserId}:${serverName}:${toolName}`;
    const policy = await withCache(policyCacheKey, 300, async () => {
      const { data } = await svc.rpc('check_tool_policy', {
        p_user_id: callerUserId, p_server: serverName, p_tool: toolName,
      });
      return data;
    });

    if (policy === 'blocked') {
      after(() => audit(svc, {
        server_id: server.id, action: 'policy_blocked', tool_name: toolName,
        request_size: 0, response_size: 0, latency_ms: Date.now() - start,
        status_code: 403, dlp_triggered: false, dlp_issues: [`Blocked: ${toolName}`], ip, user_agent: userAgent,
      }));
      return {
        status: 403,
        body: JSON.stringify({ error: `Tool '${toolName}' is blocked by your policy`, hint: `Update at ${SITE_URL}/dashboard/policies` }),
        contentType: 'application/json', headers: {},
      };
    }

    if (policy === 'require_confirmation' && !confirmationVerified) {
      const token = signToken({ server: serverName, tool: toolName, uid: callerUserId });
      return {
        status: 202,
        body: JSON.stringify({
          status:        'confirmation_required',
          message:       `'${toolName}' requires your confirmation before running`,
          confirm_token: token,
          confirm_hint:  `Resend with header X-Confirm-Token: ${token}`,
        }),
        contentType: 'application/json', headers: {},
        confirmRequired: { token, hint: `X-Confirm-Token: ${token}` },
      };
    }
  }

  // ── L4: DLP — block credentials in request ───────────────────────────────────
  const reqDlp = dlpScan(rawBody);
  if (reqDlp.length > 0) {
    after(() => audit(svc, {
      server_id: server.id, action: 'dlp_blocked_request', tool_name: toolName,
      request_size: rawBody.length, response_size: 0, latency_ms: Date.now() - start,
      status_code: 400, dlp_triggered: true, dlp_issues: reqDlp, ip, user_agent: userAgent,
    }));
    return {
      status: 400,
      body: JSON.stringify({
        error:       'Request blocked — credential in tool arguments',
        pattern:     reqDlp[0],
        explanation: 'Tool arguments must contain only business data. API keys belong in the vault, not arguments.',
        fix: {
          wrong:   '{ "api_key": "sk_live_...", "amount": 4900 }',
          correct: '{ "amount": 4900, "currency": "usd" }',
          vault:   `Store your key once at ${SITE_URL}/dashboard/secrets`,
        },
      }),
      contentType: 'application/json', headers: {},
    };
  }

  // ── L9: Sampling injection ───────────────────────────────────────────────────
  const samplingIssues = samplingDlpScan(rawBody);
  if (samplingIssues.length > 0) {
    after(() => audit(svc, {
      server_id: server.id, action: 'sampling_injection_blocked', tool_name: toolName,
      request_size: rawBody.length, response_size: 0, latency_ms: Date.now() - start,
      status_code: 400, dlp_triggered: true, dlp_issues: samplingIssues, ip, user_agent: userAgent,
    }));
    return { status: 400, body: JSON.stringify({ error: 'Request blocked — sampling injection pattern', issues: samplingIssues }), contentType: 'application/json', headers: {} };
  }

  // ── S-12: Shell injection ─────────────────────────────────────────────────────
  // Scan all string values recursively, not just the serialized body
  const shellIssues = shellInjectionScan(flattenJsonStrings(rawBody));
  if (shellIssues.length > 0) {
    after(() => audit(svc, {
      server_id: server.id, action: 'shell_injection_blocked', tool_name: toolName,
      request_size: rawBody.length, response_size: 0, latency_ms: Date.now() - start,
      status_code: 400, dlp_triggered: true, dlp_issues: shellIssues, ip, user_agent: userAgent,
    }));
    return { status: 400, body: JSON.stringify({ error: 'Request blocked — shell injection pattern', issues: shellIssues }), contentType: 'application/json', headers: {} };
  }

  // ── L11: URL elicitation ──────────────────────────────────────────────────────
  try {
    const parsed = JSON.parse(rawBody);
    for (const field of ['url', 'redirect', 'elicitation_url', 'callback_url', 'webhook']) {
      if (typeof parsed[field] === 'string') {
        const danger = checkElicitationUrl(parsed[field]);
        if (danger) {
          return { status: 400, body: JSON.stringify({ error: `URL elicitation blocked: ${danger}`, field }), contentType: 'application/json', headers: {} };
        }
      }
    }
  } catch { /* not JSON — safe to continue */ }

  // ── Vault: inject credentials ────────────────────────────────────────────────
  const upstreamHeaders: Record<string, string> = {
    'Content-Type':     'application/json',
    'X-Registry-Proxy': BRAND.slug,
    'X-Request-Id':     crypto.randomUUID(),
  };

  const isOAuthServer = Boolean((server as any).oauth_authorization_url);

  if (callerUserId) {
    if (isOAuthServer) {
      const oauthToken = await withCache(`oauth:${callerUserId}:${serverName}`, 60, async () => {
        const { data } = await svc.rpc('get_oauth_token', { p_user_id: callerUserId, p_server_name: serverName });
        return data;
      });
      if (oauthToken) upstreamHeaders['Authorization'] = `Bearer ${oauthToken}`;
    } else {
      for (const secretName of secretVariants(serverName)) {
        const val = await withCache(`vault:${callerUserId}:${serverName}:${secretName}`, 300, async () => {
          const { data } = await svc.rpc('get_user_secret', { p_user_id: callerUserId, p_server_name: serverName, p_secret_name: secretName });
          return data;
        });
        if (val) { upstreamHeaders['Authorization'] = `Bearer ${val}`; break; }
      }
    }
  }

  // ── Build MCP JSON-RPC tools/call body ───────────────────────────────────────
  let toolArguments: Record<string, unknown> = {};
  try {
    const parsed = JSON.parse(rawBody);
    toolArguments = parsed?.arguments ?? parsed?.params ?? parsed ?? {};
    delete toolArguments.jsonrpc;
    delete toolArguments.method;
    delete toolArguments.id;
  } catch {
    toolArguments = rawBody ? { input: rawBody } : {};
  }

  const mcpBody = JSON.stringify({
    jsonrpc: '2.0',
    id:      1,
    method:  'tools/call',
    params:  { name: toolName, arguments: toolArguments },
  });

  // ── Upstream call ────────────────────────────────────────────────────────────
  let responseBody: string;
  let upstreamStatus: number;
  let upstreamContentType: string;
  let responseTruncated = false;

  try {
    const upstream = await fetch(server.endpoint, {
      method:   'POST',
      headers:  upstreamHeaders,
      body:     mcpBody,
      redirect: 'manual',
      signal:   AbortSignal.timeout(30_000),
    });

    if (upstream.status >= 300 && upstream.status < 400) {
      const location = upstream.headers.get('location') ?? '';
      if (!isSafeUrl(location)) {
        return { status: 502, body: JSON.stringify({ error: 'Upstream returned a redirect to a blocked URL (SSRF guard)' }), contentType: 'application/json', headers: {} };
      }
      const redirectRes = await fetch(location, {
        method: 'POST', headers: upstreamHeaders, body: mcpBody,
        redirect: 'manual', signal: AbortSignal.timeout(20_000),
      });
      upstreamStatus      = redirectRes.status;
      upstreamContentType = redirectRes.headers.get('content-type') ?? 'application/json';
      const bounded       = await readBoundedResponse(redirectRes);
      responseBody        = bounded.body;
      responseTruncated   = bounded.truncated;
    } else {
      upstreamStatus      = upstream.status;
      upstreamContentType = upstream.headers.get('content-type') ?? 'application/json';
      const bounded       = await readBoundedResponse(upstream);
      responseBody        = bounded.body;
      responseTruncated   = bounded.truncated;
    }

    // Structured 401 — guide user to set up credentials
    if (upstreamStatus === 401) {
      const base    = serverName.toUpperCase().replace(/-/g, '_');
      const keyName = `${base}_API_KEY`;
      const body    = isOAuthServer
        ? JSON.stringify({
            error:        'authentication_required',
            auth_type:    'oauth',
            server:       serverName,
            tool:         toolName,
            message:      `${serverName} requires OAuth. Connect your account first.`,
            connect_url:  `${SITE_URL}/registry/${serverName}?connect=1`,
            instructions: [
              `1. Visit: ${SITE_URL}/registry/${serverName}`,
              '2. Click "Connect your account"',
              '3. Complete the sign-in flow',
              '4. Re-run this call — it works automatically',
            ],
          })
        : JSON.stringify({
            error:          'authentication_required',
            auth_type:      'api_key',
            server:         serverName,
            tool:           toolName,
            message:        `${serverName} requires an API key. Store it once — the proxy injects it automatically.`,
            suggested_name: keyName,
            setup_url:      `${SITE_URL}/dashboard/secrets?server=${serverName}&name=${keyName}`,
            instructions: [
              `1. Get your API key for ${serverName}`,
              `2. Go to: ${SITE_URL}/dashboard/secrets`,
              `3. Name: ${keyName}   Value: your key`,
              '4. Re-run this call — it works automatically',
            ],
          });
      return { status: 401, body, contentType: 'application/json', headers: {} };
    }

  } catch (err: any) {
    after(() => audit(svc, {
      server_id: server.id, action: 'proxy_error', tool_name: toolName,
      request_size: rawBody.length, response_size: 0, latency_ms: Date.now() - start,
      status_code: 502, dlp_triggered: false, dlp_issues: [], ip, user_agent: userAgent,
    }));
    return { status: 502, body: JSON.stringify({ error: 'Upstream error', message: err.message }), contentType: 'application/json', headers: {} };
  }

  const latency = Date.now() - start;

  // ── Response security scans ───────────────────────────────────────────────────
  const resDlp         = dlpScan(responseBody);
  const piiIssues      = piiScan(responseBody);
  const leakIssues     = contextLeakScan(responseBody);
  const indirectIssues = indirectInjectionScan(responseBody);
  const allIssues      = [...new Set([...resDlp, ...piiIssues, ...leakIssues, ...indirectIssues])];

  // ── Metering + audit + feedback loop (non-blocking) ──────────────────────────
  after(() => {
    const ewma = Math.round(latency * 0.1 + (server.latency_ms ?? latency) * 0.9);
    svc.from('servers').update({ latency_ms: ewma }).eq('id', server.id).catch(() => {});
    svc.rpc('increment_calls', { server_id: server.id }).catch(() => {});
    svc.from('metering_events').insert({
      server_id:      server.id,
      user_id:        callerUserId ?? null,
      tool_name:      toolName,
      interface:      callInterface,
      request_bytes:  rawBody.length,
      response_bytes: responseBody.length,
      latency_ms:     latency,
      status_code:    upstreamStatus,
      dlp_triggered:  allIssues.length > 0,
    }).catch(() => {});

    // ── Feedback loop — record outcome and update intent_server_mappings ─────────
    // This is the signal that makes search smarter over time.
    // Every successful invoke boosts this server's ranking for this intent.
    // Every failure reduces it. Over 10K+ events this becomes the ML training corpus.
    const success = upstreamStatus >= 200 && upstreamStatus < 300;
    recordInvokeOutcome({
      searchEventId:  params.searchEventId ?? null,
      userId:         callerUserId,
      serverId:       server.id,
      serverName,
      toolName,
      intentHash:     params.intentHash ?? null,
      intentText:     params.intentText ?? null,
      statusCode:     upstreamStatus,
      success,
      latencyMs:      latency,
      errorType:      classifyError(upstreamStatus, allIssues.length > 0, responseBody),
      dlpTriggered:   allIssues.length > 0,
      wasRetry:       params.wasRetry ?? false,
      retryServer:    params.retryServer ?? null,
    }).catch(() => {});

    audit(svc, {
      server_id:    server.id,
      action:       allIssues.length > 0 ? 'proxy_dlp_warning_response' : 'proxy_call',
      tool_name:    toolName,
      request_size: rawBody.length, response_size: responseBody.length,
      latency_ms:   latency, status_code: upstreamStatus,
      dlp_triggered: allIssues.length > 0, dlp_issues: allIssues, ip, user_agent: userAgent,
    });
  });

  // ── Build response headers ────────────────────────────────────────────────────
  const resHeaders: Record<string, string> = {
    'Content-Type': (upstreamContentType.startsWith('application/json') || upstreamContentType.startsWith('text/plain'))
      ? upstreamContentType
      : 'application/json',
    'X-Registry-Latency':     String(latency),
    'X-Registry-Server':      serverName,
    'X-Registry-Trust-Score': String(server.trust_score),
    'X-Content-Type-Options': 'nosniff',
  };
  if (allIssues.length > 0)  resHeaders['X-Registry-DLP-Warning'] = allIssues.slice(0, 3).join('; ');
  if (responseTruncated)     resHeaders['X-Registry-Truncated']   = 'true';

  return { status: upstreamStatus, body: responseBody, contentType: resHeaders['Content-Type'], headers: resHeaders };
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Recursively extract all string values from a JSON body and join them
 * for shell injection scanning. Prevents bypass via deeply nested objects
 * or Unicode-escaped characters.
 */
function flattenJsonStrings(raw: string): string {
  try {
    const parsed = JSON.parse(raw);
    const strings: string[] = [];
    function collect(v: unknown, depth = 0) {
      if (depth > 10) return; // cap nesting depth
      if (typeof v === 'string') {
        // Unescape Unicode sequences before scanning
        strings.push(v.replace(/\\u([0-9a-fA-F]{4})/g, (_, h) => String.fromCharCode(parseInt(h, 16))));
      } else if (Array.isArray(v)) {
        v.forEach(item => collect(item, depth + 1));
      } else if (v !== null && typeof v === 'object') {
        Object.values(v).forEach(val => collect(val, depth + 1));
      }
    }
    collect(parsed);
    return strings.join('\n');
  } catch {
    return raw;
  }
}