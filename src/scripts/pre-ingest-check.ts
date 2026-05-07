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

type SourceProbe = {
  name: string;
  urls: string[];
  headers?: Record<string, string>;
  critical: boolean;
};

const UA = 'relay-pre-ingest-check/1.0';

function trimSlash(value: string): string {
  return value.replace(/\/+$/, '');
}

async function readBody(res: Response): Promise<string> {
  const text = await res.text();
  return text.length > 250 ? `${text.slice(0, 250)}...` : text;
}

async function loadIngestContracts() {
  const [{ probeUptime }, { buildSandboxCommand }] = await Promise.all([
    import('@/lib/mcp-probe'),
    import('@/lib/ingest'),
  ]);
  return { probeUptime, buildSandboxCommand };
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
      const res = await fetch(`${base}/rest/v1/${table}?select=*&limit=1`, {
        headers,
        signal: AbortSignal.timeout(8_000),
      });
      return { table, res, body: res.ok ? '' : await readBody(res) };
    }));

    const failed = checks.filter(c => !c.res.ok);
    return {
      name: 'Supabase DB', critical: true,
      ok: failed.length === 0,
      latencyMs: Date.now() - start,
      detail: failed.length === 0
        ? `tables ok: ${requiredTables.join(', ')}`
        : failed.map(f => `${f.table}=HTTP ${f.res.status} ${f.body}`).join(' | '),
    };
  } catch (e: any) {
    return { name: 'Supabase DB', ok: false, critical: true,
      latencyMs: Date.now() - start, detail: e.message };
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
    const healthRes = await fetch(`${url}/health`, {
      signal: AbortSignal.timeout(35_000),
      headers: { 'User-Agent': UA },
    });
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
        const readyRes = await fetch(`${url}/ready`, {
          signal: AbortSignal.timeout(5_000),
          headers: {
            'User-Agent': UA,
            Authorization: `Bearer ${token}`,
          },
        });
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
        readyDetail = e.message;
      }

      try {
        const capsRes = await fetch(`${url}/capabilities`, {
          signal: AbortSignal.timeout(5_000),
          headers: {
            'User-Agent': UA,
            Authorization: `Bearer ${token}`,
          },
        });

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
        contractDetail = e.message;
      }

      try {
        const extractRes = await fetch(`${url}/extract`, {
          method: 'POST',
          signal: AbortSignal.timeout(5_000),
          headers: {
            'Content-Type': 'application/json',
            'User-Agent': UA,
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ command: '__preflight_disallowed__', args: [] }),
        });
        routeOk = extractRes.status === 400;
        routeDetail = routeOk
          ? 'extract route/auth ok'
          : `extract expected HTTP 400, got HTTP ${extractRes.status}: ${await readBody(extractRes)}`;
      } catch (e: any) {
        routeOk = false;
        routeDetail = e.message;
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

async function checkSourceApis(): Promise<CheckResult> {
  const start = Date.now();
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
      headers: process.env.SMITHERY_API_KEY ? { Authorization: `Bearer ${process.env.SMITHERY_API_KEY}` } : undefined,
      critical: true,
    },
    {
      name: 'smithery-detail-auth',
      urls: [`https://api.smithery.ai/v2/servers/${encodeURIComponent('@smithery-ai/github')}`],
      headers: process.env.SMITHERY_API_KEY ? { Authorization: `Bearer ${process.env.SMITHERY_API_KEY}` } : undefined,
      critical: false,
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
    const results = await Promise.all(probes.map(async probe => {
      const failures: string[] = [];
      for (const url of probe.urls) {
        try {
          const res = await fetch(url, {
            headers: {
              'User-Agent': UA,
              'Accept': 'application/json',
              ...(probe.headers ?? {}),
            },
            signal: AbortSignal.timeout(12_000),
          });
          if (res.ok) {
            return { ...probe, ok: true, status: res.status, body: '' };
          }
          failures.push(`${url}=HTTP ${res.status} ${await readBody(res)}`);
        } catch (e: any) {
          failures.push(`${url}=error ${e.message}`);
        }
      }
      return { ...probe, ok: false, status: 'error', body: failures.join(' || ') };
    }));

    const failed = results.filter(r => !r.ok);
    const criticalFailed = failed.filter(r => r.critical);
    return {
      name: 'Ingest source APIs',
      ok: failed.length === 0,
      latencyMs: Date.now() - start,
      critical: criticalFailed.length > 0,
      detail: failed.length === 0
        ? `reachable: ${results.map(r => r.name).join(', ')}`
        : failed.map(r => `${r.name}=HTTP ${r.status}${r.critical ? '' : ' (non-critical)'} ${r.body}`).join(' | '),
    };
  } catch (e: any) {
    return {
      name: 'Ingest source APIs',
      ok: false,
      latencyMs: Date.now() - start,
      critical: true,
      detail: e.message,
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
        signal: AbortSignal.timeout(10_000),
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
      detail: e.message,
    };
  }
}

// ── Runner ────────────────────────────────────────────────────────────────────

export async function runChecks(isCli = false) {
  console.log('\n🔍  Pre-Ingest Connection Health Check');
  console.log('═'.repeat(52));

  const results = await Promise.all([
    checkSupabase(),
    checkSourceApis(),
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
