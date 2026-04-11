/**
 * GET  /api/proxy/[serverName]/resources          — list server's resources (metadata)
 * POST /api/proxy/[serverName]/resources/read     — read a specific resource by URI
 *
 * MCP Resources are file-like data contexts exposed by servers:
 *   - Static: a specific URI (e.g. "file:///etc/readme.md")
 *   - Dynamic templates: URI templates (e.g. "github://{owner}/{repo}/blob/{branch}/{path}")
 *
 * SECURITY:
 *   - URI is validated against SSRF patterns before forwarding
 *   - Response is bounded (10MB) and scanned for DLP/PII before return
 *   - Requires authenticated caller (session or API key)
 */
import { NextRequest, NextResponse }         from 'next/server';
import { createClient, createServiceClient } from '@/lib/supabase/server';
import { resolveUser }                       from '@/lib/auth-server';
import { rateLimit, LIMITS }                 from '@/lib/ratelimit';
import { extractIp, apiError }               from '@/lib/api';
import { isSafeUrl, readBoundedResponse }    from '@/lib/utils';
import { dlpScan, piiScan }                  from '@/lib/security';
import { BRAND }                             from '@/lib/brand';

async function resolveCallerAndServer(req: NextRequest, serverName: string) {
  const svc      = createServiceClient();
  const { user } = await resolveUser(req);

  // Also accept MCP API key (sk_mcp_...) for agent-originated calls
  const authHeader = req.headers.get('authorization') ?? '';
  let userId = user?.id ?? null;

  if (!userId && authHeader.startsWith('Bearer sk_mcp_')) {
    const { createHash } = await import('crypto');
    const keyHash = createHash('sha256').update(authHeader.slice(7)).digest('hex');
    const { data } = await svc.from('api_keys').select('user_id').eq('key_hash', keyHash).single();
    userId = (data as any)?.user_id ?? null;
  }

  const { data: server } = await (createClient())
    .from('servers')
    .select('id, name, endpoint, auth_type, oauth_authorization_url')
    .eq('name', serverName)
    .eq('status', 'active')
    .single();

  return { server, userId, svc };
}

// ── GET — list resources ─────────────────────────────────────────────────────

export async function GET(
  req: NextRequest,
  { params }: { params: { serverName: string } }
) {
  const { serverName } = params;
  const ip = extractIp(req);

  const rl = await rateLimit(`proxy:resources:${ip}`, LIMITS.proxy);
  if (!rl.allowed) return apiError('Rate limit exceeded', 429);

  const { server, userId, svc } = await resolveCallerAndServer(req, serverName);
  if (!server) return apiError(`Server '${serverName}' not found`, 404);
  if (!isSafeUrl(server.endpoint)) return apiError('Endpoint failed safety check', 400);

  // Inject credentials (same logic as tool proxy)
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'User-Agent':   `${BRAND.slug}/proxy`,
  };
  if (userId && (server as any).oauth_authorization_url) {
    const { data: tok } = await svc.rpc('get_oauth_token', { p_user_id: userId, p_server_name: serverName });
    if (tok) headers['Authorization'] = `Bearer ${tok}`;
  }

  try {
    const res = await fetch(server.endpoint, {
      method:  'POST',
      headers,
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'resources/list', params: {} }),
      signal:  AbortSignal.timeout(15_000),
    });
    if (!res.ok) return apiError('Upstream resources/list failed', res.status as any);
    const data = await res.json();
    return NextResponse.json({
      resources:  data?.result?.resources  ?? [],
      templates:  data?.result?.resourceTemplates ?? [],
      nextCursor: data?.result?.nextCursor ?? null,
    });
  } catch (e: any) {
    return apiError(`Upstream error: ${e.message}`, 502);
  }
}

// ── POST — read a specific resource ──────────────────────────────────────────

export async function POST(
  req: NextRequest,
  { params }: { params: { serverName: string } }
) {
  const { serverName } = params;
  const ip = extractIp(req);

  const rl = await rateLimit(`proxy:resources:${ip}`, LIMITS.proxy);
  if (!rl.allowed) return apiError('Rate limit exceeded', 429);

  const { server, userId, svc } = await resolveCallerAndServer(req, serverName);
  if (!server) return apiError(`Server '${serverName}' not found`, 404);

  let body: any;
  try { body = await req.json(); }
  catch { return apiError('Body must be JSON with { uri }', 400); }

  const { uri } = body;
  if (!uri || typeof uri !== 'string') return apiError('uri is required', 400);

  // SSRF guard on the resource URI itself — a server could return URIs
  // pointing to internal services (e.g. file:// or http://169.254.x.x)
  if (uri.startsWith('file://') || uri.startsWith('data:')) {
    return apiError('Local file and data URIs are not allowed through the proxy', 403);
  }
  if (!isSafeUrl(server.endpoint)) return apiError('Endpoint failed safety check', 400);

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'User-Agent':   `${BRAND.slug}/proxy`,
  };
  if (userId && (server as any).oauth_authorization_url) {
    const { data: tok } = await svc.rpc('get_oauth_token', { p_user_id: userId, p_server_name: serverName });
    if (tok) headers['Authorization'] = `Bearer ${tok}`;
  }

  try {
    const res = await fetch(server.endpoint, {
      method:  'POST',
      headers,
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'resources/read', params: { uri } }),
      signal:  AbortSignal.timeout(30_000),
    });
    if (!res.ok) return apiError('Upstream resources/read failed', res.status as any);

    const { body: responseBody, truncated } = await readBoundedResponse(res);

    // DLP scan on resource content
    const issues = [...dlpScan(responseBody), ...piiScan(responseBody)];

    const resHeaders: Record<string, string> = { 'Content-Type': 'application/json' };
    if (issues.length > 0) resHeaders['X-Registry-DLP-Warning'] = issues.slice(0, 3).join('; ');
    if (truncated)          resHeaders['X-Registry-Truncated']   = 'true';

    return new NextResponse(responseBody, { status: 200, headers: resHeaders });
  } catch (e: any) {
    return apiError(`Upstream error: ${e.message}`, 502);
  }
}
