import { NextResponse } from 'next/server';

export async function GET() {
  return NextResponse.json({
    name: 'MCP Registry',
    description: 'Universal MCP discovery and security platform. Query this endpoint to find any MCP server by capability.',
    version: '0.1.0',
    endpoints: {
      search: 'GET /api/servers/search?q={intent}',
      browse: 'GET /api/servers',
      invoke: 'POST /api/proxy/{serverName}/{toolName}',
      server_info: 'GET /api/proxy/{serverName}',
      stats: 'GET /api/servers/stats',
    },
    agent_prompt: 'Call /api/servers/search?q=your+intent to find servers. Then POST to /api/proxy/{serverName}/{toolName} to invoke tools through the secure proxy. All invocations are DLP-scanned and audited.',
    security: {
      layers: ['static-scan', 'schema-pinning', 'proxy-dlp', 'trust-score'],
      credential_injection: 'Credentials injected at proxy layer via AgentSecrets — never exposed to agent memory',
    },
  });
}
