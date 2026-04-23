import http from 'node:http';
import { randomUUID } from 'node:crypto';
import nextEnv from '@next/env';
import {
  PROTOTYPE_BASE_URL,
  PROTOTYPE_PORT,
  buildFixtureWorld,
} from './fixture-world.mjs';

const { loadEnvConfig } = nextEnv;
loadEnvConfig(process.cwd());

const fixtures = buildFixtureWorld();
const fixtureByName = new Map(fixtures.map((fixture) => [fixture.name, fixture]));

function sendJson(res, status, payload, extraHeaders = {}) {
  res.writeHead(status, {
    'content-type': 'application/json',
    ...extraHeaders,
  });
  res.end(JSON.stringify(payload));
}

function sendText(res, status, text, extraHeaders = {}) {
  res.writeHead(status, {
    'content-type': 'text/plain; charset=utf-8',
    ...extraHeaders,
  });
  res.end(text);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function pathParts(url) {
  return new URL(url, PROTOTYPE_BASE_URL).pathname.split('/').filter(Boolean);
}

function sseSessionHeaders(fixture) {
  if (fixture.transport !== 'sse') return {};
  return { 'mcp-session-id': `prototype-session-${fixture.name}` };
}

function authError(res, fixture) {
  sendJson(
    res,
    401,
    { jsonrpc: '2.0', error: { code: -32001, message: `${fixture.name} requires Authorization header` } },
    sseSessionHeaders(fixture)
  );
}

function toolResultPayload(fixture, toolName, toolArgs) {
  if (toolName === 'send_email') {
    return {
      ok: true,
      server: fixture.name,
      tool: toolName,
      accepted: Array.isArray(toolArgs.to) ? toolArgs.to : [toolArgs.to ?? null].filter(Boolean),
      subject: toolArgs.subject ?? null,
      html_bytes: typeof toolArgs.html === 'string' ? toolArgs.html.length : 0,
      request_id: randomUUID(),
    };
  }

  return {
    ok: true,
    server: fixture.name,
    tool: toolName,
    received: toolArgs ?? {},
    request_id: randomUUID(),
  };
}

async function handleMcpRequest(req, res, fixture) {
  const rawBody = await readBody(req);
  let payload;

  try {
    payload = rawBody ? JSON.parse(rawBody) : {};
  } catch {
    sendJson(res, 400, { error: 'Invalid JSON body' });
    return;
  }

  if (fixture.behavior === 'auth') {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      authError(res, fixture);
      return;
    }
  }

  if (payload.method === 'initialize') {
    sendJson(
      res,
      200,
      {
        jsonrpc: '2.0',
        id: payload.id ?? 0,
        result: {
          protocolVersion: '2025-03-26',
          capabilities: { tools: { listChanged: false } },
          serverInfo: { name: fixture.displayName, version: fixture.version },
        },
      },
      sseSessionHeaders(fixture)
    );
    return;
  }

  if (payload.method === 'notifications/initialized') {
    res.writeHead(202, sseSessionHeaders(fixture));
    res.end();
    return;
  }

  if (payload.method === 'tools/list') {
    sendJson(
      res,
      200,
      {
        jsonrpc: '2.0',
        id: payload.id ?? 0,
        result: { tools: fixture.toolSchemas },
      },
      sseSessionHeaders(fixture)
    );
    return;
  }

  if (payload.method !== 'tools/call') {
    sendJson(res, 400, { jsonrpc: '2.0', id: payload.id ?? 0, error: { code: -32601, message: 'Method not found' } });
    return;
  }

  const toolName = payload.params?.name;
  const toolArgs = payload.params?.arguments ?? {};
  const toolDef = fixture.toolSchemas.find((item) => item?.name === toolName);

  if (!toolDef) {
    sendJson(
      res,
      404,
      { jsonrpc: '2.0', id: payload.id ?? 0, error: { code: -32601, message: `Unknown tool: ${toolName}` } },
      sseSessionHeaders(fixture)
    );
    return;
  }

  sendJson(
    res,
    200,
    {
      jsonrpc: '2.0',
      id: payload.id ?? 0,
      result: {
        content: [{ type: 'text', text: JSON.stringify(toolResultPayload(fixture, toolName, toolArgs), null, 2) }],
      },
    },
    sseSessionHeaders(fixture)
  );
}

const server = http.createServer(async (req, res) => {
  const parts = pathParts(req.url ?? '/');
  const [kind, name] = parts;

  if (req.method === 'GET' && (req.url ?? '').startsWith('/health')) {
    sendJson(res, 200, { status: 'ok', fixtures: fixtures.length, port: PROTOTYPE_PORT });
    return;
  }

  if (req.method === 'GET' && (req.url ?? '').startsWith('/catalog')) {
    sendJson(res, 200, {
      fixtures: fixtures.map((fixture) => ({
        name: fixture.name,
        transport: fixture.transport,
        behavior: fixture.behavior,
        endpoint: fixture.endpoint,
      })),
    });
    return;
  }

  if (!kind || !name) {
    sendJson(res, 404, { error: 'Unknown route' });
    return;
  }

  const fixture = fixtureByName.get(name);
  if (!fixture) {
    sendJson(res, 404, { error: `Unknown fixture: ${name}` });
    return;
  }

  if (req.method === 'GET' && kind === 'mcp' && fixture.transport === 'sse') {
    res.writeHead(200, {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache',
      connection: 'keep-alive',
    });
    res.write(`event: ready\ndata: ${JSON.stringify({ server: fixture.name })}\n\n`);
    setTimeout(() => res.end(), 1_000);
    return;
  }

  if (req.method !== 'POST') {
    sendJson(res, 405, { error: 'Method not allowed' });
    return;
  }

  if (kind === 'redirect') {
    res.writeHead(307, { location: `${PROTOTYPE_BASE_URL}/mcp/${name}` });
    res.end();
    return;
  }

  if (kind === 'error') {
    sendJson(res, 500, { error: `${name} forced upstream error` });
    return;
  }

  if (kind === 'malformed') {
    sendText(res, 200, '{"jsonrpc":"2.0","result":');
    return;
  }

  if (kind === 'timeout') {
    setTimeout(() => {
      sendJson(res, 200, {
        jsonrpc: '2.0',
        id: 1,
        result: {
          content: [{ type: 'text', text: JSON.stringify({ delayed: true, server: name }) }],
        },
      });
    }, 35_000);
    return;
  }

  if (kind === 'mcp') {
    await handleMcpRequest(req, res, fixture);
    return;
  }

  sendJson(res, 404, { error: 'Unknown route' });
});

server.listen(PROTOTYPE_PORT, '127.0.0.1', () => {
  console.log(`prototype fake MCP server listening on ${PROTOTYPE_BASE_URL}`);
});
