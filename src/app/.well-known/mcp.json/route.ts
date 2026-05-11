import { NextResponse } from 'next/server';
import { SITE_URL } from '@/lib/site';
import { BRAND } from '@/lib/brand';

export const dynamic = 'force-dynamic';
export const revalidate = 300;

export async function GET() {
  return NextResponse.json({
    registry: {
      name: BRAND.name,
      slug: BRAND.slug,
      version: '0.2',
      description: BRAND.description,
      tagline: BRAND.tagline,
      url: SITE_URL,
      github: BRAND.githubUrl,
      org: BRAND.org,
    },
    mcpSpecVersion: '2025-03-26',
    supportedProtocolVersions: ['2025-03-26', '2024-11-05'],
    nativeMcpServer: {
      url: `${SITE_URL}/api/mcp-server`,
      transports: ['streamable_http', 'sse'],
      tools: ['search_tools', 'get_server_manifest'],
      description: `Connect once to let agents discover MCP capabilities and local run manifests through ${BRAND.name}.`,
    },
    endpoints: {
      agentSkillFile: `${SITE_URL}${BRAND.agentMdRoute}`,
      servers: `${SITE_URL}/api/servers`,
      search: `${SITE_URL}/api/servers/search`,
      registryInfo: `${SITE_URL}/api/mcp`,
    },
    features: {
      runtimeDiscovery: true,
      localRunManifests: true,
      cloudInvocation: false,
      credentialInjection: false,
      policyEnforcement: false,
      securityScanningRequiredForListing: false,
    },
    discoveryTransports: ['streamable_http', 'sse', 'stdio'],
    cli: {
      name: BRAND.cli,
      invocation: `${BRAND.slug} invoke {serverName} {toolName}`,
      description: 'Local invocation is handled by the user agent or CLI from the returned manifest.',
    },
    catalog: `${SITE_URL}/api/servers?limit=100`,
  }, {
    headers: {
      'Cache-Control': 'public, max-age=300',
      'Access-Control-Allow-Origin': '*',
      'Content-Type': 'application/json',
    },
  });
}
