/**
 * pre-ingest-check.ts
 *
 * Programmatic health check for all external systems the ingest pipeline depends on.
 * Run this before any ingest run to catch connection failures early and understand
 * which data sources / enrichment paths will be available.
 *
 * Usage (from project root in WSL):
 *   npx tsx src/scripts/pre-ingest-check.ts
 *
 * Exit code 0 = all systems healthy.
 * Exit code 1 = one or more systems unavailable (review output before ingesting).
 */

import dotenv from 'dotenv';
dotenv.config({ path: '.env' });

// ── Result type ───────────────────────────────────────────────────────────────

interface CheckResult {
  name:      string;
  ok:        boolean;
  latencyMs: number;
  detail:    string;
  /** If false, ingest will still run but this source/path will be degraded. */
  critical:  boolean;
}

// ── Individual checks ─────────────────────────────────────────────────────────

async function checkSupabase(): Promise<CheckResult> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const start = Date.now();

  if (!url || !key) {
    return { name: 'Supabase DB', ok: false, latencyMs: 0, critical: true,
      detail: 'NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY not set' };
  }

  try {
    const res = await fetch(`${url}/rest/v1/servers?select=id&limit=1`, {
      headers: { apikey: key, Authorization: `Bearer ${key}` },
      signal: AbortSignal.timeout(8_000),
    });
    return {
      name: 'Supabase DB', critical: true,
      ok: res.ok,
      latencyMs: Date.now() - start,
      detail: res.ok ? `HTTP ${res.status}` : `HTTP ${res.status} — ${await res.text()}`,
    };
  } catch (e: any) {
    return { name: 'Supabase DB', ok: false, critical: true,
      latencyMs: Date.now() - start, detail: e.message };
  }
}

async function checkSandbox(): Promise<CheckResult> {
  const url   = process.env.SANDBOX_URL;
  const token = process.env.SANDBOX_AUTH_TOKEN;
  const start = Date.now();

  if (!url || !token) {
    return { name: 'Sandbox (Render)', ok: false, latencyMs: 0, critical: false,
      detail: 'SANDBOX_URL or SANDBOX_AUTH_TOKEN not set — stdio servers will fall back to README parsing' };
  }

  try {
    // Allow up to 35s: Render free tier cold-starts can take 20–30s
    const res  = await fetch(`${url}/health`, {
      signal: AbortSignal.timeout(35_000),
      headers: { 'User-Agent': 'relay-pre-ingest-check/1.0' },
    });
    const body = res.ok ? (await res.json() as any) : await res.text();
    const ok   = res.ok && body?.status === 'ok';
    const ms   = Date.now() - start;
    return {
      name: 'Sandbox (Render)', critical: false,
      ok,
      latencyMs: ms,
      detail: ok
        ? `status=ok${ms > 5_000 ? ' ⚠️  slow — cold start detected' : ''}`
        : String(body),
    };
  } catch (e: any) {
    return { name: 'Sandbox (Render)', ok: false, critical: false,
      latencyMs: Date.now() - start, detail: e.message };
  }
}

async function checkSmithery(): Promise<CheckResult> {
  const key   = process.env.SMITHERY_API_KEY;
  const start = Date.now();

  if (!key) {
    return { name: 'Smithery API', ok: false, latencyMs: 0, critical: false,
      detail: 'SMITHERY_API_KEY not set — Smithery source will be skipped during ingest' };
  }

  try {
    const res = await fetch('https://registry.smithery.ai/servers?limit=1', {
      headers: { Authorization: `Bearer ${key}`, 'User-Agent': 'relay-pre-ingest-check/1.0' },
      signal: AbortSignal.timeout(10_000),
    });
    return {
      name: 'Smithery API', critical: false,
      ok: res.ok,
      latencyMs: Date.now() - start,
      detail: `HTTP ${res.status}`,
    };
  } catch (e: any) {
    return { name: 'Smithery API', ok: false, critical: false,
      latencyMs: Date.now() - start, detail: e.message };
  }
}

async function checkOfficialRegistry(): Promise<CheckResult> {
  const start = Date.now();
  try {
    // Official MCP registry is sourced from this GitHub raw file
    const res = await fetch(
      'https://raw.githubusercontent.com/modelcontextprotocol/servers/main/README.md',
      { signal: AbortSignal.timeout(10_000),
        headers: { 'User-Agent': 'relay-pre-ingest-check/1.0' } },
    );
    return {
      name: 'Official MCP Registry (GitHub)', critical: false,
      ok: res.ok,
      latencyMs: Date.now() - start,
      detail: `HTTP ${res.status}`,
    };
  } catch (e: any) {
    return { name: 'Official MCP Registry (GitHub)', ok: false, critical: false,
      latencyMs: Date.now() - start, detail: e.message };
  }
}

async function checkGlama(): Promise<CheckResult> {
  const start = Date.now();
  try {
    const res = await fetch('https://glama.ai/api/mcp/v1/servers?first=1', {
      signal: AbortSignal.timeout(10_000),
      headers: { 'User-Agent': 'relay-pre-ingest-check/1.0' },
    });
    return {
      name: 'Glama API', critical: false,
      ok: res.ok,
      latencyMs: Date.now() - start,
      detail: `HTTP ${res.status}`,
    };
  } catch (e: any) {
    return { name: 'Glama API', ok: false, critical: false,
      latencyMs: Date.now() - start, detail: e.message };
  }
}

async function checkUpstash(): Promise<CheckResult> {
  const url   = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  const start = Date.now();

  if (!url || !token) {
    return { name: 'Upstash Redis', ok: false, latencyMs: 0, critical: false,
      detail: 'Not configured — single-flight cache disabled, search may have higher DB load' };
  }

  try {
    const res  = await fetch(`${url}/ping`, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(5_000),
    });
    const body = await res.json() as any;
    const ok   = res.ok && body?.result === 'PONG';
    return {
      name: 'Upstash Redis', critical: false,
      ok,
      latencyMs: Date.now() - start,
      detail: `PING → ${body?.result ?? 'no result'}`,
    };
  } catch (e: any) {
    return { name: 'Upstash Redis', ok: false, critical: false,
      latencyMs: Date.now() - start, detail: e.message };
  }
}

/**
 * Live MCP protocol probe against a known public server.
 * Validates that mcp-probe's HTTP fetch path is working end-to-end.
 * Uses the same initialize handshake as probeMCPServer() in mcp-probe.ts.
 */
async function probeSampleMCPServer(): Promise<CheckResult> {
  // Use the official "everything" reference server on Smithery — it's always live
  const SAMPLE_ENDPOINT = 'https://server.smithery.ai/@modelcontextprotocol/server-everything/mcp';
  const start = Date.now();

  try {
    const res = await fetch(SAMPLE_ENDPOINT, {
      method:  'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept':       'application/json, text/event-stream',
        'User-Agent':   'relay-pre-ingest-check/1.0',
      },
      body: JSON.stringify({
        jsonrpc: '2.0', id: 1, method: 'initialize',
        params: {
          protocolVersion: '2025-03-26',
          capabilities:    {},
          clientInfo:      { name: 'relay-pre-ingest-check', version: '1.0' },
        },
      }),
      signal: AbortSignal.timeout(10_000),
    });

    if (!res.ok) {
      return { name: 'MCP Probe (sample server)', ok: false, critical: false,
        latencyMs: Date.now() - start, detail: `HTTP ${res.status}` };
    }

    const ct = res.headers.get('content-type') ?? '';
    let data: any;
    if (ct.includes('text/event-stream')) {
      const text  = await res.text();
      const match = text.match(/^data:\s*(.+)$/m);
      data = match ? JSON.parse(match[1]) : null;
    } else {
      data = await res.json();
    }

    const version = data?.result?.protocolVersion as string | undefined;
    return {
      name: 'MCP Probe (sample server)', critical: false,
      ok:        !!version,
      latencyMs: Date.now() - start,
      detail:    version ? `protocolVersion=${version}` : 'No protocolVersion in response — probe logic may be broken',
    };
  } catch (e: any) {
    return { name: 'MCP Probe (sample server)', ok: false, critical: false,
      latencyMs: Date.now() - start, detail: e.message };
  }
}

// ── Runner ────────────────────────────────────────────────────────────────────

export async function runChecks(isCli = false) {
  console.log('\n🔍  Pre-Ingest Connection Health Check');
  console.log('═'.repeat(52));

  const results = await Promise.all([
    checkSupabase(),
    checkSandbox(),
    checkSmithery(),
    checkOfficialRegistry(),
    checkGlama(),
    checkUpstash(),
    probeSampleMCPServer(),
  ]);

  const critical: CheckResult[] = [];
  const degraded: CheckResult[] = [];

  for (const r of results) {
    const icon    = r.ok ? '✅' : (r.critical ? '❌' : '⚠️ ');
    const latency = r.latencyMs > 0 ? ` ${r.latencyMs}ms` : '';
    console.log(`\n${icon}  ${r.name}${latency}`);
    if (!r.ok) {
      console.log(`     ↳ ${r.detail}`);
      (r.critical ? critical : degraded).push(r);
    } else if (r.detail) {
      console.log(`     ↳ ${r.detail}`);
    }
  }

  console.log('\n' + '═'.repeat(52));

  if (critical.length > 0) {
    console.error(`\n❌  CRITICAL failures (${critical.length}): ingest CANNOT run safely.`);
    for (const r of critical) console.error(`   • ${r.name}: ${r.detail}`);
    console.log('');
    if (isCli) process.exit(1);
    return false;
  }

  if (degraded.length > 0) {
    console.warn(`\n⚠️   Degraded systems (${degraded.length}): ingest will run with reduced coverage.`);
    for (const r of degraded) console.warn(`   • ${r.name}: ${r.detail}`);
    console.log('\n✅  Proceeding is safe, but some sources will be unavailable.\n');
    if (isCli) process.exit(0);
    return true;
  }

  console.log('\n✅  All systems healthy — safe to run ingest.\n');
  if (isCli) process.exit(0);
  return true;
}

// Auto-run if executed directly via CLI
if (require.main === module) {
  runChecks(true).catch((e) => {
    console.error('Fatal error in pre-ingest check:', e);
    process.exit(1);
  });
}
