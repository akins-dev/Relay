#!/usr/bin/env node
/**
 * Smoke test for the local MCP server.
 * Pipes JSON-RPC messages to `relay serve` and prints responses.
 */
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const relayBin = join(__dirname, 'bin', 'relay.mjs');

const child = spawn('node', [relayBin, 'serve'], {
  stdio: ['pipe', 'pipe', 'pipe'],
});

const rl = createInterface({ input: child.stdout });
const responses = [];
let started = false;
let stderr = '';
let childError = null;

rl.on('line', (line) => {
  try {
    const msg = JSON.parse(line);
    responses.push(msg);
    console.log('RESPONSE:', JSON.stringify(msg, null, 2));
  } catch {}
});

child.stderr.on('data', (chunk) => {
  stderr += chunk.toString();
  if (!started && stderr.includes('MCP server started')) {
    started = true;
    runLifecycle();
  }
});

child.on('error', (err) => {
  childError = err;
});

function send(msg) {
  child.stdin.write(JSON.stringify(msg) + '\n');
}

function runLifecycle() {
  send({
    jsonrpc: '2.0',
    id: 1,
    method: 'initialize',
    params: {
      protocolVersion: '2025-03-26',
      capabilities: {},
      clientInfo: { name: 'smoke-test', version: '0.1.0' },
    },
  });

  send({
    jsonrpc: '2.0',
    id: 2,
    method: 'tools/list',
  });

  send({
    jsonrpc: '2.0',
    id: 3,
    method: 'ping',
  });
}

// Finish after getting responses
setTimeout(() => {
  child.stdin.end();
  child.kill('SIGTERM');

  console.log('\n--- Summary ---');
  console.log(`Responses received: ${responses.length}`);

  const initResp = responses.find(r => r.id === 1);
  if (initResp?.result?.serverInfo) {
    console.log('✓ initialize:', initResp.result.serverInfo.name, initResp.result.serverInfo.version);
    console.log('  instructions length:', initResp.result.instructions?.length ?? 0, 'chars');
  } else {
    console.log('✗ initialize failed');
  }

  const toolsResp = responses.find(r => r.id === 2);
  if (toolsResp?.result?.tools) {
    console.log('✓ tools/list:', toolsResp.result.tools.map(t => t.name).join(', '));
  } else {
    console.log('✗ tools/list failed');
  }

  const pingResp = responses.find(r => r.id === 3);
  if (pingResp?.result !== undefined) {
    console.log('✓ ping: ok');
  } else {
    console.log('✗ ping failed');
  }

  const success = responses.length >= 3;
  if (!success && stderr.trim()) {
    console.log('\nstderr:');
    console.log(stderr.trim());
  }
  if (!success && childError) {
    console.log('\nchild process error:');
    console.log(childError.message);
  }
  console.log(success ? '\n✓ All smoke tests passed' : '\n✗ Some tests failed');
  process.exit(success ? 0 : 1);
}, 5000);
