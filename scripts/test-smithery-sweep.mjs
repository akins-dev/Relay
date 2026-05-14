#!/usr/bin/env node
/**
 * Test: Compare deployed vs non-deployed server detail responses from Smithery.
 * Also analyzes transport types across deployed servers.
 */

const API_KEY = process.env.SMITHERY_API_KEY;
if (!API_KEY) { console.error('SMITHERY_API_KEY not set'); process.exit(1); }

const BASE = 'https://registry.smithery.ai/servers';
const HEADERS = {
  Authorization: `Bearer ${API_KEY}`,
  'User-Agent': 'relay-test/1.0',
  Accept: 'application/json',
};

async function fetchJSON(url) {
  const res = await fetch(url, { headers: HEADERS, signal: AbortSignal.timeout(15_000) });
  if (!res.ok) return { _httpStatus: res.status };
  return res.json();
}

async function main() {
  // ═══════════════════════════════════════════════════════════════
  // Q1: What do non-deployed servers actually return?
  // ═══════════════════════════════════════════════════════════════
  console.log('=== Q1: Non-deployed vs Deployed server details ===\n');

  // Get some non-deployed servers
  const listingNotDeployed = await fetchJSON(`${BASE}?q=&page=26&pageSize=10&seed=42`);
  const notDeployedServers = (listingNotDeployed.servers ?? []).filter(s => !s.isDeployed).slice(0, 3);

  // Get some deployed servers for comparison
  const listingDeployed = await fetchJSON(`${BASE}?q=&page=1&pageSize=10&seed=42`);
  const deployedServers = (listingDeployed.servers ?? []).filter(s => s.isDeployed).slice(0, 3);

  console.log('--- NON-DEPLOYED servers detail ---');
  for (const s of notDeployedServers) {
    const detail = await fetchJSON(`${BASE}/${encodeURIComponent(s.qualifiedName)}`);
    console.log(`\n[NOT DEPLOYED] ${s.qualifiedName}`);
    console.log(`  HTTP status: ${detail._httpStatus ?? 200}`);
    console.log(`  deploymentUrl: ${JSON.stringify(detail.deploymentUrl ?? null)}`);
    console.log(`  connections: ${JSON.stringify(detail.connections?.length ?? 0)} items`);
    if (detail.connections?.length > 0) {
      for (const c of detail.connections) {
        console.log(`    → type=${c.type}, url=${c.url ?? 'none'}`);
      }
    }
    console.log(`  tools: ${detail.tools?.length ?? 0} items`);
    if (detail.tools?.length > 0) {
      console.log(`    → first tool: ${detail.tools[0].name}`);
      console.log(`    → has inputSchema: ${!!detail.tools[0].inputSchema}`);
    }
    console.log(`  resources: ${detail.resources?.length ?? 0}`);
    console.log(`  prompts: ${detail.prompts?.length ?? 0}`);
    await new Promise(r => setTimeout(r, 300));
  }

  console.log('\n--- DEPLOYED servers detail ---');
  for (const s of deployedServers) {
    const detail = await fetchJSON(`${BASE}/${encodeURIComponent(s.qualifiedName)}`);
    console.log(`\n[DEPLOYED] ${s.qualifiedName}`);
    console.log(`  deploymentUrl: ${JSON.stringify(detail.deploymentUrl ?? null)}`);
    console.log(`  connections: ${detail.connections?.length ?? 0} items`);
    if (detail.connections?.length > 0) {
      for (const c of detail.connections) {
        console.log(`    → type=${c.type}, url=${c.url ?? 'none'}`);
      }
    }
    console.log(`  tools: ${detail.tools?.length ?? 0} items`);
    if (detail.tools?.length > 0) {
      console.log(`    → first tool: ${detail.tools[0].name}`);
      console.log(`    → has inputSchema: ${!!detail.tools[0].inputSchema}`);
    }
    console.log(`  resources: ${detail.resources?.length ?? 0}`);
    console.log(`  prompts: ${detail.prompts?.length ?? 0}`);
    await new Promise(r => setTimeout(r, 300));
  }

  // ═══════════════════════════════════════════════════════════════
  // Q2: Transport types across deployed servers
  // ═══════════════════════════════════════════════════════════════
  console.log('\n\n=== Q2: Transport types across deployed servers ===\n');

  // Sample 200 deployed servers across different pages
  const transportCounts = {};
  const connectionTypeCounts = {};
  let hasEndpoint = 0;
  let noEndpoint = 0;
  let sampled = 0;

  // Sample from pages 1, 5, 10, 15, 20 (100 servers each, 20 from each page)
  for (const pg of [1, 5, 10, 15, 20]) {
    const listing = await fetchJSON(`${BASE}?q=&page=${pg}&pageSize=20&seed=42`);
    const deployed = (listing.servers ?? []).filter(s => s.isDeployed);

    for (const s of deployed) {
      const detail = await fetchJSON(`${BASE}/${encodeURIComponent(s.qualifiedName)}`);
      if (detail._httpStatus) continue;
      sampled++;

      const connections = detail.connections ?? [];
      for (const c of connections) {
        const t = c.type ?? 'unknown';
        connectionTypeCounts[t] = (connectionTypeCounts[t] ?? 0) + 1;
      }

      if (detail.deploymentUrl) hasEndpoint++;
      else noEndpoint++;

      // Determine primary transport
      let transport = 'unknown';
      for (const c of connections) {
        const t = (c.type ?? '').toLowerCase();
        if (t === 'streamable-http' || t === 'http') { transport = 'streamable_http'; break; }
        if (t === 'sse') { transport = 'sse'; break; }
        if (t === 'stdio') { transport = 'stdio'; break; }
      }
      if (transport === 'unknown' && detail.deploymentUrl) transport = 'streamable_http (implicit)';
      transportCounts[transport] = (transportCounts[transport] ?? 0) + 1;

      await new Promise(r => setTimeout(r, 150));
    }
    console.log(`  Sampled page ${pg}: ${sampled} servers so far...`);
  }

  console.log(`\nTransport distribution (${sampled} deployed servers sampled):`);
  for (const [t, count] of Object.entries(transportCounts).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${t}: ${count} (${((count / sampled) * 100).toFixed(1)}%)`);
  }
  console.log(`\nConnection type raw counts:`);
  for (const [t, count] of Object.entries(connectionTypeCounts).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${t}: ${count}`);
  }
  console.log(`\nWith deploymentUrl: ${hasEndpoint}, Without: ${noEndpoint}`);
}

main().catch(err => { console.error('Fatal:', err); process.exit(1); });
