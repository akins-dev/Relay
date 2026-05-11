/**
 * GET  /api/oauth/connections        — list user's connected OAuth servers
 * DELETE /api/oauth/connections?server=... — disconnect a server
 */
import { NextRequest, NextResponse }         from 'next/server';
import { createClient, createServiceClient } from '@/lib/supabase/server';
import { apiError, extractIp }               from '@/lib/api';
import { rateLimit }                         from '@/lib/ratelimit';
import { resolveUser }                       from '@/lib/auth-server';

export async function GET(req: NextRequest) {
  const { user } = await resolveUser(req);
  if (!user) return apiError('Unauthorized', 401);

  const rl = await rateLimit(`oauth:connections:${user.id}`, { limit: 30, windowMs: 60_000 });
  if (!rl.allowed) return apiError('Rate limit exceeded', 429);

  const svc = createServiceClient();
  const { data, error } = await svc.rpc('list_oauth_connections', { p_user_id: user.id });
  if (error) return apiError('Failed to list connections', 500);

  return NextResponse.json({ connections: data ?? [] });
}

export async function DELETE(req: NextRequest) {
  const serverName = new URL(req.url).searchParams.get('server');
  if (!serverName) return apiError('server parameter required', 400);

  const supabase = createClient();
  const { user } = await resolveUser(req);
  if (!user) return apiError('Unauthorized', 401);

  const svc = createServiceClient();
  const { data: deleted } = await svc.rpc('delete_oauth_connection', {
    p_user_id: user.id, p_server_name: serverName,
  });

  if (!deleted) return apiError('Connection not found', 404);
  return NextResponse.json({ success: true });
}
