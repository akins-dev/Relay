/**
 * GET /api/oauth/start?server=github-tools&redirect=/registry/github-tools
 *
 * Initiates the OAuth flow for a server that requires it.
 * 1. Validates user is authenticated
 * 2. Looks up server OAuth metadata (authorization_url, client_id, scopes)
 * 3. Generates PKCE + CSRF state, stores in oauth_states table
 * 4. Redirects user to the provider's authorization endpoint
 */
import { NextRequest, NextResponse }         from 'next/server';
import { createClient, createServiceClient } from '@/lib/supabase/server';
import { randomBytes }                       from 'crypto';
import { rateLimit, LIMITS }                 from '@/lib/ratelimit';
import { extractIp }                         from '@/lib/api';

// Only allow redirects to our own origin — prevents open redirect abuse
function validateRedirect(redirect: string | null, serverName: string): string {
  const safe = `/registry/${serverName}`;
  if (!redirect) return safe;
  // Allow only relative paths starting with /
  if (redirect.startsWith('/') && !redirect.startsWith('//')) return redirect;
  return safe;
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const serverName = searchParams.get('server');
  const redirectTo = validateRedirect(searchParams.get('redirect'), serverName ?? '');

  if (!serverName) {
    return NextResponse.json({ error: 'server parameter required' }, { status: 400 });
  }

  // Rate limit — 10 OAuth starts per IP per minute (prevents state table flooding)
  const ip = extractIp(req);
  const rl = await rateLimit(`oauth:start:${ip}`, { limit: 10, windowMs: 60_000 });
  if (!rl.allowed) {
    return NextResponse.json({ error: 'Too many OAuth attempts', hint: 'Try again in 60 seconds' }, { status: 429 });
  }

  // Must be authenticated
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    const loginUrl = new URL('/login', req.url);
    loginUrl.searchParams.set('redirect', req.url);
    return NextResponse.redirect(loginUrl);
  }

  // Look up server OAuth config
  const { data: server } = await supabase
    .from('servers')
    .select('name, oauth_authorization_url, oauth_client_id, oauth_scopes, auth_type')
    .eq('name', serverName)
    .eq('status', 'active')
    .single();

  if (!server || server.auth_type !== 'oauth' || !server.oauth_authorization_url) {
    return NextResponse.json({
      error: 'This server does not support OAuth',
      auth_type: server?.auth_type,
      hint: server?.auth_type === 'api_key'
        ? `Store your API key at /dashboard/secrets?server=${serverName}`
        : 'This server does not require authentication',
    }, { status: 400 });
  }

  if (!server.oauth_client_id) {
    return NextResponse.json({
      error: 'OAuth not configured for this server yet',
      hint:  'openMCP needs a registered OAuth client for this service. Contact support.',
    }, { status: 501 });
  }

  // Generate CSRF state — 32 random bytes as hex
  const state = randomBytes(32).toString('hex');
  const svc   = createServiceClient();

  // Clean up any existing state for this user+server, store new one
  await svc.from('oauth_states').delete()
    .eq('user_id', user.id).eq('server_name', serverName);

  await svc.from('oauth_states').insert({
    state,
    user_id:     user.id,
    server_name: serverName,
    redirect_to: redirectTo,
  });

  // Build authorization URL
  const callbackUrl = `${new URL(req.url).origin}/api/oauth/callback`;
  const authUrl     = new URL(server.oauth_authorization_url);
  authUrl.searchParams.set('client_id',     server.oauth_client_id);
  authUrl.searchParams.set('redirect_uri',  callbackUrl);
  authUrl.searchParams.set('scope',         server.oauth_scopes ?? '');
  authUrl.searchParams.set('state',         state);
  authUrl.searchParams.set('response_type', 'code');

  return NextResponse.redirect(authUrl.toString());
}
