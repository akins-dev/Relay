import { NextResponse } from 'next/server';
import { BRAND } from '@/lib/brand';
import { SITE_URL } from '@/lib/site';
import {
  API_KEY_HEADER,
  SCHEMA_GUIDANCE,
  SECRET_GUIDANCE,
  getAgentBootstrapPrompt,
  getAgentDocsUrl,
  getMcpServerUrl,
  getNativeMcpConfigSnippet,
  getSearchUrlExample,
} from '@/lib/agent-guidance';

export async function GET() {
  const md = `# ${BRAND.name}

> ${BRAND.tagline}

${BRAND.description}

${BRAND.name} is agent-facing infrastructure for runtime MCP tool discovery. Agents can search by intent, inspect a local run manifest, and invoke through ${BRAND.cli} or a local MCP host without preloading every MCP server into context.

## Agent Entry Points

- Agent skill file: ${getAgentDocsUrl()}
- Native MCP server: ${getMcpServerUrl()}
- Registry metadata: ${SITE_URL}/api/mcp
- REST intent search: ${getSearchUrlExample()}&limit=5
- Registry browser: ${SITE_URL}/registry
- Connection guide: ${SITE_URL}/connect
- Developer docs: ${SITE_URL}/docs
- Source: ${BRAND.githubUrl}

## Native MCP

\`\`\`json
${getNativeMcpConfigSnippet()}
\`\`\`

Tools exposed by ${BRAND.name}:

- \`search_tools({ intent, limit })\`: find relevant MCP servers and tools.
- \`get_server_manifest({ server })\`: fetch package, endpoint, env, schema, and launch details for local invocation.

## CLI-Capable Agents

Install or run the CLI with npm:

\`\`\`bash
npx -y @relay/cli search "send transactional email"
npx -y @relay/cli info resend
npx -y @relay/cli invoke resend send_email --json '{"to":"user@example.com","subject":"Hello","body":"..."}'
npx -y @relay/cli serve
\`\`\`

Use \`serve\` when your host supports local stdio MCP. Use \`search\`, \`info\`, and \`invoke\` when your host can run shell commands.

## Usage Rules

${getAgentBootstrapPrompt()}

${SCHEMA_GUIDANCE}
${SECRET_GUIDANCE}
Use ${API_KEY_HEADER} when available for higher limits and outcome reporting.

## What To Fetch First

1. Fetch \`${BRAND.agentMdRoute}\` for complete agent instructions.
2. Prefer native MCP when supported.
3. Use REST search only when MCP is unavailable.
4. Use returned manifests exactly; do not guess package commands, tool names, or arguments.
`;

  return new NextResponse(md, {
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'public, max-age=3600',
      'Access-Control-Allow-Origin': '*',
    },
  });
}
