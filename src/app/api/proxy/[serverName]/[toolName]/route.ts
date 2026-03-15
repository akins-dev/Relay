import { NextRequest, NextResponse } from 'next/server';
import { createClient, createServiceClient } from '@/lib/supabase/server';
import {
  dlpScan, samplingDlpScan, piiScan,
  checkElicitationUrl, contextLeakScan,
} from '@/lib/security';

export async function POST(
  req: NextRequest,
  { params }: { params: { serverName: string; toolName: string } }
) {
  const { serverName, toolName } = params;
  const start    = Date.now();
  const supabase = createClient();

  // Resolve server
  const { data: server, error: serverErr } = await supabase
    .from('servers')
    .select('id, name, endpoint, tools, trust_score, latency_ms')
    .eq('name', serverName)
    .eq('status', 'active')
    .single();

  if (serverErr || !server) {
    return NextResponse.json({ error: `Server '${serverName}' not found` }, { status: 404 });
  }

  if (!server.tools.includes(toolName)) {
    return NextResponse.json({
      error: `Tool '${toolName}' not found on '${serverName}'`,
      available_tools: server.tools,
    }, { status: 404 });
  }

  const reqBody = await req.text();
  const svc     = createServiceClient();

  // L4: DLP — block credentials in request body
  const reqDlp = dlpScan(reqBody);
  if (reqDlp.length > 0) {
    await logAudit(svc, {
      server_id: server.id, action: 'dlp_blocked_request', tool_name: toolName,
      request_size: reqBody.length, response_size: 0,
      latency_ms: Date.now() - start, status_code: 400,
      dlp_triggered: true, dlp_issues: reqDlp,
      ip: req.headers.get('x-forwarded-for') || '',
      user_agent: req.headers.get('user-agent') || '',
    });
    return NextResponse.json({
      error: 'Request blocked — credential material detected in body',
      issues: reqDlp,
    }, { status: 400 });
  }

  // L9: MCP Sampling inspection — check if request looks like a sampling call
  const samplingIssues = samplingDlpScan(reqBody);
  if (samplingIssues.length > 0) {
    await logAudit(svc, {
      server_id: server.id, action: 'sampling_injection_blocked', tool_name: toolName,
      request_size: reqBody.length, response_size: 0,
      latency_ms: Date.now() - start, status_code: 400,
      dlp_triggered: true, dlp_issues: samplingIssues,
      ip: req.headers.get('x-forwarded-for') || '',
      user_agent: req.headers.get('user-agent') || '',
    });
    return NextResponse.json({
      error: 'Request blocked — sampling injection pattern detected',
      issues: samplingIssues,
    }, { status: 400 });
  }

  // L11: URL elicitation check — if request contains a URL field, validate it
  try {
    const parsed = JSON.parse(reqBody);
    const urlFields = ['url', 'redirect', 'elicitation_url', 'callback_url'];
    for (const field of urlFields) {
      if (typeof parsed[field] === 'string') {
        const danger = checkElicitationUrl(parsed[field]);
        if (danger) {
          return NextResponse.json({
            error: `URL elicitation blocked: ${danger}`,
            field,
          }, { status: 400 });
        }
      }
    }
  } catch { /* not JSON or no URL fields */ }

  // Forward to upstream MCP server
  const targetUrl = `${server.endpoint}/tools/${toolName}`;
  let responseBody: string;
  let upstreamStatus: number;
  let upstreamContentType: string;

  try {
    const upstream = await fetch(targetUrl, {
      method:  'POST',
      headers: {
        'Content-Type':     'application/json',
        'X-Registry-Proxy': 'mcp-registry',
        'X-Request-Id':     crypto.randomUUID(),
      },
      body:   reqBody,
      signal: AbortSignal.timeout(30_000),
    });

    responseBody        = await upstream.text();
    upstreamStatus      = upstream.status;
    upstreamContentType = upstream.headers.get('content-type') ?? 'application/json';
  } catch (err: any) {
    await logAudit(svc, {
      server_id: server.id, action: 'proxy_error', tool_name: toolName,
      request_size: reqBody.length, response_size: 0,
      latency_ms: Date.now() - start, status_code: 502,
      dlp_triggered: false, dlp_issues: [],
      ip: req.headers.get('x-forwarded-for') || '',
      user_agent: req.headers.get('user-agent') || '',
    });
    return NextResponse.json({ error: 'Upstream error', message: err.message }, { status: 502 });
  }

  const latency = Date.now() - start;

  // L4: DLP — scan response body
  const resDlp = dlpScan(responseBody);

  // L10: PII scan on response
  const piiIssues = piiScan(responseBody);

  // L12: Context leak scan on response
  const leakIssues = contextLeakScan(responseBody);

  const allResponseIssues = [...new Set([...resDlp, ...piiIssues, ...leakIssues])];

  // Update server stats (fire and forget)
  const ewma = Math.round(latency * 0.1 + (server.latency_ms ?? latency) * 0.9);
  svc.from('servers').update({ latency_ms: ewma }).eq('id', server.id).then(() => {});
  svc.rpc('increment_calls', { server_id: server.id }).then(() => {});

  // Audit log
  const action = allResponseIssues.length > 0 ? 'proxy_dlp_warning_response' : 'proxy_call';
  await logAudit(svc, {
    server_id:     server.id,
    action,
    tool_name:     toolName,
    request_size:  reqBody.length,
    response_size: responseBody.length,
    latency_ms:    latency,
    status_code:   upstreamStatus,
    dlp_triggered: allResponseIssues.length > 0,
    dlp_issues:    allResponseIssues,
    ip:            req.headers.get('x-forwarded-for') || '',
    user_agent:    req.headers.get('user-agent') || '',
  });

  const responseHeaders: Record<string, string> = {
    'Content-Type':           upstreamContentType,
    'X-Registry-Latency':     String(latency),
    'X-Registry-Server':      serverName,
    'X-Registry-Trust-Score': String(server.trust_score),
  };
  if (allResponseIssues.length > 0) {
    responseHeaders['X-Registry-DLP-Warning'] = allResponseIssues.slice(0, 3).join('; ');
  }

  return new NextResponse(responseBody, { status: upstreamStatus, headers: responseHeaders });
}

export async function GET(
  _req: NextRequest,
  { params }: { params: { serverName: string; toolName: string } }
) {
  const supabase = createClient();
  const { data: server } = await supabase
    .from('servers')
    .select('name, display_name, description, tools, trust_score, latency_ms, uptime_pct, verified')
    .eq('name', params.serverName)
    .eq('status', 'active')
    .single();
  if (!server) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  return NextResponse.json(server);
}

async function logAudit(svc: ReturnType<typeof createServiceClient>, data: {
  server_id: string; action: string; tool_name: string;
  request_size: number; response_size: number; latency_ms: number;
  status_code: number; dlp_triggered: boolean; dlp_issues: string[];
  ip: string; user_agent: string;
}) {
  try { await svc.from('audit_log').insert(data); } catch {}
}
