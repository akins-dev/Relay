/**
 * auth-server.ts
 *
 * Shared server-side auth helper that resolves the current user from either:
 *  1. An explicit `Authorization: Bearer <token>` header (preferred — bypasses
 *     the Next.js 14 chunked-cookie bug that causes AuthSessionMissingError)
 *  2. The standard Supabase SSR cookie session (fallback for browsers that
 *     don't send the explicit header)
 *
 * Usage:
 *   const { user, supabase } = await resolveUser(req);
 *   if (!user) return apiError('Unauthorized', 401);
 */

import { NextRequest } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import type { User } from '@supabase/supabase-js';

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
