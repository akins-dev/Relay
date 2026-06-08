import { NextResponse } from 'next/server';
import { BRAND } from '@/lib/brand';
import { SITE_URL } from '@/lib/site';
import {
  getAgentDocsUrl,
  getMcpServerUrl,
  getNativeMcpConfigSnippet,
  getSearchUrlExample,
} from '@/lib/agent-guidance';

export async function GET() {
  return NextResponse.json(
    {
      name: BRAND.slug,
      display_name: BRAND.name,
      description: BRAND.description,
      version: '0.2.0',
      homepage_url: SITE_URL,
      documentation_url: `${SITE_URL}/docs`,
      agent_instructions_url: getAgentDocsUrl(),
      llms_txt_url: `${SITE_URL}/llms.txt`,
      source_url: BRAND.githubUrl,
      license: 'MIT',
      transport: {
        type: 'streamable_http',
        url: getMcpServerUrl(),
        sse_url: getMcpServerUrl(),
      },
      configuration: {
        mcpServers: JSON.parse(getNativeMcpConfigSnippet()).mcpServers,
      },
      capabilities: {
        tools: [
          {
            name: 'search_tools',
            description: 'Search the Relay registry by natural-language intent and return ranked MCP servers, relevant tools, schemas, and local run manifests.',
            input_schema: {
              type: 'object',
              required: ['intent'],
              properties: {
                intent: { type: 'string' },
                limit: { type: 'integer', minimum: 1, maximum: 20, default: 5 },
              },
            },
          },
          {
            name: 'get_server_manifest',
            description: 'Return the full local run manifest for a server discovered through search_tools.',
            input_schema: {
              type: 'object',
              required: ['server'],
              properties: {
                server: { type: 'string' },
              },
            },
          },
        ],
      },
      rest_endpoints: {
        search: `${getSearchUrlExample()}&limit={n}`,
        metadata: `${SITE_URL}/api/mcp`,
      },
      cli: {
        package: '@relay/cli',
        commands: [
          'npx -y @relay/cli serve',
          'npx -y @relay/cli search "send transactional email"',
          'npx -y @relay/cli info {serverName}',
          'npx -y @relay/cli invoke {serverName} {toolName} --json {jsonArgs}',
        ],
      },
      safety: {
        execution_model: 'discovery-first; local invocation through the user agent or Relay CLI',
        credentials: 'Keep credentials in the local agent or CLI environment. Do not send secrets as tool arguments.',
      },
    },
    {
      headers: {
        'Cache-Control': 'public, max-age=3600',
        'Access-Control-Allow-Origin': '*',
      },
    },
  );
}
