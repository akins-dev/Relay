/**
 * openMCP — User Secrets API
 *
 * ⚠️  BEFORE USING THIS API IN PRODUCTION:
 * Disable Supabase statement logging first.
 * Dashboard → Database → Database Settings → Log Settings → Statement log level: none
 * Without this, secrets will appear in your Supabase logs in plaintext.
 *
 * POST   /api/secrets        — store a new secret
 * GET    /api/secrets        — list secrets (metadata only, never values)
 * DELETE /api/secrets?id=... — delete a secret
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient, createServiceClient } from '@/lib/supabase/server';
import { rateLimit, LIMITS } from '@/lib/ratelimit';
import { extractIp, apiError, zodError } from '@/lib/api';

const StoreSchema = z.object({
  server_name:  z.string().optional().nullable(),
  secret_name:  z.string().min(1).max(100).regex(/^[A-Z0-9_]+$/, {
    message: 'Secret name must be uppercase letters, numbers, and underscores only. Example: STRIPE_API_KEY',
  }),
  secret_value: z.string().min(1).max(10_000),
  description:  z.string().max(500).optional(),
});

// ── POST — store a secret ─────────────────────────────────────────────────────
export async function POST(req: NextRequest) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return apiError('Unauthorized', 401);

  // Rate limit — secrets storage is low-frequency
  const ip = extractIp(req);
  const rl  = await rateLimit(`secrets:${user.id}`, { limit: 20, windowMs: 60_000 });
  if (!rl.allowed) return apiError('Rate limit exceeded', 429);

  let body;
  try { body = StoreSchema.parse(await req.json()); }
  catch (e) { return zodError(e); }

  const svc = createServiceClient();

  // Check secret count per user (max 100)
  const { data: existing } = await svc
    .rpc('list_user_secrets', { p_user_id: user.id });

  if ((existing?.length ?? 0) >= 100) {
    return apiError('Maximum 100 secrets per user', 400);
  }

  // Store via vault RPC — never touches plaintext outside the DB function
  const { data: vaultId, error } = await svc
    .rpc('store_user_secret', {
      p_user_id:     user.id,
      p_server_name: body.server_name ?? null,
      p_secret_name: body.secret_name,
      p_secret_value: body.secret_value,
      p_description: body.description ?? null,
    });

  if (error) {
    console.error('[secrets] store error:', error.message);
    return apiError('Failed to store secret', 500);
  }

  return NextResponse.json({
    success:     true,
    vault_id:    vaultId,
    secret_name: body.secret_name,
    server_name: body.server_name ?? null,
    message:     `Secret stored. The proxy will automatically inject ${body.secret_name} when calling ${body.server_name ?? 'any server'}.`,
  });
}

// ── GET — list secrets (metadata only) ───────────────────────────────────────
export async function GET(req: NextRequest) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return apiError('Unauthorized', 401);

  const svc = createServiceClient();
  const { data, error } = await svc
    .rpc('list_user_secrets', { p_user_id: user.id });

  if (error) return apiError('Failed to list secrets', 500);

  // Never return the secret values — metadata only
  return NextResponse.json({
    secrets: (data ?? []).map((s: any) => ({
      id:          s.id,
      server_name: s.server_name,
      secret_name: s.secret_name,
      description: s.description,
      created_at:  s.created_at,
      updated_at:  s.updated_at,
      // Deliberately no value field
    })),
    count: data?.length ?? 0,
  });
}

// ── DELETE — remove a secret ──────────────────────────────────────────────────
export async function DELETE(req: NextRequest) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return apiError('Unauthorized', 401);

  const id = new URL(req.url).searchParams.get('id');
  if (!id) return apiError('Secret ID required', 400);

  const svc = createServiceClient();
  const { data: deleted, error } = await svc
    .rpc('delete_user_secret', { p_user_id: user.id, p_secret_id: id });

  if (error) return apiError('Failed to delete secret', 500);
  if (!deleted) return apiError('Secret not found or not owned by you', 404);

  return NextResponse.json({ success: true });
}
