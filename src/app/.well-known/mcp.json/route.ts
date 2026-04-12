/**
 * GET /.well-known/mcp.json
 *
 * Machine-readable discovery document for MCP agents.
 * Follows the emerging convention for MCP registry autodiscovery.
 *
 * Agents and CLI tools use this to:
 *   1. Discover available servers without human config
 *   2. Understand supported auth schemes
 *   3. Know the proxy endpoint template
 *   4. Check what capabilities the registry exposes
 *
 * Reference: https://modelcontextprotocol.io/specification/2025-03-26/basic/introduction
 */
import { NextResponse } from 'next/server';
import { SITE_URL }     from '@/lib/site';
import { BRAND }        from '@/lib/brand';

export const dynamic = 'force-dynamic';
export const revalidate = 300; // 5 min cache

export async function GET() {
  const doc = {
    // Registry identity — all values from BRAND constants
    registry: {
      name:        BRAND.name,
      slug:        BRAND.slug,
      version:     '1.0',
      description: BRAND.description,
      tagline:     BRAND.tagline,
      url:         SITE_URL,
      github:      BRAND.githubUrl,
      org:         BRAND.org,
    },

    // Protocol compliance
    mcpSpecVersion: '2025-03-26',
    supportedProtocolVersions: ['2025-03-26', '2024-11-05'],

    // How agents connect — the two-tool MCP interface
    nativeMcpServer: {
      url:        `${SITE_URL}/api/mcp-server`,
      transports: ['streamable_http', 'sse'],
      tools:      ['search_tools', 'invoke_tool'],
      description: `Connect once to get search_tools and invoke_tool as native MCP tools. This is the recommended integration path.`,
    },

    // REST API endpoints (alternative to native MCP connection)
    endpoints: {
      agentSkillFile:  `${SITE_URL}${BRAND.agentMdRoute}`,
      servers:         `${SITE_URL}/api/servers`,
      search:          `${SITE_URL}/api/servers/search`,
      toolProxy:       `${SITE_URL}/api/proxy/{serverName}/{toolName}`,
      resourcesProxy:  `${SITE_URL}/api/proxy/{serverName}/resources`,
      promptsProxy:    `${SITE_URL}/api/proxy/{serverName}/prompts/{promptName}`,
      registryInfo:    `${SITE_URL}/api/mcp`,
    },

    // Authentication methods supported
    authentication: {
      methods: ['bearer_token', 'api_key', 'session_cookie'],
      apiKeyHeader:    'Authorization: Bearer sk_mcp_<your-key>',
      apiKeyDashboard: `${SITE_URL}/dashboard`,
      secretsVault:    `${SITE_URL}/dashboard/secrets`,
      rateLimit: { anonymous: 20, authenticated: 200, window: '1m' },
    },

    // Features currently available
    features: {
      tools:              true,
      resources:          true,
      prompts:            true,
      credentialInjection: true,   // Vault-backed, AES-256-GCM
      policyEnforcement:  true,    // Allow / Confirm / Block per tool
      securityScanning:   true,    // L1-L14 layers
      trustScores:        true,
      uptimeMonitoring:   true,
    },

    // Transport types the proxy can reach
    proxyTransports: ['streamable_http', 'sse'],
    // stdio servers are discoverable in search but not invocable through the web proxy
    discoveryTransports: ['streamable_http', 'sse', 'stdio'],

    // Planned features — not yet available
    planned: {
      cli: {
        name:        BRAND.cli,
        status:      'planned',
        description: 'Local CLI that runs as a native MCP server (stdio). It spawns stdio servers on demand (like npx) and routes HTTP calls to the cloud API, giving agents a single unified interface with full security and audit logging.',
      },
      sdks: {
        status:      'planned',
        description: 'TypeScript and Python SDKs for programmatic registry integration.',
      },
      cloudStdioBridge: {
        status:      'planned',
        description: 'Container-based stdio invocation without local CLI.',
      },
    },

    // Security
    security: {
      scanLayers: [
        'L1: Static injection scan',
        'L3: Schema pinning (SHA-256)',
        'L4: DLP credential detection',
        'L8: Typosquatting detection',
        'L9: MCP sampling injection',
        'S-12: Shell injection',
        'S-13: Indirect prompt injection',
        'S-14: npm CVE scan',
        'L10: PII detection',
        'L11: URL elicitation safety',
        'L12: Context leak detection',
      ],
      ssrfProtection:         true,
      redirectSsrfProtection: true,
      contentTypeSanitization: true,
    },

    // Full catalog
    catalog: `${SITE_URL}/api/servers?limit=100`,
  };

  return NextResponse.json(doc, {
    headers: {
      'Cache-Control': 'public, max-age=300',
      'Access-Control-Allow-Origin': '*', // Discovery doc is public — no credentials involved
      'Content-Type': 'application/json',
    },
  });
}
