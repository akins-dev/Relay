import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { BRAND } from '@/lib/brand';
import { SITE_URL } from '@/lib/site';
import {
  SCHEMA_GUIDANCE,
  SEARCH_ACTIVATION_CASES,
  SEARCH_DECISION_RULE,
  SEARCH_DEFLECTION_CASES,
  STDIO_GUIDANCE,
  getAgentBootstrapPrompt,
  getNativeMcpConfigSnippet,
} from '@/lib/agent-guidance';

export async function GET() {
  const supabase = createClient();
  const { data: stats } = await supabase.rpc('global_stats').single();
  const s = (stats as any) ?? {};
  const activeServers = s.active_servers ?? 'many';

  const md = `# ${BRAND.name}

${BRAND.tagline}

${BRAND.name} lets an agent discover useful MCP servers at runtime without preloading every tool schema into context.
It does not run third-party tools for you. It returns the server, tool, package, endpoint, and environment manifest your local agent or ${BRAND.cli} needs.

## When To Search

Call \`search_tools\` when you need to:
${SEARCH_ACTIVATION_CASES.map(item => `- ${item}`).join('\n')}

Do not search when:
${SEARCH_DEFLECTION_CASES.map(item => `- ${item}`).join('\n')}

Decision rule: ${SEARCH_DECISION_RULE}

## Native MCP

Connect once:

\`\`\`json
${getNativeMcpConfigSnippet()}
\`\`\`

Available tools:

- \`search_tools({ intent, limit })\` - find matching MCP servers and relevant tools.
- \`get_server_manifest({ server })\` - fetch the full local run manifest for one server.

## REST Search

\`\`\`
GET ${SITE_URL}/api/servers/search?q={intent}&limit=5
\`\`\`

Important fields:

- \`name\` - server identifier.
- \`description\` - what the server does.
- \`tools\` - relevant tool names and schemas.
- \`manifest.run_mode\` - \`local_stdio\`, \`remote_mcp\`, or \`discovery_only\`.
- \`manifest.launch\` - package command or remote MCP endpoint.
- \`manifest.env\` - required environment variables.
- \`next\` - suggested local CLI invocation.

${SCHEMA_GUIDANCE}
${STDIO_GUIDANCE}

## Example

\`\`\`
GET /api/servers/search?q=create a GitHub pull request

{
  "results": [
    {
      "name": "github",
      "tools": [{ "name": "create_pull_request", "inputSchema": {} }],
      "manifest": {
        "run_mode": "local_stdio",
        "launch": {
          "type": "stdio",
          "command": ["npx", "-y", "@modelcontextprotocol/server-github"]
        },
        "env": [{ "name": "GITHUB_TOKEN", "required": true, "secret": true }]
      },
      "next": "${BRAND.slug} invoke github <tool_name>"
    }
  ]
}
\`\`\`

## Live Registry

- Active servers: ${activeServers}
- Sources: Official MCP Registry, Smithery, Glama, mcp.directory
- MCP server endpoint: ${SITE_URL}/api/mcp-server

## Bootstrap Prompt

\`\`\`
${getAgentBootstrapPrompt()}
\`\`\`

*${BRAND.name} - MIT licensed - built by ${BRAND.org}*
*${BRAND.githubUrl}*
`;

  return new NextResponse(md, {
    headers: {
      'Content-Type': 'text/markdown; charset=utf-8',
      'Cache-Control': 'public, max-age=300',
      'Access-Control-Allow-Origin': '*',
    },
  });
}
