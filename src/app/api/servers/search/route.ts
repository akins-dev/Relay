import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { rateLimit, LIMITS } from '@/lib/ratelimit';
import { extractIp, apiError } from '@/lib/api';

// ── AgentSecrets tutorial — injected into search results when auth is required ─
// Gives the agent everything it needs to guide the user through credential setup.
// Suggested secret names are derived from the server name for consistency.
function buildCredentialSetup(serverName: string, authType: string) {
  if (authType === 'none') return null;

  // Derive canonical secret name for this server
  const base       = serverName.toUpperCase().replace(/-/g, '_').replace(/[^A-Z0-9_]/g, '');
  const apiKeyName = `${base}_API_KEY`;
  const tokenName  = `${base}_TOKEN`;

  return {
    requires_user_auth: authType !== 'none',
    auth_type: authType,

    // ── PRIMARY: openMCP built-in vault ────────────────────────────────────
    // User stores their key in openMCP once. Proxy injects it on every call.
    // No local setup required. Works on all platforms (Claude Desktop, Cursor, etc.)
    openmcp_vault: {
      description: 'Store your credential in openMCP once. The proxy injects it automatically on every call — your agent never sees the raw value.',
      how_it_works: [
        '1. Go to: https://openmcp.dev/dashboard/secrets',
        `2. Click "Add Secret"`,
        `3. Server name: ${serverName}`,
        `4. Secret name: ${apiKeyName}`,
        `5. Value: your API key from the service dashboard`,
        '6. Done — all future calls through openMCP inject it automatically',
      ],
      direct_link: `https://openmcp.dev/dashboard/secrets?server=${serverName}&name=${apiKeyName}`,
      suggested_secret_name: apiKeyName,
    },

    // ── ALTERNATIVE: AgentSecrets local proxy ──────────────────────────────
    // For users who want zero-knowledge local credential management.
    // Credentials stay on their machine, never sent to openMCP servers.
    agentsecrets_local: {
      description: 'Alternative: store credentials in your OS keychain. Never leaves your machine.',
      when_to_use: 'If you prefer credentials to never leave your device, or if you are building your own MCP server.',
      steps: [
        'npm install -g agentsecrets',
        `agentsecrets secrets set ${apiKeyName}=your_actual_key_here`,
        'Add to MCP config: { "agentsecrets": { "command": "agentsecrets", "args": ["serve"] } }',
      ],
      docs: 'https://github.com/the-17/agentsecrets',
    },

    // After setup, the flow is:
    what_happens: `Agent calls tool → openMCP proxy → resolves ${apiKeyName} from vault → injects as Authorization header → upstream server → API → response. Agent never sees the key.`,
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

        // AgentSecrets setup tutorial — present this to the user if they
        // need to configure credentials for this specific server
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
