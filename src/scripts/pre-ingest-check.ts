/**
 * pre-ingest-check.ts
 *
 * Programmatic health check for ingest prerequisites.
 * Checks the systems and contracts ingest depends on before an ingest run:
 * - DB (Supabase)
 * - Source APIs (Official, Smithery, Glama, mcp.directory)
 * - Sandbox (stdio extraction service)
 * - Cache (Upstash Redis, optional)
 * - Probe (MCP initialize handshake against live registry endpoints)
 *
 * Usage (from project root in WSL):
 *   npx tsx src/scripts/pre-ingest-check.ts
 *
 * Exit code 0 = all systems healthy.
 * Exit code 1 = one or more systems unavailable (review output before ingesting).
 */

import dotenv from 'dotenv';
dotenv.config({ path: '.env' });

// Guard: running `npx tsx` from Windows against a \\wsl.localhost UNC path
// can cause Node to default cwd to C:\Windows and fail to resolve relative imports.
if (process.platform === 'win32' && /\\windows$/i.test(process.cwd().replace(/\//g, '\\'))) {
  console.error(
    '\n❌  pre-ingest-check must be run inside WSL (Linux) for this repo.\n' +
      '    Reason: Windows Node cannot use a \\\\wsl.localhost UNC path as cwd and defaults to C:\\\\Windows.\n' +
      '    Fix: open an Ubuntu/WSL terminal and run:\n' +
      '      cd /home/akins-dev/projects/mcp-registry-next && npx tsx src/scripts/pre-ingest-check.ts\n'
  );
  process.exit(1);
}

// ── Result type ───────────────────────────────────────────────────────────────

interface CheckResult {
  name:      string;
  ok:        boolean;
  latencyMs: number;
  detail:    string;
  /** If false, ingest will still run but this source/path will be degraded. */
  critical:  boolean;
}

interface CheckOptions {
  /** Strict mode is the CLI gate before an actual ingest. Background mode is dev diagnostics. */
  strict: boolean;
}

type SourceProbe = {
  name: string;
  urls: string[];
  headers?: Record<string, string>;
  critical: boolean;
};

type SourceResult = SourceProbe & {
  ok: boolean;
  status: number | string;
  body: string;
};

const UA = 'relay-pre-ingest-check/1.0';
const DB_TIMEOUT_MS = Number(process.env.PRE_INGEST_DB_TIMEOUT_MS || 15_000);
const SOURCE_TIMEOUT_MS = Number(process.env.PRE_INGEST_SOURCE_TIMEOUT_MS || 20_000);
const CACHE_TIMEOUT_MS = Number(process.env.PRE_INGEST_CACHE_TIMEOUT_MS || 10_000);
const PROBE_DB_TIMEOUT_MS = Number(process.env.PRE_INGEST_PROBE_DB_TIMEOUT_MS || 15_000);

function trimSlash(value: string): string {
  return value.replace(/\/+$/, '');
}

async function readBody(res: Response): Promise<string> {
  const text = await res.text();
  return text.length > 250 ? `${text.slice(0, 250)}...` : text;
}

function describeError(e: any): string {
  const parts = [
    e?.message,
    e?.cause?.code,
    e?.cause?.message,
  ].filter(Boolean);
  return parts.length > 0 ? Array.from(new Set(parts)).join(' — ') : String(e);
}

async function fetchWithRetry(url: string, init: RequestInit, attempts = 2): Promise<Response> {
  let lastError: any;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      return await fetch(url, init);
    } catch (e: any) {
      lastError = e;
      if (attempt < attempts) {
        await new Promise(resolve => setTimeout(resolve, 1_000 * attempt));
      }
    }
  }
  throw lastError;
}

async function loadIngestContracts() {
  const [{ probeUptime }, { buildSandboxCommand }] = await Promise.all([
    import('@/lib/mcp-probe'),
    import('@/lib/ingest'),
  ]);
  return { probeUptime, buildSandboxCommand };
}

// ── Individual checks ─────────────────────────────────────────────────────────

async function checkSupabase(options: CheckOptions): Promise<CheckResult> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const start = Date.now();

  if (!url || !key) {
    return { name: 'Supabase DB', ok: false, latencyMs: 0, critical: true,
      detail: 'NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY not set' };
  }

  try {
    const base = trimSlash(url);
    const headers = { apikey: key, Authorization: `Bearer ${key}` };
    const requiredTables = [
      'servers',
      'profiles',
      'ingest_runs',
      'scan_results',
      'server_connection_profiles',
    ];

    const checks = await Promise.all(requiredTables.map(async table => {
      try {
        const res = await fetch(`${base}/rest/v1/${table}?select=*&limit=1`, {
          headers,
          signal: AbortSignal.timeout(DB_TIMEOUT_MS),
        });
        return { table, ok: res.ok, status: res.status, body: res.ok ? '' : await readBody(res) };
      } catch (e: any) {
        return { table, ok: false, status: 'error', body: describeError(e) };
      }
    }));

    const failed = checks.filter(c => !c.ok);
    return {
      name: 'Supabase DB', critical: options.strict,
      ok: failed.length === 0,
      latencyMs: Date.now() - start,
      detail: failed.length === 0
        ? `tables ok: ${requiredTables.join(', ')}`
        : failed.map(f => `${f.table}=HTTP ${f.status} ${f.body}`).join(' | '),
    };
  } catch (e: any) {
    return { name: 'Supabase DB', ok: false, critical: options.strict,
      latencyMs: Date.now() - start, detail: describeError(e) };
  }
}

async function checkSandbox(): Promise<CheckResult> {
  const rawUrl = process.env.SANDBOX_URL;
  const token = process.env.SANDBOX_AUTH_TOKEN;
  const start = Date.now();

  if (!rawUrl) {
    return {
      name: 'Sandbox (Render)',
      ok: false,
      latencyMs: 0,
      critical: false,
      detail: 'SANDBOX_URL not set — stdio servers will fall back to README parsing',
    };
  }

  try {
    const url = trimSlash(rawUrl);
    // Allow up to 35s: Render free tier cold-starts can take 20–30s
    const healthRes = await fetchWithRetry(`${url}/health`, {
      signal: AbortSignal.timeout(35_000),
      headers: { 'User-Agent': UA },
    }, 3);
    const healthBody = healthRes.ok ? (await healthRes.json() as any) : await healthRes.text();
    const healthOk = healthRes.ok && healthBody?.status === 'ok';

    // If a token is configured, validate auth and the command contract without spawning packages.
    let readyOk: boolean | null = null;
    let readyDetail: string | null = null;
    let contractOk: boolean | null = null;
    let contractDetail: string | null = null;
    let routeOk: boolean | null = null;
    let routeDetail: string | null = null;

    if (token) {
      try {
        const readyRes = await fetchWithRetry(`${url}/ready`, {
          signal: AbortSignal.timeout(5_000),
          headers: {
            'User-Agent': UA,
            Authorization: `Bearer ${token}`,
          },
        }, 2);
        // Back-compat: older sandbox deployments won't have /ready yet.
        // In that case we can't validate the token here, but /extract will still be auth-gated.
        if (readyRes.status === 404) {
          readyOk = null;
          readyDetail = 'missing (deploy sandbox update to enable auth readiness check)';
        } else {
          const readyBody = readyRes.ok ? (await readyRes.json() as any) : await readyRes.text();
          readyOk = readyRes.ok && readyBody?.status === 'ok';
          readyDetail = readyOk ? null : String(readyBody);
        }
      } catch (e: any) {
        readyOk = false;
        readyDetail = describeError(e);
      }

      try {
        const capsRes = await fetchWithRetry(`${url}/capabilities`, {
          signal: AbortSignal.timeout(5_000),
          headers: {
            'User-Agent': UA,
            Authorization: `Bearer ${token}`,
          },
        }, 2);

        if (capsRes.status === 404) {
          contractOk = null;
          contractDetail = 'missing (deploy sandbox update to enable command contract check)';
        } else if (!capsRes.ok) {
          contractOk = false;
          contractDetail = `HTTP ${capsRes.status}: ${await readBody(capsRes)}`;
        } else {
          const caps = await capsRes.json() as any;
          const allowed = Array.isArray(caps.allowedCommands) ? caps.allowedCommands : [];
          const { buildSandboxCommand } = await loadIngestContracts();
          const expectedCommands = [
            buildSandboxCommand({ smithery_id: 'owner/server' })?.command,
            buildSandboxCommand({
              package_info: [{ registryType: 'npm', identifier: '@modelcontextprotocol/server-filesystem', transport: 'stdio' }],
            })?.command,
            buildSandboxCommand({
              package_info: [{ registryType: 'pypi', identifier: 'mcp-server-demo', transport: 'stdio' }],
            })?.command,
          ].filter((c): c is string => Boolean(c));
          const missing = Array.from(new Set(expectedCommands)).filter(command => !allowed.includes(command));
          contractOk = missing.length === 0;
          contractDetail = contractOk
            ? `allowed=${allowed.join(',')} maxArgs=${caps.maxArgCount ?? 'unknown'}`
            : `missing allowed command(s): ${missing.join(', ')}; sandbox allows ${allowed.join(',') || 'none'}`;
        }
      } catch (e: any) {
        contractOk = false;
        contractDetail = describeError(e);
      }

      try {
        const extractRes = await fetchWithRetry(`${url}/extract`, {
          method: 'POST',
          signal: AbortSignal.timeout(5_000),
          headers: {
            'Content-Type': 'application/json',
            'User-Agent': UA,
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ command: '__preflight_disallowed__', args: [] }),
        }, 2);
        routeOk = extractRes.status === 400;
        routeDetail = routeOk
          ? 'extract route/auth ok'
          : `extract expected HTTP 400, got HTTP ${extractRes.status}: ${await readBody(extractRes)}`;
      } catch (e: any) {
        routeOk = false;
        routeDetail = describeError(e);
      }
    }

    const ok = healthOk && (readyOk ?? true) && (contractOk ?? true) && (routeOk ?? true);
    const ms = Date.now() - start;
    return {
      name: 'Sandbox (Render)', critical: false,
      ok,
      latencyMs: ms,
      detail: ok
        ? [
            `health=ok`,
            token
              ? (readyOk === null ? `ready=${readyDetail}` : 'ready=ok')
              : 'ready=skipped (SANDBOX_AUTH_TOKEN not set)',
            token
              ? (contractOk === null ? `capabilities=${contractDetail}` : `capabilities=${contractDetail}`)
              : null,
            token ? routeDetail : null,
            ms > 5_000 ? '⚠️  slow — cold start detected' : null,
          ].filter(Boolean).join(' | ')
        : [
            healthOk ? 'health=ok' : `health=${String(healthBody)}`,
            token
              ? (readyOk === null ? `ready=${readyDetail}` : (readyOk ? 'ready=ok' : `ready=${readyDetail ?? 'not ok'}`))
              : 'ready=skipped (SANDBOX_AUTH_TOKEN not set)',
            token
              ? (contractOk === null ? `capabilities=${contractDetail}` : (contractOk ? `capabilities=${contractDetail}` : `capabilities=${contractDetail ?? 'not ok'}`))
              : 'capabilities=skipped (SANDBOX_AUTH_TOKEN not set)',
            token
              ? (routeOk ? routeDetail : `extract=${routeDetail ?? 'not ok'}`)
              : 'extract=skipped (SANDBOX_AUTH_TOKEN not set)',
          ].join(' | '),
    };
  } catch (e: any) {
    return { name: 'Sandbox (Render)', ok: false, critical: false,
      latencyMs: Date.now() - start, detail: describeError(e) };
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
      signal: AbortSignal.timeout(CACHE_TIMEOUT_MS),
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
      latencyMs: Date.now() - start, detail: describeError(e) };
  }
}

async function checkSmitheryDetailApi(headers: Record<string, string>): Promise<SourceResult> {
  const probe: SourceProbe = {
    name: 'smithery-detail-auth',
    urls: ['https://registry.smithery.ai/servers/{qualifiedName-from-listing}'],
    headers,
    critical: false,
  };

  try {
    const listingRes = await fetch('https://registry.smithery.ai/servers?q=&page=1&pageSize=10', {
      headers: {
        'User-Agent': UA,
        'Accept': 'application/json',
        ...headers,
      },
      signal: AbortSignal.timeout(SOURCE_TIMEOUT_MS),
    });
    if (!listingRes.ok) {
      return {
        ...probe,
        ok: false,
        status: listingRes.status,
        body: `could not pick detail sample from listing -> HTTP ${listingRes.status} ${await readBody(listingRes)}`,
      };
    }

    const listing = await listingRes.json() as any;
    const entries = Array.isArray(listing.servers) ? listing.servers : [];
    const qualifiedName = entries.find((s: any) => typeof s?.qualifiedName === 'string')?.qualifiedName;
    if (!qualifiedName) {
      return {
        ...probe,
        ok: true,
        status: 'skipped',
        body: 'listing returned no qualifiedName to detail-check',
      };
    }

    const detailUrl = `https://registry.smithery.ai/servers/${encodeURIComponent(qualifiedName)}`;
    const detailRes = await fetch(detailUrl, {
      headers: {
        'User-Agent': UA,
        'Accept': 'application/json',
        ...headers,
      },
      signal: AbortSignal.timeout(SOURCE_TIMEOUT_MS),
    });

    return {
      ...probe,
      urls: [detailUrl],
      ok: detailRes.ok,
      status: detailRes.status,
      body: detailRes.ok
        ? `sample=${qualifiedName}`
        : `${detailUrl} -> HTTP ${detailRes.status} ${await readBody(detailRes)}`,
    };
  } catch (e: any) {
    return {
      ...probe,
      ok: false,
      status: 'error',
      body: describeError(e),
    };
  }
}

async function checkSourceApis(options: CheckOptions): Promise<CheckResult> {
  const start = Date.now();
  const smitheryHeaders = process.env.SMITHERY_API_KEY
    ? { Authorization: `Bearer ${process.env.SMITHERY_API_KEY}` }
    : undefined;
  const probes: SourceProbe[] = [
    {
      name: 'official',
      urls: [
        'https://registry.modelcontextprotocol.io/v0/servers?limit=1',
        'https://registry.modelcontextprotocol.io/v0.1/servers?limit=1',
      ],
      critical: true,
    },
    {
      name: 'smithery-listing',
      urls: ['https://registry.smithery.ai/servers?q=&page=1&pageSize=1'],
      headers: smitheryHeaders,
      critical: true,
    },
    {
      name: 'glama',
      urls: ['https://glama.ai/api/mcp/v1/servers?first=1'],
      critical: false,
    },
    {
      name: 'mcp.directory',
      urls: ['https://mcp.directory/api/v1/servers?limit=1&offset=0'],
      critical: false,
    },
  ];

  if (!process.env.SMITHERY_API_KEY) {
    return {
      name: 'Ingest source APIs',
      ok: false,
      latencyMs: 0,
      critical: true,
      detail: 'SMITHERY_API_KEY not set — primary Smithery ingest will be skipped',
    };
  }

  try {
    const results: SourceResult[] = await Promise.all(probes.map(async probe => {
      const failures: string[] = [];
      for (const url of probe.urls) {
        try {
          const res = await fetch(url, {
            headers: {
              'User-Agent': UA,
              'Accept': 'application/json',
              ...(probe.headers ?? {}),
            },
            signal: AbortSignal.timeout(SOURCE_TIMEOUT_MS),
          });
          if (res.ok) {
            return { ...probe, ok: true, status: res.status, body: '' };
          }
          failures.push(`${url} -> HTTP ${res.status} ${await readBody(res)}`);
        } catch (e: any) {
          failures.push(`${url} -> ${describeError(e)}`);
        }
      }
      return { ...probe, ok: false, status: 'error', body: failures.join(' || ') };
    }));

    const listingOk = results.some(r => r.name === 'smithery-listing' && r.ok);
    if (listingOk && smitheryHeaders) {
      results.push(await checkSmitheryDetailApi(smitheryHeaders));
    }

    const failed = results.filter(r => !r.ok);
    const criticalFailed = failed.filter(r => r.critical);
    return {
      name: 'Ingest source APIs',
      ok: failed.length === 0,
      latencyMs: Date.now() - start,
      critical: options.strict && criticalFailed.length > 0,
      detail: failed.length === 0
        ? `reachable: ${results.map(r => r.name).join(', ')}`
        : failed.map(r => `${r.name}${r.critical ? '' : ' (non-critical)'}: ${r.body}`).join(' | '),
    };
  } catch (e: any) {
    return {
      name: 'Ingest source APIs',
      ok: false,
      latencyMs: Date.now() - start,
      critical: options.strict,
      detail: describeError(e),
    };
  }
}

/**
 * Live MCP protocol probe against a known public server.
 * Validates that our probe logic can reach REAL endpoints from the registry.
 *
 * This uses the same code path as production uptime checks (`probeUptime`)
 * and selects a small sample of active, unauthenticated HTTP servers from DB.
 */
async function probeRegistryEndpoints(): Promise<CheckResult> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const start = Date.now();

  if (!url || !key) {
    return {
      name: 'MCP Probe (registry endpoints)',
      ok: false,
      latencyMs: 0,
      critical: false,
      detail: 'Supabase env not set — cannot sample endpoints to probe',
    };
  }

  try {
    const { probeUptime } = await loadIngestContracts();
    // Only probe endpoints we can check without credentials, mirroring uptime cron:
    // - status=active
    // - endpoint present
    // - not stdio
    // - auth_type not api_key/oauth (unauthenticated probe would be misleading)
    const res = await fetch(
      `${url}/rest/v1/servers?select=name,endpoint,transport,auth_type&status=eq.active&endpoint=not.is.null&transport=not.eq.stdio&auth_type=not.in.(api_key,oauth)&order=updated_at.desc&limit=3`,
      {
        headers: { apikey: key, Authorization: `Bearer ${key}` },
        signal: AbortSignal.timeout(PROBE_DB_TIMEOUT_MS),
      }
    );

    if (!res.ok) {
      return {
        name: 'MCP Probe (registry endpoints)',
        ok: false,
        latencyMs: Date.now() - start,
        critical: false,
        detail: `DB query failed: HTTP ${res.status} — ${await res.text()}`,
      };
    }

    const rows = (await res.json()) as Array<{ name: string; endpoint: string | null }>;
    const endpoints = rows.map(r => r.endpoint).filter((e): e is string => typeof e === 'string' && e.length > 0);
    if (endpoints.length === 0) {
      return {
        name: 'MCP Probe (registry endpoints)',
        ok: true,
        latencyMs: Date.now() - start,
        critical: false,
        detail: 'No eligible unauthenticated HTTP endpoints found to probe (skipped)',
      };
    }

    // Probe sequentially to keep output deterministic and reduce outbound burst.
    let up = 0;
    let mcp = 0;
    for (const endpoint of endpoints) {
      const r = await probeUptime(endpoint);
      if (r.up) up++;
      if (r.mcpCompliant) mcp++;
    }

    const ms = Date.now() - start;
    return {
      name: 'MCP Probe (registry endpoints)',
      ok: up > 0,
      latencyMs: ms,
      critical: false,
      detail: `probed=${endpoints.length} up=${up} mcpCompliant=${mcp}`,
    };
  } catch (e: any) {
    return {
      name: 'MCP Probe (registry endpoints)',
      ok: false,
      latencyMs: Date.now() - start,
      critical: false,
      detail: describeError(e),
    };
  }
}

// ── Runner ────────────────────────────────────────────────────────────────────

export async function runChecks(isCli = false, options: Partial<CheckOptions> = {}) {
  const checkOptions: CheckOptions = {
    strict: options.strict ?? isCli,
  };

  console.log(`\n🔍  Pre-Ingest Connection Health Check${checkOptions.strict ? '' : ' (background diagnostics)'}`);
  console.log('═'.repeat(52));

  const results = await Promise.all([
    checkSupabase(checkOptions),
    checkSourceApis(checkOptions),
    checkSandbox(),
    checkUpstash(),
    probeRegistryEndpoints(),
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
    console.warn(`\n⚠️   Degraded systems (${degraded.length}): ${checkOptions.strict ? 'ingest will run with reduced coverage' : 'background check only; run npm run check:connections before ingest'}.`);
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
