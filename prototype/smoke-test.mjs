import nextEnv from '@next/env';
import { PROTOTYPE_API_KEY } from './fixture-world.mjs';

const { loadEnvConfig } = nextEnv;
loadEnvConfig(process.cwd());

const appUrl = process.env.PROTOTYPE_APP_URL ?? 'http://localhost:3000';

async function callMcp(body, headers = {}) {
  const response = await fetch(`${appUrl}/api/mcp-server`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...headers,
    },
    body: JSON.stringify(body),
  });

  return response.json();
}

async function main() {
  const search = await callMcp({
    jsonrpc: '2.0',
    id: 1,
    method: 'tools/call',
    params: {
      name: 'search_tools',
      arguments: {
        intent: 'send a transactional email with html body',
        limit: 5,
      },
    },
  });

  const searchText = search?.result?.content?.[0]?.text;
  const parsedSearch = searchText ? JSON.parse(searchText) : null;

  console.log('Search results:');
  console.log(JSON.stringify(parsedSearch, null, 2));

  const topServer = parsedSearch?.results?.[0]?.name ?? 'fx-transactional-mail-sandbox';
  const topTool = parsedSearch?.results?.[0]?.tools?.[0]?.name ?? 'send_email';

  const invoke = await callMcp(
    {
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/call',
      params: {
        name: 'invoke_tool',
        arguments: {
          server: topServer,
          tool: topTool,
          search_event_id: parsedSearch?.search_event_id ?? null,
          intent: parsedSearch?.intent ?? 'send a transactional email with html body',
          args: {
            to: 'user@example.com',
            subject: 'Prototype test',
            html: '<p>Hello from the prototype world</p>',
          },
        },
      },
    },
    { Authorization: `Bearer ${PROTOTYPE_API_KEY}` }
  );

  console.log('Invoke response:');
  console.log(JSON.stringify(invoke, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
