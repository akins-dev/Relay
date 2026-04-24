import { NextRequest, NextResponse } from 'next/server';
import { createClient, createServiceClient } from '@/lib/supabase/server';
import { rateLimit, LIMITS } from '@/lib/ratelimit';
import { extractIp, apiError } from '@/lib/api';
import { createHash } from 'crypto';
import { SITE_URL } from '@/lib/site';
import { BRAND } from '@/lib/brand';

// ── Credential setup — vault instructions injected into search results ─
// Gives the agent everything it needs to guide the user through credential setup.
// Suggested secret names are derived from the server name for consistency.
/**
 * Build credential setup instructions for a server that requires auth.
 * Returned in every search result — gives agents everything needed to
 * guide the user through vault configuration.
 *
 * The ${BRAND.vault} is the only credential storage mechanism.
 * Users store their key once. The proxy injects it on every call.
 * The user can view the secret name but never the value after storage.
 */
function buildCredentialSetup(serverName: string, authType: string, connectUrl?: string | null) {
  if (authType === 'none') return null;

  const base       = serverName.toUpperCase().replace(/-/g, '_').replace(/[^A-Z0-9_]/g, '');
  const apiKeyName = `${base}_API_KEY`;

  if (authType === 'oauth') {
    return {
      requires_credential: true,
      auth_type: 'oauth',
      setup: {
        description: `${serverName} uses OAuth. Connect your account once and ${BRAND.name} will use the access token automatically on future calls.`,
        steps: [
          `1. Open: ${connectUrl ?? `${SITE_URL}/registry/${serverName}?connect=1`}`,
          '2. Click "Connect your account"',
          '3. Complete the provider sign-in and consent flow',
          `4. Re-run the tool call — ${BRAND.name} will inject the OAuth token automatically`,
        ],
        connect_url: connectUrl ?? `${SITE_URL}/registry/${serverName}?connect=1`,
      },
      flow: `Agent calls tool -> ${BRAND.name} proxy -> retrieves your OAuth token -> injects Authorization header -> upstream API -> response. Raw token never appears in agent arguments.`,
    };
  }

  if (authType === 'agentsecrets') {
    // AgentSecrets deprecated — all credentials go through the centralized Vault
    return {
      requires_credential: true,
      auth_type: 'api_key',
      suggested_secret_name: apiKeyName,
      setup: {
        description: `${serverName} requires an API key. Store it once in the ${BRAND.vault} — the proxy injects it on every call automatically.`,
        steps: [
          `1. Get your API key from the ${serverName} service dashboard`,
          `2. Open: ${SITE_URL}/dashboard/secrets?server=${serverName}&name=${apiKeyName}`,
          `3. Paste your key in the "Value" field and click "Store securely"`,
          `4. Re-run the tool call — ${BRAND.name} will inject the key automatically`,
        ],
        dashboard_url: `${SITE_URL}/dashboard/secrets?server=${serverName}&name=${apiKeyName}`,
      },
      flow: `Agent calls tool → ${BRAND.name} proxy → decrypts ${apiKeyName} from vault → injects as Authorization header → upstream API → response. Raw key never touches agent memory.`,
    };
  }

  if (authType === 'managed') {
    return {
      requires_credential: true,
      auth_type: 'managed',
      setup: {
        description: `${serverName} may require credentials or an account connection at runtime. Follow the server-specific instructions if the first invocation returns an auth prompt.`,
        steps: [
          `1. Try the tool call once from ${serverName}`,
          '2. If authentication is required, follow the returned setup instructions',
          '3. Re-run the call after setup completes',
        ],
      },
      flow: `${BRAND.name} will return structured auth guidance if the upstream server requires extra setup.`,
    };
  }

  return {
    requires_credential: true,
    auth_type:           authType,
    suggested_secret_name: apiKeyName,

    // Complete setup instructions — agent presents these to the user
    setup: {
      description: `${serverName} requires an API key. Store it once in the ${BRAND.vault} — the proxy injects it on every future call automatically. You can view the secret name but not the value after saving.`,
      steps: [
        `1. Get your API key from the ${serverName} service dashboard`,
        `2. Open: ${SITE_URL}/dashboard/secrets?server=${serverName}&name=${apiKeyName}`,
        `3. Paste your key in the "Value" field and click "Store securely"`,
        `4. Tell your agent to proceed — this call will work automatically from now on`,
      ],
      dashboard_url: `${SITE_URL}/dashboard/secrets?server=${serverName}&name=${apiKeyName}`,
    },

    // What happens after setup
    flow: `Agent calls tool → ${BRAND.name} proxy → decrypts ${apiKeyName} from vault → injects as Authorization header → upstream API → response. Raw key never touches agent memory or request arguments.`,
  };
}

async function resolveApiKeyUser(req: NextRequest): Promise<string | null> {
  const authHeader = req.headers.get('authorization');
  if (!authHeader?.startsWith('Bearer ')) return null;

  const token = authHeader.slice(7);
  if (!token.startsWith('sk_mcp_')) return null;

  const keyHash = createHash('sha256').update(token).digest('hex');
  const svc = createServiceClient();
  const { data } = await svc
    .from('api_keys')
    .select('id, user_id')
    .eq('key_hash', keyHash)
    .single();

  if (!data) return null;

  void svc.from('api_keys')
    .update({ last_used_at: new Date().toISOString() })
    .eq('id', data.id);

  return data.user_id;
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const q     = (searchParams.get('q') ?? '').trim();
  const limit = Math.min(20, Math.max(1, parseInt(searchParams.get('limit') ?? '5')));

  if (!q) {
    return apiError('Query parameter q is required', 400, { code: 'MISSING_QUERY' });
  }

  const ip = extractIp(req);
  const apiKeyUserId = await resolveApiKeyUser(req);
  const rlKey = apiKeyUserId ? `search:user:${apiKeyUserId}` : `search:ip:${ip}`;
  const rlConfig = apiKeyUserId ? LIMITS.proxyAuth : LIMITS.search;
  const rl  = await rateLimit(rlKey, rlConfig);
  if (!rl.allowed) {
    return NextResponse.json(
      { error: 'Rate limit exceeded', hint: `Create a free API key at ${BRAND.domain} for higher limits` },
      {
        status: 429,
        headers: {
          'Retry-After': String(Math.max(1, Math.ceil((rl.resetAt - Date.now()) / 1000))),
          'X-RateLimit-Remaining': '0',
        },
      }
    );
  }

  try {
    const supabase = createClient();

    let rpcResult = await (supabase as any)
      .rpc('search_servers', { query_text: q, result_limit: limit, include_stdio: true });

    // Backwards/forwards compatibility with environments where search_servers()
    // was migrated back to the 2-arg signature.
    if (rpcResult?.error) {
      rpcResult = await (supabase as any)
        .rpc('search_servers', { query_text: q, result_limit: limit });
    }

    const { data: results, error } = rpcResult;

    if (error) {
      console.error('[search] RPC error:', error.message);
      return apiError('Search failed', 500, { code: 'SEARCH_ERROR' });
    }

    if (!results?.length) {
      return NextResponse.json({ query: q, count: 0, results: [],
        message: 'No servers found. Try broader terms.' });
    }

    const ids = results.map((s: any) => s.id);
    const { data: enriched, error: enrichErr } = await supabase
      .from('servers')
      .select(`
        id, name, display_name, description, version, tags, tools, tool_schemas,
        trust_score, verified, source, scan_status, cve_issues,
        latency_ms, uptime_pct, stars, calls_today,
        auth_type, auth_setup_url, oauth_authorization_url,
        transport, endpoint,
        profiles!author_id ( username )
      `)
      .in('id', ids)
      .eq('status', 'active');

    if (enrichErr) console.error('[search] Enrich error:', enrichErr.message);

    const rows = (enriched ?? results).map((s: any) => {
      const authType = s.oauth_authorization_url ? 'oauth' : (s.auth_type ?? 'managed');
      const connectUrl = s.oauth_authorization_url ? `${SITE_URL}/registry/${s.name}?connect=1` : null;
      const secretsTutorial = buildCredentialSetup(s.name, authType, connectUrl);
      const transport = s.transport ?? 'http';
      const isStdio = transport === 'stdio';
      const proxyAvailable = !isStdio && !!s.endpoint;

      return {
        name:         s.name,
        display_name: s.display_name,
        description:  s.description,
        version:      s.version,
        trust_score:  s.trust_score,
        verified:     s.verified,
        source:       s.source ?? 'direct',
        scan_status:  s.scan_status,
        latency_ms:   s.latency_ms,
        uptime_pct:   s.uptime_pct,
        stars:        s.stars,
        calls_today:  s.calls_today,
        tags:         s.tags ?? [],
        author:       s.profiles?.username ?? null,

        // Transport + invocability
        transport,
        proxy_available: proxyAvailable,
        ...(!proxyAvailable && {
          cli_hint: `This is a stdio server. It requires ${BRAND.cli} (coming soon) to invoke locally. The CLI runs as a native MCP server in your agent host and spawns stdio servers on demand — like npx downloads and runs without a permanent install.`,
        }),

        // Full tool schemas — agent MUST read inputSchema before calling
        tools:        s.tools ?? [],
        tool_schemas: (s.tool_schemas?.length ?? 0) > 0
          ? s.tool_schemas
          : (s.tools ?? []).map((name: string) => ({ name })),

        // Credential transparency
        auth_type: authType,
        auth_setup_url: s.auth_setup_url ?? null,
        credential_note: authType === 'none'
          ? 'This server is public — no credentials required.'
          : authType === 'oauth'
            ? `Pass only business data as arguments. If needed, connect your account once and ${BRAND.name} will inject the OAuth token automatically.`
            : `Pass only business data as arguments. Never include API keys in tool arguments. ${BRAND.name} handles credential injection outside the request body.`,

        // Credential setup — vault-based, presented to agent for user guidance
        credential_setup: secretsTutorial,

        // How to invoke (only for proxy-available servers)
        ...(proxyAvailable && {
          invoke: {
            rest: `POST /api/proxy/${s.name}/{toolName}`,
            mcp:  `invoke_tool({ server: "${s.name}", tool: "{toolName}", args: {} })`,
          },
        }),
      };
    });

    return NextResponse.json({ query: q, count: rows.length, results: rows });

  } catch (err: any) {
    console.error('[search] Unexpected error:', err?.message);
    return apiError('Search failed', 500, { code: 'INTERNAL_ERROR' });
  }
}
