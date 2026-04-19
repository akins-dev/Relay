/**
 * auth-server.ts
 *
 * Shared server-side auth helpers.
 *
 * resolveUser — resolves the current Supabase session user from:
 *   1. Authorization: Bearer <supabase-jwt> header (preferred)
 *   2. Supabase SSR cookie session (browser fallback)
 *
 * resolveApiKey — resolves an Agentrail API key (sk_mcp_...) to a user.
 *   Single source of truth — previously duplicated across mcp-server and proxy routes.
 *   Caches the key lookup in Redis/memory for 5 minutes to avoid repeated DB hits.
 *
 * resolveCallerUserId — combines both: returns the userId from either an API key
 *   or a session cookie, preferring the API key when both are present.
 */

import { NextRequest }             from 'next/server';
import { createClient, createServiceClient } from '@/lib/supabase/server';
import { createHash }              from 'crypto';
import { withCache }               from '@/lib/cache';
import type { User }               from '@supabase/supabase-js';

// ── Session user ──────────────────────────────────────────────────────────────

export async function resolveUser(
  req: NextRequest
): Promise<{ user: User | null; supabase: ReturnType<typeof createClient> }> {
  const supabase = createClient();

  const authHeader = req.headers.get('Authorization');
  const token = authHeader?.startsWith('Bearer ') ? authHeader.split(' ')[1] : undefined;

  const { data: { user } } = token
    ? await supabase.auth.getUser(token)
    : await supabase.auth.getUser();

  return { user: user ?? null, supabase };
}

// ── API key (sk_mcp_...) resolution ───────────────────────────────────────────

export async function resolveApiKey(
  req: NextRequest
): Promise<{ userId: string | null; keyId: string | null }> {
  const authHeader = req.headers.get('authorization');
  if (!authHeader?.startsWith('Bearer ')) return { userId: null, keyId: null };

  const token = authHeader.slice(7);
  if (!token.startsWith('sk_mcp_')) return { userId: null, keyId: null };

  const keyHash = createHash('sha256').update(token).digest('hex');
  const cacheKey = `apiKey:${keyHash}`;

  return withCache(cacheKey, 300, async () => {
    const svc = createServiceClient();
    const { data } = await svc
      .from('api_keys')
      .select('id, user_id')
      .eq('key_hash', keyHash)
      .single();

    if (!data) return { userId: null, keyId: null };

    // Fire-and-forget last_used_at update
    svc.from('api_keys')
      .update({ last_used_at: new Date().toISOString() })
      .eq('id', data.id)
      .catch(() => {});

    return { userId: data.user_id, keyId: data.id };
  });
}

// ── Combined caller resolution ────────────────────────────────────────────────
// Tries API key first, falls back to session cookie.
// Returns the userId and whether it came from an API key.

export async function resolveCallerUserId(
  req: NextRequest
): Promise<{ userId: string | null; keyId: string | null; fromApiKey: boolean }> {
  const apiKey = await resolveApiKey(req);
  if (apiKey.userId) {
    return { userId: apiKey.userId, keyId: apiKey.keyId, fromApiKey: true };
  }

  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser().catch(() => ({ data: { user: null } }));
  return { userId: user?.id ?? null, keyId: null, fromApiKey: false };
}