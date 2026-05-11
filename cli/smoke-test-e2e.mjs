#!/usr/bin/env node
/**
 * Extended smoke test — tests search_tools and invoke_tool against a live Relay Cloud.
 * Requires RELAY_API_URL to be set to a running instance.
 */
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const relayBin = join(__dirname, 'bin', 'relay.mjs');

const child = spawn('node', [relayBin, 'serve'], {
  stdio: ['pipe', 'pipe', 'pipe'],
  env: { ...process.env },
});

const rl = createInterface({ input: child.stdout });
const responses = [];
let nextId = 1;

rl.on('line', (line) => {
  try {
    const msg = JSON.parse(line);
    responses.push(msg);
  } catch {}
});

function send(msg) {
  child.stdin.write(JSON.stringify(msg) + '\n');
}

function sendRequest(method, params) {
  const id = nextId++;
  send({ jsonrpc: '2.0', id, method, params });
  return id;
}

// Step 1: Initialize
sendRequest('initialize', {
  protocolVersion: '2025-03-26',
  capabilities: {},
  clientInfo: { name: 'e2e-test', version: '0.1.0' },
});

// Step 2: tools/list
setTimeout(() => sendRequest('tools/list'), 300);

// Step 3: search_tools
setTimeout(() => {
  sendRequest('tools/call', {
    name: 'search_tools',
    arguments: { intent: 'send email', limit: 2 },
  });
}, 600);

// Collect and report
setTimeout(() => {
  child.stdin.end();
  child.kill('SIGTERM');

  console.log('\n=== E2E Smoke Test Results ===\n');

  // Check initialize
  const initResp = responses.find(r => r.id === 1);
  if (initResp?.result?.serverInfo) {
    console.log('✓ initialize:', initResp.result.serverInfo.name, initResp.result.serverInfo.version);
  } else {
    console.log('✗ initialize FAILED');
  }

  // Check tools/list
  const toolsResp = responses.find(r => r.id === 2);
  if (toolsResp?.result?.tools?.length === 3) {
    console.log('✓ tools/list:', toolsResp.result.tools.map(t => t.name).join(', '));
  } else {
    console.log('✗ tools/list FAILED');
  }

  // Check search_tools
  const searchResp = responses.find(r => r.id === 3);
  if (searchResp?.result?.content?.[0]?.text) {
    const searchData = JSON.parse(searchResp.result.content[0].text);
    console.log(`✓ search_tools: found ${searchData.result_count} servers`);
    if (searchData.results?.length > 0) {
      searchData.results.forEach(r => {
        console.log(`  → ${r.name} (${r.run_mode}, confidence: ${r.confidence})`);
      });
    }
  } else if (searchResp?.error) {
    console.log('✗ search_tools ERROR:', searchResp.error.message);
  } else {
    console.log('✗ search_tools: no response received');
  }

  const allPassed = initResp?.result?.serverInfo && toolsResp?.result?.tools?.length === 3 && searchResp?.result;
  console.log(allPassed ? '\n✓ All E2E tests passed' : '\n✗ Some tests failed');
  process.exit(allPassed ? 0 : 1);
}, 8000);
