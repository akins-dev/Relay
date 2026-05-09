import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { BRAND } from '@/lib/brand';
import { getAgentBootstrapPrompt, getMcpServerUrl, getSearchUrlExample, getInvokeUrlExample } from '@/lib/agent-guidance';

export async function GET() {
  const supabase = createClient();
  const { data: stats } = await supabase.rpc('global_stats');
  const s = (stats as any) ?? {};

  return NextResponse.json({
    name: BRAND.name,
    version: '0.2.0',
    description: [
      `${BRAND.name} is a lightweight discovery layer for the MCP ecosystem.`,
      'It helps agents find the right server and tool at runtime, then returns a local run manifest.',
      'Invocation is CLI/local-agent first; Relay does not need to control third-party execution.',
    ].join(' '),
    stats: {
      active_servers: s.active_servers ?? 0,
      verified_servers: s.verified_servers ?? 0,
    },
    sources: [
      'registry.modelcontextprotocol.io',
      'registry.smithery.ai',
      'glama.ai',
      'mcp.directory',
      'direct',
    ],
    endpoints: {
      search: `GET ${getSearchUrlExample()}&limit={n}`,
      browse: 'GET /api/servers?sort=trust&verified=true&tag={tag}&source={source}&page={n}&page_size={n}',
      server_info: 'GET /api/servers/{name}',
      local_invoke: getInvokeUrlExample(),
      native_mcp: `POST|GET ${getMcpServerUrl()}`,
      stats: 'GET /api/servers/stats',
    },
    mcp_tools: ['search_tools', 'get_server_manifest'],
    agent_usage: {
      system_prompt: getAgentBootstrapPrompt(),
      search_contract: 'Search returns ranked servers, relevant tools, input schemas, and a manifest for local invocation.',
    },
    open_source: `${BRAND.githubUrl} - MIT license`,
  });
}
