import { createServiceClient }        from '@/lib/supabase/server';
import { isSafeUrl }                  from '@/lib/utils';
import { computeTrustScore }          from '@/lib/security';
import { probeUptime }                from '@/lib/mcp-probe';

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
  } catch {}

  const { data: servers, error } = await svc
    .from('servers')
    .select('id, endpoint, uptime_pct, trust_score, verified, stars, latency_ms, scan_issues, last_scanned_at')
    .eq('status', 'active')
    .not('endpoint', 'is', null);

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
  for (let i = 0; i < (servers ?? []).length; i += batch) {
    const chunk = (servers ?? []).slice(i, i + batch);

    await Promise.all(chunk.map(async (server: any) => {
      results.checked++;

      if (!isSafeUrl(server.endpoint)) {
        results.errors++;
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

      const newTrust = computeTrustScore({
        verified:        server.verified ? 1 : 0,
        scanScore,
        uptimePct:       newUptime,
        stars:           server.stars ?? 0,
        daysSinceChange: Math.min(daysSince, 90),
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
      } catch { /* non-fatal */ }

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
    note: 'Trust scores updated automatically from uptime, scan quality, stars, and verification status.',
  };
}
