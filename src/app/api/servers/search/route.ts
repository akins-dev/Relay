import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { rateLimit, LIMITS } from '@/lib/ratelimit';
import { extractIp, apiError } from '@/lib/api';

// ── Credential setup — vault instructions injected into search results ─
// Gives the agent everything it needs to guide the user through credential setup.
// Suggested secret names are derived from the server name for consistency.
/**
 * Build credential setup instructions for a server that requires auth.
 * Returned in every search result — gives agents everything needed to
 * guide the user through vault configuration.
 *
 * The openMCP Vault is the only credential storage mechanism.
 * Users store their key once. The proxy injects it on every call.
 * The user can view the secret name but never the value after storage.
 */
function buildCredentialSetup(serverName: string, authType: string) {
  if (authType === 'none') return null;

  const base       = serverName.toUpperCase().replace(/-/g, '_').replace(/[^A-Z0-9_]/g, '');
  const apiKeyName = `${base}_API_KEY`;

  return {
    requires_credential: authType !== 'none',
    auth_type:           authType,
    suggested_secret_name: apiKeyName,

    // Complete setup instructions — agent presents these to the user
    setup: {
      description: `${serverName} requires an API key. Store it once in the openMCP Vault — the proxy injects it on every future call automatically. You can view the secret name but not the value after saving.`,
      steps: [
        `1. Get your API key from the ${serverName} service dashboard`,
        `2. Open: https://openmcp.dev/dashboard/secrets?server=${serverName}&name=${apiKeyName}`,
        `3. Paste your key in the "Value" field and click "Store securely"`,
        `4. Tell your agent to proceed — this call will work automatically from now on`,
      ],
      dashboard_url: `https://openmcp.dev/dashboard/secrets?server=${serverName}&name=${apiKeyName}`,
    },

    // What happens after setup
    flow: `Agent calls tool → openMCP proxy → decrypts ${apiKeyName} from vault → injects as Authorization header → upstream API → response. Raw key never touches agent memory or request arguments.`,
  };
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const q     = (searchParams.get('q') ?? '').trim();
  const limit = Math.min(20, Math.max(1, parseInt(searchParams.get('limit') ?? '5')));

  if (!q) {
    return apiError('Query parameter q is required', 400, { code: 'MISSING_QUERY' });
  }

  const ip = extractIp(req);
  const rl  = await rateLimit(`search:${ip}`, LIMITS.search);
  if (!rl.allowed) {
    return NextResponse.json(
      { error: 'Rate limit exceeded', hint: 'Create a free API key at openmcp.dev for higher limits' },
      { status: 429, headers: { 'Retry-After': '60', 'X-RateLimit-Remaining': '0' } }
    );
  }

  try {
    const supabase = createClient();

    const { data: results, error } = await supabase
      .rpc('search_servers', { query_text: q, result_limit: limit });

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
        auth_type, auth_setup_url,
        profiles!author_id ( username )
      `)
      .in('id', ids)
      .eq('status', 'active');

    if (enrichErr) console.error('[search] Enrich error:', enrichErr.message);

    const rows = (enriched ?? results).map((s: any) => {
      const authType     = s.auth_type ?? 'managed';
      const secretsTutorial = buildCredentialSetup(s.name, authType);

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

        // Full tool schemas — agent MUST read inputSchema before calling
        // inputSchema tells the agent what arguments to pass
        // NEVER include API keys in arguments — the server handles its own credentials
        tools:        s.tools ?? [],
        tool_schemas: (s.tool_schemas?.length ?? 0) > 0
          ? s.tool_schemas
          : (s.tools ?? []).map((name: string) => ({ name })),

        // Credential transparency
        auth_type,
        auth_setup_url: s.auth_setup_url ?? null,
        credential_note: authType === 'none'
          ? 'This server is public — no credentials required.'
          : 'Pass only business data as arguments. The server manages its own credentials. Never include API keys in tool arguments.',

        // Credential setup — vault-based, presented to agent for user guidance
        credential_setup: secretsTutorial,

        // How to invoke
        invoke: {
          rest: `POST /api/proxy/${s.name}/{toolName}`,
          mcp:  `invoke_tool({ server: "${s.name}", tool: "{toolName}", args: {} })`,
        },
      };
    });

    return NextResponse.json({ query: q, count: rows.length, results: rows });

  } catch (err: any) {
    console.error('[search] Unexpected error:', err?.message);
    return apiError('Search failed', 500, { code: 'INTERNAL_ERROR' });
  }
}
