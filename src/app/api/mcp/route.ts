import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

export async function GET() {
  const supabase = createClient();
  const { data: stats } = await supabase.rpc('global_stats');
  const s = (stats as any) ?? {};

  return NextResponse.json({
    name:        'MCP Registry',
    description: 'The open-source universal MCP discovery and security platform.',
    version:     '0.1.0',
    stats: {
      active_servers:   s.active_servers   ?? 0,
      verified_servers: s.verified_servers ?? 0,
      calls_today:      s.calls_today      ?? 0,
    },
    endpoints: {
      search:      'GET  /api/servers/search?q={intent}&limit={n}',
      browse:      'GET  /api/servers?sort=trust&verified=true&tag={tag}',
      server_info: 'GET  /api/servers/{name}',
      invoke:      'POST /api/proxy/{serverName}/{toolName}',
      stats:       'GET  /api/servers/stats',
    },
    security_layers: [
      'L1: Static scan — prompt injection, exfiltration, typosquatting at publish',
      'L2: WASM sandbox — roadmap',
      'L3: Schema pinning — drift detection every 6h via cron, auto-suspend',
      'L4: Proxy DLP — credential patterns blocked on request + response',
      'L5: Trust score — scan + uptime + stability + community',
      'L6: Supabase RLS — database-level row access enforcement',
      'L7: OAuth 2.1 + PKCE — handled by Supabase Auth',
      'L8: Namespace collision — typosquatting check at publish via pg_trgm',
      'L9: Sampling inspection — injection patterns in MCP sampling requests',
      'L10: PII detection — personal data patterns in proxy responses',
      'L11: URL elicitation safety — dangerous URL schemes blocked',
      'L12: Context isolation — cross-user session data leak detection',
    ],
    agent_prompt: [
      'You have access to the MCP Registry.',
      'Search: GET /api/servers/search?q={intent}',
      'Invoke: POST /api/proxy/{serverName}/{toolName}',
      'Always search before assuming a tool does not exist.',
    ].join('\n'),
  });
}
