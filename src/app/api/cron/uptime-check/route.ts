import { safeCompare } from '@/lib/utils';
import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { computeTrustScore } from '@/lib/security';

function isAuthorized(req: NextRequest) {
  return safeCompare(req.headers.get('authorization') ?? '', `Bearer ${process.env.CRON_SECRET ?? ''}`);
}

export async function GET(req: NextRequest) {
  if (!isAuthorized(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const svc = createServiceClient();
  const results = { checked: 0, up: 0, down: 0 };

  const { data: servers } = await svc
    .from('servers')
    .select('id, endpoint, uptime_pct, trust_score, verified, stars, latency_ms, last_scanned_at')
    .eq('status', 'active');

  for (const server of servers ?? []) {
    results.checked++;
    const start = Date.now();
    let isUp = false;

    try {
      const res = await fetch(`${server.endpoint}/health`, {
        method: 'HEAD', signal: AbortSignal.timeout(8_000),
      });
      isUp = res.ok || res.status === 405;
    } catch { isUp = false; }

    const latency    = Date.now() - start;
    const prevUptime = server.uptime_pct ?? 100;
    const newUptime  = isUp
      ? Math.min(100, prevUptime * 0.99 + 100 * 0.01)
      : Math.max(0,   prevUptime * 0.99 + 0   * 0.01);

    const daysSince = server.last_scanned_at
      ? Math.floor((Date.now() - new Date(server.last_scanned_at).getTime()) / 86400000)
      : 0;

    const newTrust = computeTrustScore({
      verified:        server.verified ? 1 : 0,
      scanScore:       100,
      uptimePct:       newUptime,
      stars:           server.stars,
      daysSinceChange: Math.min(daysSince, 90),
    });

    await svc.from('servers').update({
      uptime_pct:  Math.round(newUptime * 100) / 100,
      trust_score: newTrust,
      latency_ms:  isUp ? latency : server.latency_ms,
    }).eq('id', server.id);

    await svc.from('scan_results').insert({
      server_id: server.id,
      scan_type: 'uptime',
      passed:    isUp,
      score:     isUp ? 100 : 0,
      issues:    isUp ? [] as any : [{ severity: 'high', type: 'endpoint_down', description: 'Health check failed' }] as any,
      details:   isUp ? `Up — ${latency}ms` : 'Endpoint unreachable',
    });

    if (isUp) results.up++; else results.down++;
  }

  return NextResponse.json({ ...results, timestamp: new Date().toISOString() });
}
