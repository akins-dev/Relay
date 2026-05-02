import { NextRequest, NextResponse } from 'next/server';
import { resolveUser } from '@/lib/auth-server';
import { apiError } from '@/lib/api';

export const dynamic = 'force-dynamic';

type GateState = 'pass' | 'warn' | 'fail';

function gate(params: {
  name: string;
  state: GateState;
  value: string;
  rule: string;
  notes?: string | null;
}) {
  return {
    name: params.name,
    state: params.state,
    value: params.value,
    rule: params.rule,
    notes: params.notes ?? null,
  };
}

export async function GET(req: NextRequest) {
  const ADMIN_UID = process.env.NEXT_PUBLIC_ADMIN_UID ?? '';
  const { user, supabase } = await resolveUser(req);
  if (!user || !ADMIN_UID || user.id !== ADMIN_UID) return apiError('Unauthorized', 401);

  const generatedAt = new Date().toISOString();

  const [{ data: kpis, error: kpisErr }, { data: latestThreat }, { count: uptimeCount }] = await Promise.all([
    supabase.from('platform_kpis').select('*').single(),
    supabase.from('security_threats').select('*').order('day', { ascending: false }).limit(1).maybeSingle(),
    supabase.from('uptime_issues').select('name', { count: 'exact', head: true }),
  ]);

  if (kpisErr || !kpis) {
    return NextResponse.json(
      {
        generated_at: generatedAt,
        release: 'no-go',
        blocking_failures: [gate({
          name: 'admin_data_available',
          state: 'fail',
          value: 'missing',
          rule: 'platform_kpis must be available',
          notes: kpisErr?.message ?? 'platform_kpis row not found',
        })],
        gates: [gate({
          name: 'admin_data_available',
          state: 'fail',
          value: 'missing',
          rule: 'platform_kpis must be available',
          notes: kpisErr?.message ?? 'platform_kpis row not found',
        })],
      },
      { status: 200 }
    );
  }

  const hoursSinceIngest = kpis.last_ingest_at
    ? (Date.now() - new Date(kpis.last_ingest_at).getTime()) / (1000 * 60 * 60)
    : Number.POSITIVE_INFINITY;

  const gates = [
    gate({
      name: 'fresh_ingest',
      state: hoursSinceIngest <= 24 ? 'pass' : hoursSinceIngest <= 72 ? 'warn' : 'fail',
      value: kpis.last_ingest_at ? kpis.last_ingest_at : '—',
      rule: 'last_ingest_at must be <= 72h (warn if >24h)',
      notes: kpis.last_ingest_at ? `~${Math.round(hoursSinceIngest)}h ago` : 'No ingest timestamp recorded',
    }),
    gate({
      name: 'scan_failures_7d',
      state: (kpis.scan_failures ?? 0) <= 50 ? 'pass' : (kpis.scan_failures ?? 0) <= 150 ? 'warn' : 'fail',
      value: String(kpis.scan_failures ?? 0),
      rule: 'scan_failures <= 150 (warn if >50)',
      notes: 'Heuristic — tune thresholds as data stabilizes',
    }),
    gate({
      name: 'dlp_triggers_7d',
      state: (kpis.dlp_triggers_7d ?? 0) <= 100 ? 'pass' : (kpis.dlp_triggers_7d ?? 0) <= 250 ? 'warn' : 'fail',
      value: String(kpis.dlp_triggers_7d ?? 0),
      rule: 'dlp_triggers_7d <= 250 (warn if >100)',
      notes: 'DLP triggers are expected early; watch for sharp spikes',
    }),
    gate({
      name: 'servers_with_cves',
      state: (kpis.servers_with_cves ?? 0) <= 10 ? 'pass' : (kpis.servers_with_cves ?? 0) <= 25 ? 'warn' : 'fail',
      value: String(kpis.servers_with_cves ?? 0),
      rule: 'servers_with_cves <= 25 (warn if >10)',
      notes: 'Counts active servers with known CVEs',
    }),
    gate({
      name: 'weak_stdio_rows',
      state: (kpis.weak_stdio_rows ?? 0) <= 100 ? 'pass' : (kpis.weak_stdio_rows ?? 0) <= 300 ? 'warn' : 'fail',
      value: String(kpis.weak_stdio_rows ?? 0),
      rule: 'weak_stdio_rows <= 300 (warn if >100)',
      notes: 'Stdio rows backed only by README parsing or with no tool metadata',
    }),
    gate({
      name: 'no_tool_metadata_servers',
      state: (kpis.no_tool_metadata_servers ?? 0) <= 25 ? 'pass' : (kpis.no_tool_metadata_servers ?? 0) <= 100 ? 'warn' : 'fail',
      value: String(kpis.no_tool_metadata_servers ?? 0),
      rule: 'no_tool_metadata_servers <= 100 (warn if >25)',
      notes: 'Any growth here means ingest completeness is regressing',
    }),
    gate({
      name: 'uptime_issues',
      state: (uptimeCount ?? 0) === 0 ? 'pass' : (uptimeCount ?? 0) <= 10 ? 'warn' : 'fail',
      value: String(uptimeCount ?? 0),
      rule: 'uptime_issues == 0 (warn if 1–10)',
      notes: 'Includes <95% uptime or >5s latency',
    }),
    gate({
      name: 'errors_last_day',
      state: (latestThreat?.errors ?? 0) <= 25 ? 'pass' : (latestThreat?.errors ?? 0) <= 100 ? 'warn' : 'fail',
      value: latestThreat?.day ? `${latestThreat.day} · ${latestThreat.errors}` : '—',
      rule: 'latest day errors <= 100 (warn if >25)',
      notes: latestThreat?.day ? 'From security_threats (daily rollup)' : 'No security_threats rows yet',
    }),
  ];

  const blockingFailures = gates.filter((g) => g.state === 'fail');
  const release = blockingFailures.length === 0 ? 'go' : 'no-go';

  return NextResponse.json(
    {
      generated_at: generatedAt,
      release,
      blocking_failures: blockingFailures,
      gates,
    },
    { status: 200 }
  );
}
