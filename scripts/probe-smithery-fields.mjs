#!/usr/bin/env node
/**
 * Smithery API Probe — answers critical questions before implementation:
 *
 * Q1: Does `fields=tools,connections,deploymentUrl` on GET /servers return detail-level data?
 * Q2: Do `registry.smithery.ai` and `api.smithery.ai` differ?
 * Q3: What undocumented fields exist in the listing response?
 * Q4: Empirical rate limit measurement
 */

const API_KEY = process.env.SMITHERY_API_KEY;
if (!API_KEY) { console.error('SMITHERY_API_KEY not set'); process.exit(1); }

const HEADERS = {
  Authorization: `Bearer ${API_KEY}`,
  'User-Agent': 'relay-probe/1.0',
  Accept: 'application/json',
};

async function fetchJSON(url) {
  const res = await fetch(url, { headers: HEADERS, signal: AbortSignal.timeout(15_000) });
  return {
    status: res.status,
    headers: Object.fromEntries(res.headers.entries()),
    data: res.ok ? await res.json() : await res.text().catch(() => null),
  };
}

async function main() {
  console.log('═══════════════════════════════════════════════════════════');
  console.log('  SMITHERY API PROBE — Answering Implementation Questions');
  console.log('═══════════════════════════════════════════════════════════\n');

  // ═══════════════════════════════════════════════════════
  // Q2: Base URL comparison (run first — if one fails, we know)
  // ═══════════════════════════════════════════════════════
  console.log('── Q2: Base URL comparison ──────────────────────────────\n');

  const urls = [
    'https://registry.smithery.ai/servers?q=&page=1&pageSize=2',
    'https://api.smithery.ai/servers?q=&page=1&pageSize=2',
  ];

  for (const url of urls) {
    try {
      const { status, data } = await fetchJSON(url);
      const serverCount = data?.servers?.length ?? 0;
      const totalCount = data?.pagination?.totalCount ?? '?';
      const firstServer = data?.servers?.[0]?.qualifiedName ?? 'none';
      console.log(`  ${url.split('//')[1].split('/')[0]}:`);
      console.log(`    Status: ${status}`);
      console.log(`    Servers returned: ${serverCount}`);
      console.log(`    Total count: ${totalCount}`);
      console.log(`    First server: ${firstServer}`);
      console.log(`    Response keys: ${data?.servers?.[0] ? Object.keys(data.servers[0]).join(', ') : 'none'}`);
      console.log();
    } catch (err) {
      console.log(`  ${url.split('//')[1].split('/')[0]}: FAILED — ${err.message}\n`);
    }
  }

  // ═══════════════════════════════════════════════════════
  // Q1: Test `fields` parameter
  // ═══════════════════════════════════════════════════════
  console.log('── Q1: Testing `fields` parameter ──────────────────────\n');

  // Test 1: fields=tools,connections,deploymentUrl on BOTH base URLs
  const fieldTests = [
    { label: 'registry + fields=tools,connections,deploymentUrl', url: 'https://registry.smithery.ai/servers?q=&page=1&pageSize=3&fields=tools,connections,deploymentUrl&isDeployed=true' },
    { label: 'api + fields=tools,connections,deploymentUrl', url: 'https://api.smithery.ai/servers?q=&page=1&pageSize=3&fields=tools,connections,deploymentUrl&isDeployed=true' },
    { label: 'registry + fields=tools,connections,deploymentUrl,resources,prompts', url: 'https://registry.smithery.ai/servers?q=&page=1&pageSize=3&fields=tools,connections,deploymentUrl,resources,prompts&isDeployed=true' },
  ];

  for (const test of fieldTests) {
    try {
      const { status, data } = await fetchJSON(test.url);
      console.log(`  Test: ${test.label}`);
      console.log(`    Status: ${status}`);
      if (data?.servers?.[0]) {
        const s = data.servers[0];
        const keys = Object.keys(s);
        console.log(`    Response keys: ${keys.join(', ')}`);
        console.log(`    Has tools: ${Array.isArray(s.tools)} (count: ${s.tools?.length ?? 'N/A'})`);
        console.log(`    Has connections: ${Array.isArray(s.connections)} (count: ${s.connections?.length ?? 'N/A'})`);
        console.log(`    Has deploymentUrl: ${'deploymentUrl' in s} (value: ${JSON.stringify(s.deploymentUrl ?? 'N/A').slice(0, 80)})`);
        console.log(`    Has resources: ${Array.isArray(s.resources)} (count: ${s.resources?.length ?? 'N/A'})`);
        console.log(`    Has prompts: ${Array.isArray(s.prompts)} (count: ${s.prompts?.length ?? 'N/A'})`);
        if (s.tools?.length > 0) {
          const t = s.tools[0];
          console.log(`    First tool: ${t.name ?? 'unnamed'}`);
          console.log(`    Has inputSchema: ${!!t.inputSchema}`);
          if (t.inputSchema) console.log(`    inputSchema keys: ${Object.keys(t.inputSchema).join(', ')}`);
        }
        if (s.connections?.length > 0) {
          const c = s.connections[0];
          console.log(`    First connection type: ${c.type ?? 'unknown'}`);
          console.log(`    Has configSchema: ${!!c.configSchema}`);
        }
      } else {
        console.log(`    Response: ${JSON.stringify(data).slice(0, 200)}`);
      }
      console.log();
    } catch (err) {
      console.log(`  Test: ${test.label} — FAILED: ${err.message}\n`);
    }
    await new Promise(r => setTimeout(r, 300));
  }

  // ═══════════════════════════════════════════════════════
  // Q3: Undocumented fields in listing response
  // ═══════════════════════════════════════════════════════
  console.log('── Q3: Undocumented fields in listing ──────────────────\n');

  try {
    const { data } = await fetchJSON('https://registry.smithery.ai/servers?q=&page=1&pageSize=5&seed=42&isDeployed=true');
    if (data?.servers) {
      // Check each server for undocumented fields
      const documentedFields = new Set(['id', 'qualifiedName', 'namespace', 'slug', 'displayName',
        'description', 'iconUrl', 'verified', 'useCount', 'remote', 'isDeployed', 'createdAt',
        'homepage', 'bySmithery', 'owner', 'score']);

      const allFields = new Set();
      for (const s of data.servers) {
        for (const k of Object.keys(s)) allFields.add(k);
      }

      const undocumented = [...allFields].filter(f => !documentedFields.has(f));
      console.log(`  Documented fields present: ${[...allFields].filter(f => documentedFields.has(f)).join(', ')}`);
      console.log(`  Undocumented fields: ${undocumented.length > 0 ? undocumented.join(', ') : 'NONE'}`);

      // Check specific fields we use in code
      const s0 = data.servers[0];
      console.log(`\n  Fields our code depends on:`);
      console.log(`    repository: ${'repository' in s0} → ${JSON.stringify(s0.repository ?? 'MISSING')}`);
      console.log(`    updatedAt: ${'updatedAt' in s0} → ${JSON.stringify(s0.updatedAt ?? 'MISSING')}`);
      console.log(`    createdAt: ${'createdAt' in s0} → ${JSON.stringify(s0.createdAt ?? 'MISSING')}`);
    }
  } catch (err) {
    console.log(`  FAILED: ${err.message}`);
  }

  // ═══════════════════════════════════════════════════════
  // Q4: Empirical rate limit measurement
  // ═══════════════════════════════════════════════════════
  console.log('\n── Q4: Rate limit measurement ──────────────────────────\n');

  // Get a few server names for detail fetches
  let testNames = [];
  try {
    const { data } = await fetchJSON('https://registry.smithery.ai/servers?q=&page=1&pageSize=30&seed=12345&isDeployed=true');
    testNames = (data?.servers ?? []).map(s => s.qualifiedName).filter(Boolean);
    console.log(`  Got ${testNames.length} server names for rate limit test`);
  } catch (err) {
    console.log(`  Failed to get test names: ${err.message}`);
  }

  if (testNames.length > 0) {
    let successCount = 0;
    let rateLimitAt = null;
    const startTime = Date.now();

    // Fire requests with small stagger to find the limit
    for (let i = 0; i < Math.min(testNames.length, 25); i++) {
      const name = testNames[i];
      try {
        const res = await fetch(`https://registry.smithery.ai/servers/${encodeURIComponent(name)}`, {
          headers: HEADERS,
          signal: AbortSignal.timeout(10_000),
        });

        if (res.status === 429) {
          const retryAfter = res.headers.get('Retry-After');
          const rateLimit = res.headers.get('x-ratelimit-limit');
          const rateLimitRemaining = res.headers.get('x-ratelimit-remaining');
          const rateLimitReset = res.headers.get('x-ratelimit-reset');
          rateLimitAt = i + 1;
          console.log(`  429 at request #${i + 1} (after ${successCount} successes)`);
          console.log(`    Retry-After: ${retryAfter}`);
          console.log(`    x-ratelimit-limit: ${rateLimit}`);
          console.log(`    x-ratelimit-remaining: ${rateLimitRemaining}`);
          console.log(`    x-ratelimit-reset: ${rateLimitReset}`);
          console.log(`    All response headers: ${JSON.stringify(Object.fromEntries(res.headers.entries()))}`);
          break;
        } else if (res.ok) {
          successCount++;
        } else {
          console.log(`  Unexpected ${res.status} at request #${i + 1}`);
        }
      } catch (err) {
        console.log(`  Network error at request #${i + 1}: ${err.message}`);
      }
      // Small delay between requests — we're probing, not hammering
      await new Promise(r => setTimeout(r, 100));
    }

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(`\n  Results: ${successCount} successes in ${elapsed}s`);
    console.log(`  Rate: ${(successCount / (elapsed)).toFixed(1)} req/s`);
    if (rateLimitAt) {
      console.log(`  Rate limit triggered at request #${rateLimitAt}`);
    } else {
      console.log(`  No rate limit hit in ${successCount} requests (safe zone)`);
    }
  }

  console.log('\n═══════════════════════════════════════════════════════════');
  console.log('  PROBE COMPLETE');
  console.log('═══════════════════════════════════════════════════════════');
}

main().catch(err => { console.error('Fatal:', err); process.exit(1); });
