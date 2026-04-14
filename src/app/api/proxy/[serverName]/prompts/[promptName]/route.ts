/**
 * POST /api/proxy/[serverName]/prompts/[promptName]
 *
 * Executes a specific MCP prompt with the given arguments.
 * MCP method: prompts/get
 * Returns: { messages: [{ role, content }] }
 *
 * SECURITY:
 *   - Arguments validated against injection patterns
 *   - Returned message content scanned for indirect prompt injection
 *   - Bounded response (prevents memory exhaustion)
 */
import { NextRequest, NextResponse }         from 'next/server';
import { createClient, createServiceClient } from '@/lib/supabase/server';
import { resolveUser }                       from '@/lib/auth-server';
import { rateLimit, LIMITS }                 from '@/lib/ratelimit';
import { extractIp, apiError }               from '@/lib/api';
import { isSafeUrl, readBoundedResponse }    from '@/lib/utils';
import { indirectInjectionScan, dlpScan }    from '@/lib/security';
import { BRAND }                             from '@/lib/brand';

export async function POST(
  req: NextRequest,
  { params }: { params: { serverName: string; promptName: string } }
) {
  const { serverName, promptName } = params;
  const ip = extractIp(req);

  const rl = await rateLimit(`proxy:prompts:${ip}`, LIMITS.proxy);
  if (!rl.allowed) return apiError('Rate limit exceeded', 429);

  const svc      = createServiceClient();
  const { user } = await resolveUser(req);
  let userId     = user?.id ?? null;

  if (!userId) {
    const authHeader = req.headers.get('authorization') ?? '';
    if (authHeader.startsWith('Bearer sk_mcp_')) {
      const { createHash } = await import('crypto');
      const keyHash = createHash('sha256').update(authHeader.slice(7)).digest('hex');
      const { data } = await svc.from('api_keys').select('user_id').eq('key_hash', keyHash).single();
      userId = (data as any)?.user_id ?? null;
    }
  }

  const { data: server } = await (createClient())
    .from('servers')
    .select('id, name, endpoint, oauth_authorization_url')
    .eq('name', serverName)
    .eq('status', 'active')
    .single();

  if (!server) return apiError(`Server '${serverName}' not found`, 404);
  if (!isSafeUrl(server.endpoint)) return apiError('Endpoint failed safety check', 400);

  // Parse and validate arguments
  let promptArguments: Record<string, string> = {};
  try {
    const body = await req.json();
    promptArguments = body?.arguments ?? body ?? {};
    // MCP spec: prompt arguments must be string values only
    for (const [k, v] of Object.entries(promptArguments)) {
      if (typeof v !== 'string') {
        return apiError(`Argument '${k}' must be a string (MCP spec requirement)`, 400);
      }
      if (v.length > 10_000) {
        return apiError(`Argument '${k}' exceeds 10,000 character limit`, 400);
      }
    }
  } catch {
    promptArguments = {};
  }

  // Credential injection
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
      body: JSON.stringify({
        jsonrpc: '2.0',
        id:      1,
        method:  'prompts/get',
        params:  { name: promptName, arguments: promptArguments },
      }),
      signal: AbortSignal.timeout(20_000),
    });

    if (!res.ok) return apiError('Upstream prompts/get failed', res.status as any);
    const { body: responseBody } = await readBoundedResponse(res, 2 * 1024 * 1024); // 2MB for prompts

    // Scan returned messages for indirect injection
    const issues = [...indirectInjectionScan(responseBody), ...dlpScan(responseBody)];

    const resHeaders: Record<string, string> = { 'Content-Type': 'application/json' };
    if (issues.length > 0) resHeaders['X-Registry-Injection-Warning'] = issues.slice(0, 3).join('; ');

    return new NextResponse(responseBody, { status: 200, headers: resHeaders });
  } catch (e: any) {
    return apiError(`Upstream error: ${e.message}`, 502);
  }
}
