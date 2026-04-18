import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { SITE_URL } from '@/lib/site';
import { BRAND } from '@/lib/brand';

export async function GET() {
  const supabase = createClient();
  const { data: stats } = await supabase.rpc('global_stats');
  const s = (stats as any) ?? {};

  return NextResponse.json({
    name:        BRAND.name,
    version:     '0.1.0',
    description: [
      `Open-source discovery, trust, and invocation layer for the MCP ecosystem.`,
      'Ingests from five sources: official MCP registry, Smithery, Glama, PulseMCP, GitHub. Only servers with HTTP endpoints (SSE or StreamableHTTP) are returned in agent search. stdio-only servers are excluded from proxy invocation.',
      'Every server is scanned through 14 security layers before listing. Runtime proxy adds 5 additional layers on every call.',
      'Agents invoke remote MCP tools through the proxy — request blocking, response scanning, and audit trails on every call.',
    ].join(' '),
    why: {
      problem: '1 in 3 public MCP servers have critical vulnerabilities (Enkrypt AI, 2026). 43% of CVEs are command injection. No existing public registry scans before listing.',
      solution: 'We sit above other registries as a security verification and proxy layer. Same servers, verified metadata, multi-layer scanning, auditable runtime.',
      vs_smithery: 'Smithery is the best developer experience for exploration. We are the layer you use in production — open source, verifiable, with DLP on every call.',
    },
    stats: {
      active_servers:   s.active_servers   ?? 0,
      verified_servers: s.verified_servers ?? 0,
      calls_today:      s.calls_today      ?? 0,
    },
    sources: [
      'github.com/mcp — verified vendor repositories (Google, Stripe, etc.)',
      'registry.modelcontextprotocol.io — official Anthropic registry',
      'registry.smithery.ai — 7,300+ community servers (HTTP endpoint servers only returned in agent search)',
      'github.com/modelcontextprotocol/servers — GitHub-verified servers',
      'direct — servers published directly to this registry',
    ],
    endpoints: {
      search:      'GET  /api/servers/search?q={intent}&limit={n}',
      browse:      'GET  /api/servers?sort=trust&verified=true&tag={tag}&source={source}&page={n}&page_size={n}',
      server_info: 'GET  /api/servers/{name}',
      invoke:      'POST /api/proxy/{serverName}/{toolName}',
      stats:       'GET  /api/servers/stats',
    },
    security_layers: {
      publish_time: [
        'L1: Identity & Telemetry — verified vendors receive base trust. Signals encompass Stars, Uptime, Schema Stability.',
        'L3: Schema pinning — SHA-256 hash at publish, auto-suspend on any drift (rug-pull protection)',
        'L8: Typosquatting — pg_trgm similarity blocks names too close to verified servers',
        'L14: npm CVE scan — package.json scanned against npm audit API for supply chain attacks',
      ],
      runtime_proxy: [
        'L4: DLP — 11 credential patterns blocked on requests. Response matches are surfaced via warning headers and audit logs. Credentials auto-injected from Vault — agents never handle raw keys.',
        'L9: Sampling inspection — injection patterns in MCP server-initiated sampling requests',
        'L10: PII detection — email, phone, SSN, card numbers scanned in responses',
        'L11: URL elicitation safety — javascript:, data:, file://, localhost, SSRF blocked',
        'L12: Context isolation — session tokens and auth values detected in responses',
      ],
      infrastructure: [
        'L5: Trust score — composite 0-100: scan + uptime + stability + community',
        'L6: Supabase RLS — database-level row access, not just app-level',
        'L7: OAuth flow security — validated redirects, state checks, encrypted token storage',
      ],
      coming_soon: [
        'L2: WASM sandbox — pre-listing sandboxed execution for runtime-only payloads (~85% OWASP coverage)',
        `${BRAND.cli} — local bridge for stdio MCP servers with AgentSecrets-backed credentials`,
        'Expanded OAuth coverage and auto-discovery for connected-account servers',
      ],
    },
    agent_usage: {
      system_prompt: [
        `You have access to ${BRAND.name} — a security-verified registry of thousands of MCP servers.`,
        'Every server is scanned across 14 layers before listing. Every proxy call is inspected.',
        `Read ${new URL(BRAND.agentMdRoute, SITE_URL).href} for full documentation before your first tool call.`,
        'Search: GET /api/servers/search?q={your intent}&limit=5',
        'Invoke: POST /api/proxy/{serverName}/{toolName}',
        'If a tool call returns 401: the server needs a credential. The response includes setup_url pointing to your dashboard.',
        'Never assume a tool does not exist. Always search first.',
        'Prefer servers with trust_score > 80 for production use.',
      ].join('\n'),
      trust_score_guide: 'Score 90-100: verified, stable, high uptime. 70-89: good signal. Below 70: use with caution.',
    },
    open_source: `${BRAND.githubUrl} — MIT license`,
  });
}
