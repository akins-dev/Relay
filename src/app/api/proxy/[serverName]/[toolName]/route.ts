import { NextRequest, NextResponse } from 'next/server';
import { nanoid } from 'nanoid';
import { getDb } from '@/lib/db';
import { dlpScan } from '@/lib/security';

export async function POST(
  req: NextRequest,
  { params }: { params: { serverName: string; toolName: string } }
) {
  const { serverName, toolName } = params;
  const start = Date.now();
  const db = getDb();

  const server = db.prepare("SELECT * FROM servers WHERE name = ? AND status = 'active'").get(serverName) as any;
  if (!server) return NextResponse.json({ error: `Server '${serverName}' not found` }, { status: 404 });

  const tools: string[] = JSON.parse(server.tools || '[]');
  if (!tools.includes(toolName)) {
    return NextResponse.json({ error: `Tool '${toolName}' not found`, available_tools: tools }, { status: 404 });
  }

  const body = await req.text();
  const dlpIssues = dlpScan(body);
  if (dlpIssues.length > 0) {
    logAudit(db, { server_id: server.id, action: 'dlp_blocked', tool_name: toolName, request_size: body.length, response_size: 0, latency_ms: Date.now() - start, status_code: 400, ip: req.headers.get('x-forwarded-for') || '' });
    return NextResponse.json({ error: 'Request blocked by DLP policy', issues: dlpIssues }, { status: 400 });
  }

  try {
    const targetUrl = `${server.endpoint}/tools/${toolName}`;
    const upstream = await fetch(targetUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Registry-Proxy': 'mcp-registry', 'X-Request-Id': nanoid() },
      body,
      signal: AbortSignal.timeout(30000),
    });

    const responseBody = await upstream.text();
    const latency = Date.now() - start;
    const responseDlp = dlpScan(responseBody);

    db.prepare('UPDATE servers SET total_calls = total_calls + 1, calls_today = calls_today + 1, latency_ms = ? WHERE id = ?')
      .run(Math.round(latency * 0.1 + (server.latency_ms || latency) * 0.9), server.id);

    logAudit(db, { server_id: server.id, action: responseDlp.length > 0 ? 'proxy_dlp_warning' : 'proxy_call', tool_name: toolName, request_size: body.length, response_size: responseBody.length, latency_ms: latency, status_code: upstream.status, ip: req.headers.get('x-forwarded-for') || '' });

    const headers: Record<string, string> = {
      'Content-Type': upstream.headers.get('content-type') || 'application/json',
      'X-Registry-Latency': String(latency),
      'X-Registry-Server': serverName,
      'X-Registry-Trust-Score': String(server.trust_score),
    };
    if (responseDlp.length > 0) headers['X-Registry-DLP-Warning'] = 'true';

    return new NextResponse(responseBody, { status: upstream.status, headers });
  } catch (err: any) {
    const latency = Date.now() - start;
    logAudit(db, { server_id: server.id, action: 'proxy_error', tool_name: toolName, request_size: body.length, response_size: 0, latency_ms: latency, status_code: 502, ip: req.headers.get('x-forwarded-for') || '' });
    return NextResponse.json({ error: 'Upstream error', message: err.message }, { status: 502 });
  }
}

export async function GET(
  _req: NextRequest,
  { params }: { params: { serverName: string; toolName: string } }
) {
  const db = getDb();
  const server = db.prepare("SELECT name, display_name, description, tools, trust_score, latency_ms, uptime_pct, verified FROM servers WHERE name = ? AND status = 'active'").get(params.serverName) as any;
  if (!server) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  return NextResponse.json({ ...server, tools: JSON.parse(server.tools || '[]'), verified: server.verified === 1 });
}

function logAudit(db: any, data: { server_id: string; action: string; tool_name: string; request_size: number; response_size: number; latency_ms: number; status_code: number; ip: string }) {
  try {
    db.prepare('INSERT INTO audit_log (id, server_id, action, tool_name, request_size, response_size, latency_ms, status_code, ip) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .run(nanoid(), data.server_id, data.action, data.tool_name, data.request_size, data.response_size, data.latency_ms, data.status_code, data.ip);
  } catch {}
}
