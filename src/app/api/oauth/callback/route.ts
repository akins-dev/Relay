/**
 * GET /api/oauth/callback?code=...&state=...
 *
 * OAuth 2.0 callback handler.
 * 1. Validates CSRF state from oauth_states table
 * 2. Exchanges authorization code for access + refresh tokens
 * 3. Stores tokens encrypted in Supabase Vault via store_oauth_connection()
 * 4. Deletes used state
 * 5. Redirects user back to where they started
 *
 * ⚠️ IMPORTANT: Ensure your Supabase project does not log data statements
 * before this route processes real user tokens. See migration 011 header.
 */
import { NextRequest, NextResponse }         from 'next/server';
import { createClient, createServiceClient } from '@/lib/supabase/server';
import { rateLimit }                         from '@/lib/ratelimit';
import { extractIp }                         from '@/lib/api';

export async function GET(req: NextRequest) {
  const origin = new URL(req.url).origin;

  // Rate limit — callback is public-facing, prevent abuse
  const ip = extractIp(req);
  const rl = await rateLimit(`oauth:callback:${ip}`, { limit: 20, windowMs: 60_000 });
  if (!rl.allowed) {
    return NextResponse.redirect(`${origin}/dashboard?oauth_error=rate_limited`);
  }

  const { searchParams } = new URL(req.url);
  const code  = searchParams.get('code');
  const state = searchParams.get('state');
  const error = searchParams.get('error');

  // Provider denied or errored — sanitise the error value before embedding in URL
  if (error) {
    // Only allow known OAuth error codes — never reflect arbitrary strings
    const SAFE_ERRORS = ['access_denied','server_error','temporarily_unavailable','invalid_scope'];
    const safeError = SAFE_ERRORS.includes(error) ? error : 'unknown_error';
    return NextResponse.redirect(`${origin}/dashboard?oauth_error=${safeError}`);
  }

  if (!code || !state) {
    return NextResponse.json({ error: 'Missing code or state parameter' }, { status: 400 });
  }

  const svc = createServiceClient();

  // Validate CSRF state — must exist and not be expired
  const { data: stateRow } = await svc
    .from('oauth_states')
    .select('*')
    .eq('state', state)
    .gt('expires_at', new Date().toISOString())
    .single();

  if (!stateRow) {
    return NextResponse.json({
      error: 'Invalid or expired OAuth state. Please try connecting again.',
    }, { status: 400 });
  }

  const { user_id, server_name, redirect_to } = stateRow;

  // Clean up state immediately after use — single-use CSRF token
  await svc.from('oauth_states').delete().eq('state', state);

  // Look up server OAuth config
  const { data: server } = await svc
    .from('servers')
    .select('oauth_token_url, oauth_client_id')
    .eq('name', server_name)
    .single();

  if (!server?.oauth_token_url || !server?.oauth_client_id) {
    return NextResponse.json({ error: 'Server OAuth not configured' }, { status: 500 });
  }

  // Client secret lives in env — never in DB
  const clientSecret = process.env[`OAUTH_SECRET_${server_name.toUpperCase().replace(/-/g, '_')}`];
  if (!clientSecret) {
    return NextResponse.json({
      error: `OAuth client secret not configured for ${server_name}`,
    }, { status: 500 });
  }

  // Exchange code for tokens
  const callbackUrl = `${new URL(req.url).origin}/api/oauth/callback`;
  let tokenData: any;

  try {
    const tokenRes = await fetch(server.oauth_token_url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Accept':        'application/json',
      },
      body: new URLSearchParams({
        grant_type:    'authorization_code',
        code,
        redirect_uri:  callbackUrl,
        client_id:     server.oauth_client_id,
        client_secret: clientSecret,
      }),
      signal: AbortSignal.timeout(10_000),
    });

    if (!tokenRes.ok) {
      const errText = await tokenRes.text();
      console.error(`[oauth] Token exchange failed for ${server_name}:`, errText);
      return NextResponse.json({ error: 'Token exchange failed' }, { status: 502 });
    }

    tokenData = await tokenRes.json();
  } catch (err: any) {
    console.error(`[oauth] Token exchange error for ${server_name}:`, err.message);
    return NextResponse.json({ error: 'Token exchange error', message: err.message }, { status: 502 });
  }

  if (!tokenData.access_token) {
    return NextResponse.json({ error: 'No access token received from provider' }, { status: 502 });
  }

  // Calculate expiry if provider gives expires_in
  const expiresAt = tokenData.expires_in
    ? new Date(Date.now() + tokenData.expires_in * 1000).toISOString()
    : null;

  // Store tokens encrypted in vault
  const { data: stored } = await svc.rpc('store_oauth_connection', {
    p_user_id:       user_id,
    p_server_name:   server_name,
    p_access_token:  tokenData.access_token,
    p_refresh_token: tokenData.refresh_token ?? null,
    p_scope:         tokenData.scope ?? null,
    p_expires_at:    expiresAt,
  });

  if (!stored) {
    return NextResponse.json({ error: 'Failed to store OAuth tokens' }, { status: 500 });
  }

  // Success — redirect user back
  // redirect_to was validated at oauth/start time (relative paths only)
  // but re-validate here as defence in depth
  const safePath = (redirect_to && redirect_to.startsWith('/') && !redirect_to.startsWith('//'))
    ? redirect_to
    : `/registry/${server_name}`;
  const successUrl = new URL(safePath, origin);
  successUrl.searchParams.set('connected', '1');
  return NextResponse.redirect(successUrl.toString());
}
