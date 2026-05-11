import { createServiceClient }        from '@/lib/supabase/server';
import { isSafeUrl }                  from '@/lib/utils';
import { computeTrustScore }          from '@/lib/security';
import { probeUptime }                from '@/lib/mcp-probe';
import { log }                        from '@/lib/logger';

export async function runUptimeCheck() {
  const svc = createServiceClient();
  const results = { checked: 0, up: 0, down: 0, errors: 0 };

  // Track cron job run for admin dashboard
  let cronRun: { id: string } | null = null;
  try {
    const { data } = await svc.from('cron_job_runs').insert({
      job_name: 'uptime_check', status: 'running',
    }).select('id').single();
    cronRun = (data as any) ?? null;
  } catch (err) {
    log.warn('cron:uptime', 'Could not create cron_job_runs entry', err);
  }

  const pageSize = 500;
  let from = 0;
  let servers: any[] = [];
  let error: any = null;

  while (true) {
    const page = await svc
      .from('servers')
      .select('id, name, endpoint, uptime_pct, trust_score, verified, stars, latency_ms, scan_issues, last_scanned_at, auth_type')
      .eq('status', 'active')
      .not('endpoint', 'is', null)
      .order('name', { ascending: true })
      .range(from, from + pageSize - 1);

    if (page.error) {
      error = page.error;
      break;
    }

    const rows = page.data ?? [];
    servers = servers.concat(rows);
    if (rows.length < pageSize) break;
    from += pageSize;
  }

  // S14: Fetch behavioral reliability in one SQL-aggregated RPC call.
  // Before: .from('intent_server_mappings').in('server_name', names)
  //   → fetches ALL matching ISM rows across all intent hashes, then TS aggregates.
  //   → O(all ISM rows for these servers) network transfer.
  // After: get_all_behavioral_reliability(p_server_names)
  //   → SQL GROUP BY server_name, returns ONE pre-aggregated row per server.
  //   → O(N servers) network transfer. Aggregation done in Postgres.
  const serverNames = servers.map((s: any) => s.name);
  const ismMap = new Map<string, { invoke_count: number; success_count: number }>();
  if (serverNames.length > 0) {
    const { data: ismRows } = await (svc as any)
      .rpc('get_all_behavioral_reliability', { p_server_names: serverNames });
    // Each row is already aggregated — no TS reduction needed.
    for (const row of ismRows ?? []) {
      ismMap.set(row.server_name, {
        invoke_count:  row.invoke_count  ?? 0,
        success_count: row.success_count ?? 0,
      });
    }
  }


  if (error) {
    if (cronRun?.id) {
      await (svc.from('cron_job_runs') as any).update({
        finished_at: new Date().toISOString(), status: 'error', error: error.message,
      }).eq('id', cronRun.id);
    }
    return { error: error.message };
  }

  // Process in batches of 20 to avoid overwhelming Vercel's timeout
  const batch = 20;
  for (let i = 0; i < servers.length; i += batch) {
    const chunk = servers.slice(i, i + batch);

    await Promise.all(chunk.map(async (server: any) => {
      results.checked++;

      if (!isSafeUrl(server.endpoint)) {
        results.errors++;
        return;
      }

      // FAULT-08 fix: Skip authenticated servers — an unauthenticated probe will always
      // get a 401/403, appear 'down', and permanently depress trust_score + search ranking.
      // We cannot accurately measure uptime for api_key/oauth servers without credentials.
      if (server.auth_type === 'api_key' || server.auth_type === 'oauth') {
        return;
      }

      const { up, latencyMs, mcpCompliant } = await probeUptime(server.endpoint);

      // ── EWMA uptime (α=0.01 → ~100 checks = ~25 hours at 15min cadence) ──────
      const prevUptime = Number(server.uptime_pct ?? 100);
      const α = 0.01;
      const newUptime = Math.min(100, Math.max(0,
        prevUptime * (1 - α) + (up ? 100 : 0) * α
      ));

      // ── EWMA latency ──────────────────────────────────────────────────────────
      const prevLatency = server.latency_ms ?? latencyMs;
      const newLatency  = up
        ? Math.round(prevLatency * 0.9 + latencyMs * 0.1)
        : prevLatency;

      // ── Recompute trust score ─────────────────────────────────────────────────
      // Read the scan score from the most recent scan_issues to avoid
      // using hardcoded 100 — use the stored scan_issues penalty instead
      const criticals = (server.scan_issues as any[] ?? []).filter((i: any) => i.severity === 'critical').length;
      const highs     = (server.scan_issues as any[] ?? []).filter((i: any) => i.severity === 'high').length;
      const scanScore = Math.max(0, 100 - criticals * 40 - highs * 20);

      const daysSince = server.last_scanned_at
        ? Math.floor((Date.now() - new Date(server.last_scanned_at).getTime()) / 86_400_000)
        : 0;

      const ismStats = ismMap.get(server.name) ?? { invoke_count: 0, success_count: 0 };

      const newTrust = computeTrustScore({
        verified:          server.verified ? 1 : 0,
        scanScore,
        uptimePct:         newUptime,
        invokeCount:       ismStats.invoke_count,
        successCount:      ismStats.success_count,
        daysSinceChange:   Math.min(daysSince, 90),
        deploymentQuality: up ? 1 : 0,
      });

      // ── Write updates ─────────────────────────────────────────────────────────
      try {
        await svc.from('servers').update({
          uptime_pct:  Math.round(newUptime * 100) / 100,
          trust_score: newTrust,
          ...(up ? { latency_ms: newLatency } : {}),
        }).eq('id', server.id);

        await svc.from('scan_results').insert({
          server_id: server.id,
          scan_type: 'uptime',
          passed:    up,
          score:     up ? 100 : 0,
          issues:    up ? [] : [{ severity: 'high', type: 'endpoint_down', description: `Unreachable — all probe tiers failed (${latencyMs}ms)` }],
          details:   up
            ? `Up — ${latencyMs}ms${mcpCompliant ? ' (MCP compliant)' : ' (HTTP only — not MCP compliant)'}`
            : 'Down — all probe tiers failed',
        });
      } catch (err) {
        log.error('cron:uptime', `DB write failed for server ${server.id}`, err);
      }

      if (up) results.up++; else results.down++;
    }));
  }

  // Record completion in cron_job_runs
  if (cronRun?.id) {
    await (svc.from('cron_job_runs') as any).update({
      finished_at: new Date().toISOString(), status: 'success', result: results,
    }).eq('id', cronRun.id);
  }

  return {
    ...results,
    timestamp: new Date().toISOString(),
    note: 'Trust scores updated from uptime, scan quality, behavioral invoke history (intent_server_mappings), and verification status.',
  };
}
