/**
 * GET /api/cron/uptime-check
 *
 * Runs every 15 minutes (Vercel cron).
 * Checks reachability of every active server using a tiered strategy:
 *   1. POST tools/list (JSON-RPC) — authoritative: proves it is a working MCP server
 *   2. GET /health or HEAD / — fallback for servers that don't speak MCP directly
 *
 * Updates:
 *   - uptime_pct  — exponential moving average (α=0.01 per check ≈ 100-check window)
 *   - trust_score — recomputed from scan score + uptime + stars + verified + stability
 *   - latency_ms  — EWMA for response time
 *   - scan_results — one record per check for audit trail
 *
 * Trust score is fully automatic — no manual intervention needed.
 */
import { NextRequest, NextResponse }  from 'next/server';
import { createServiceClient }        from '@/lib/supabase/server';
import { safeCompare, isSafeUrl }     from '@/lib/utils';
import { computeTrustScore }          from '@/lib/security';
import { probeUptime }                from '@/lib/mcp-probe';

function isAuthorized(req: NextRequest) {
  return safeCompare(
    req.headers.get('authorization') ?? '',
    `Bearer ${process.env.CRON_SECRET ?? ''}`
  );
}

// probeServer is replaced by probeUptime from mcp-probe.ts which performs
// the correct MCP initialize handshake before checking server status.

export async function GET(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const svc = createServiceClient();
  const results = { checked: 0, up: 0, down: 0, errors: 0 };

  const { data: servers, error } = await svc
    .from('servers')
    .select('id, endpoint, uptime_pct, trust_score, verified, stars, latency_ms, scan_issues, last_scanned_at')
    .eq('status', 'active')
    .not('endpoint', 'is', null);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // Process in batches of 20 to avoid overwhelming Vercel's timeout
  const batch = 20;
  for (let i = 0; i < (servers ?? []).length; i += batch) {
    const chunk = (servers ?? []).slice(i, i + batch);

    await Promise.all(chunk.map(async server => {
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

  return NextResponse.json({
    ...results,
    timestamp: new Date().toISOString(),
    note: 'Trust scores updated automatically from uptime, scan quality, stars, and verification status.',
  });
}