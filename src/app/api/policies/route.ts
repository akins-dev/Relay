/**
 * GET    /api/policies       — list user's tool policies
 * POST   /api/policies       — upsert a policy group
 * DELETE /api/policies?group=... — reset a policy group to default
 */
import { NextRequest, NextResponse }         from 'next/server';
import { createServiceClient }               from '@/lib/supabase/server';
import { resolveUser }                       from '@/lib/auth-server';
import { apiError, zodError }                from '@/lib/api';
import { rateLimit }                         from '@/lib/ratelimit';
import { z }                                 from 'zod';

const UpsertSchema = z.object({
  group_id:  z.string().min(1).max(32),
  patterns:  z.array(z.string().max(64)).min(1).max(20),
  action:    z.enum(['allow', 'confirm', 'block']),
  label:     z.string().max(64),
});

// ── GET — list all policies for user ─────────────────────────────────────────
export async function GET(req: NextRequest) {
  const { user } = await resolveUser(req);
  if (!user) return apiError('Unauthorized', 401);

  const svc = createServiceClient();
  const { data, error } = await svc
    .from('tool_policies')
    .select('id, user_id, server_name, tool_pattern, action, reason, created_at')
    .eq('user_id', user.id)
    .is('server_name', null)
    .order('created_at', { ascending: false });

  if (error) return apiError('Failed to load policies', 500);
  return NextResponse.json({ policies: data ?? [] });
}

// ── POST — upsert a policy group ─────────────────────────────────────────────
export async function POST(req: NextRequest) {
  const { user } = await resolveUser(req);
  if (!user) return apiError('Unauthorized', 401);

  const rl = await rateLimit(`policies:${user.id}`, { limit: 30, windowMs: 60_000 });
  if (!rl.allowed) return apiError('Rate limit exceeded', 429);

  let body: z.infer<typeof UpsertSchema>;
  try { body = UpsertSchema.parse(await req.json()); }
  catch (e) { return zodError(e); }

  const svc = createServiceClient();

  // Delete existing patterns for this group (idempotent)
  const { error: delErr } = await svc
    .from('tool_policies')
    .delete()
    .eq('user_id', user.id)
    .in('tool_pattern', body.patterns)
    .is('server_name', null);
  if (delErr) return apiError('Failed to update policy', 500);

  // If action is the default 'allow', no rows needed
  if (body.action !== 'allow') {
    const rows = body.patterns.map(p => ({
      user_id:      user.id,
      server_name:  null,
      tool_pattern: p,
      action:       body.action,
      reason:       `${body.label}: ${body.action}`,
    }));
    const { error: insErr } = await svc.from('tool_policies').insert(rows);
    if (insErr) return apiError('Failed to save policy', 500);
  }

  return NextResponse.json({ success: true, group: body.group_id, action: body.action });
}

// ── DELETE — reset a specific group to defaults ───────────────────────────────
export async function DELETE(req: NextRequest) {
  const { user } = await resolveUser(req);
  if (!user) return apiError('Unauthorized', 401);

  const patterns = new URL(req.url).searchParams.get('patterns')?.split(',') ?? [];
  if (!patterns.length) return apiError('patterns parameter required', 400);

  const svc = createServiceClient();
  const { error } = await svc
    .from('tool_policies')
    .delete()
    .eq('user_id', user.id)
    .in('tool_pattern', patterns)
    .is('server_name', null);

  if (error) return apiError('Failed to delete policy', 500);
  return NextResponse.json({ success: true });
}
