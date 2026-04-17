/**
 * GET /api/auth/me
 *
 * Returns the authenticated user's profile, servers, and API keys.
 *
 * Auth: uses Supabase session cookie (set by middleware).
 * getUser() makes a network round-trip to verify the JWT with Supabase Auth.
 * If that fails (e.g. clock skew, transient), falls back to getSession()
 * which reads the local JWT without network validation — acceptable here
 * because the middleware already verified and refreshed the session on
 * every request via updateSession().
 */
import { NextResponse, type NextRequest } from 'next/server';
import { createClient, createServiceClient } from '@/lib/supabase/server';
import { cookies } from 'next/headers';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const supabase = createClient();

  // Primary: network-verified identity
  let userId: string | null = null;
  let userEmail: string | null = null;

  // Extract auth header as a fallback/explicit mechanism against NextJS 14 cookie drops
  const authHeader = req.headers.get('Authorization');
  const token = authHeader?.startsWith('Bearer ') ? authHeader.split(' ')[1] : undefined;

  const { data: { user }, error: userErr } = token 
    ? await supabase.auth.getUser(token)
    : await supabase.auth.getUser();

  if (user) {
    userId    = user.id;
    userEmail = user.email ?? null;
  } else {
    // Fallback: trust the middleware-refreshed session JWT
    // This handles the case where getUser() fails due to transient network issues
    // while the user genuinely has a valid, middleware-refreshed session.
    const { data: { session } } = await supabase.auth.getSession();
    if (session?.user) {
      userId    = session.user.id;
      userEmail = session.user.email ?? null;
    }
  }

  if (!userId) {
    // Log debug info server-side only — never send to client
    console.error('[auth/me] Unauthorized. getUser error:', userErr?.message);
    
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // Use service client for reads to bypass any RLS edge cases
  // (profiles are public-read anyway, but this is safer for new users
  //  where the profile trigger may not have run yet)
  const svc = createServiceClient();

  const [profileRes, serversRes, keysRes] = await Promise.all([
    svc.from('profiles')
      .select('id, username, avatar_url, created_at')
      .eq('id', userId)
      .maybeSingle(),                             // maybeSingle() — no error if row missing
    svc.from('servers')
      .select('id, name, display_name, stars, total_calls, status, trust_score, created_at')
      .eq('author_id', userId)
      .order('created_at', { ascending: false }),
    svc.from('api_keys')
      .select('id, key_prefix, name, last_used_at, created_at')
      .eq('user_id', userId)
      .order('created_at', { ascending: false }),
  ]);

  // If profile doesn't exist yet (trigger lag), create it now
  let profile = profileRes.data;
  if (!profile) {
    const username = userEmail?.split('@')[0] ?? 'user';
    // Use upsert to handle race conditions where two concurrent requests
    // both see no profile and try to insert simultaneously
    const { data: created } = await svc
      .from('profiles')
      .upsert({ id: userId, username }, { onConflict: 'id', ignoreDuplicates: true })
      .select('id, username, avatar_url, created_at')
      .single();
    profile = created;
  }

  return NextResponse.json({
    user:    { ...profile, email: userEmail },
    servers: serversRes.data ?? [],
    apiKeys: keysRes.data ?? [],
  });
}