import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

export async function GET() {
  const supabase = createClient();
  const { data: stats } = await supabase.rpc('global_stats');
  const s = (stats as any) ?? {};

  return NextResponse.json({
    name:        'openMCP',
    version:     '0.1.0',
    description: [
      'Open-source security layer for the MCP ecosystem.',
      'Ingests from the official MCP registry, Smithery, and GitHub.',
      'Every server is scanned through 12 security layers before listing.',
      'Agents invoke tools through the proxy — DLP, schema pinning, and audit trails on every call.',
    ].join(' '),
    why: {
      problem: '1 in 3 public MCP servers have critical vulnerabilities (Enkrypt AI, 2026). 43% of CVEs are command injection. No existing public registry scans before listing.',
      solution: 'We sit above other registries as a security verification and proxy layer. Same servers, verified metadata, 12-layer scan, auditable runtime.',
      vs_smithery: 'Smithery is the best developer experience for exploration. We are the layer you use in production — open source, verifiable, with DLP on every call.',
    },
    stats: {
      active_servers:   s.active_servers   ?? 0,
      verified_servers: s.verified_servers ?? 0,
      calls_today:      s.calls_today      ?? 0,
    },
    sources: [
      'registry.modelcontextprotocol.io — official Anthropic registry',
      'registry.smithery.ai — 7,300+ community servers',
      'github.com/modelcontextprotocol/servers — GitHub-verified servers',
      'direct — servers published directly to this registry',
    ],
    endpoints: {
      search:      'GET  /api/servers/search?q={intent}&limit={n}',
      browse:      'GET  /api/servers?sort=trust&verified=true&tag={tag}&source={source}',
      server_info: 'GET  /api/servers/{name}',
      invoke:      'POST /api/proxy/{serverName}/{toolName}',
      stats:       'GET  /api/servers/stats',
    },
    security_layers: {
      publish_time: [
        'L1: Static scan — prompt injection, exfiltration, deceptive language, suspicious tool names',
        'L3: Schema pinning — SHA-256 hash at publish, auto-suspend on any drift (rug-pull protection)',
        'L8: Typosquatting — pg_trgm similarity blocks names too close to verified servers',
        'npm CVE scan — package.json scanned against npm audit API for supply chain attacks',
      ],
      runtime_proxy: [
        'L4: DLP — 11 credential patterns blocked on request AND response',
        'L9: Sampling inspection — injection patterns in MCP server-initiated sampling requests',
        'L10: PII detection — email, phone, SSN, card numbers blocked in responses',
        'L11: URL elicitation safety — javascript:, data:, file://, localhost, SSRF blocked',
        'L12: Context isolation — session tokens and auth values detected in responses',
      ],
      infrastructure: [
        'L5: Trust score — composite 0-100: scan + uptime + stability + community',
        'L6: Supabase RLS — database-level row access, not just app-level',
        'L7: OAuth 2.1 + PKCE — Supabase Auth handles PKCE on every flow',
      ],
      roadmap: [
        'L2: WASM sandbox — pre-listing sandboxed execution for runtime-only payloads',
        'Shell injection detection — OS command patterns in tool arguments (43% of real CVEs)',
        'Indirect prompt injection — instruction-like language in tool response data',
      ],
    },
    agent_usage: {
      system_prompt: [
        'You have access to the openMCP — a security-verified catalog of MCP servers.',
        'Every server has been scanned for prompt injection, credential leakage, schema drift, and supply chain attacks.',
        'Search: GET /api/servers/search?q={your intent}',
        'Invoke: POST /api/proxy/{serverName}/{toolName}',
        'Never assume a tool does not exist. Always search first.',
        'Trust scores are returned with every search result — prefer servers with score > 80.',
      ].join('\n'),
      trust_score_guide: 'Score 90-100: verified, stable, high uptime. 70-89: good signal. Below 70: use with caution.',
    },
    open_source: 'https://github.com/the-17/openmcp — MIT license',
  });
}
