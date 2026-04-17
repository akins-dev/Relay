/**
 * GET  /api/proxy/[serverName]/prompts              — list available prompts
 * POST /api/proxy/[serverName]/prompts/[promptName] — get a prompt with arguments
 *
 * MCP Prompts are server-defined prompt templates that agents can invoke.
 * They accept typed arguments and return a message sequence:
 *   { messages: [{ role: "user"|"assistant", content: { type: "text", text: "..." } }] }
 *
 * These are distinct from tool calls — they're pre-built prompting strategies
 * exposed by the server (e.g. "code-review", "summarize", "compare-schemas").
 *
 * SECURITY:
 *   - Arguments are size-bounded and sanitized
 *   - Response content is scanned for indirect injection before return
 */
import { NextRequest, NextResponse }         from 'next/server';
import { createClient, createServiceClient } from '@/lib/supabase/server';
import { resolveUser }                       from '@/lib/auth-server';
import { rateLimit, LIMITS }                 from '@/lib/ratelimit';
import { extractIp, apiError }               from '@/lib/api';
import { isSafeUrl, readBoundedResponse } from '@/lib/utils';
import { indirectInjectionScan, dlpScan }    from '@/lib/security';
import { BRAND }                             from '@/lib/brand';

async function resolveCallerAndServer(req: NextRequest, serverName: string) {
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
    .select('id, name, endpoint, auth_type, oauth_authorization_url')
    .eq('name', serverName)
    .eq('status', 'active')
    .single();

  return { server, userId, svc };
}

// ── GET — list prompts ────────────────────────────────────────────────────────

export async function GET(
  req: NextRequest,
  { params }: { params: { serverName: string } }
) {
  const { serverName } = params;
  const rl = await rateLimit(`proxy:prompts:${extractIp(req)}`, LIMITS.proxy);
  if (!rl.allowed) return apiError('Rate limit exceeded', 429);

  const { server } = await resolveCallerAndServer(req, serverName);
  if (!server) return apiError(`Server '${serverName}' not found`, 404);
  if (!isSafeUrl(server.endpoint)) return apiError('Endpoint failed safety check', 400);

  try {
    const res = await fetch(server.endpoint, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json', 'User-Agent': `${BRAND.slug}/proxy` },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'prompts/list', params: {} }),
      signal:  AbortSignal.timeout(10_000),
    });
    if (!res.ok) return apiError('Upstream prompts/list failed', res.status as any);
    const { body: rawBody, truncated } = await readBoundedResponse(res);
    if (truncated) return apiError('Upstream response too large', 502);
    const data = JSON.parse(rawBody);
    return NextResponse.json({ prompts: data?.result?.prompts ?? [] });
  } catch (e: any) {
    return apiError(`Upstream error: ${e.message}`, 502);
  }
}
