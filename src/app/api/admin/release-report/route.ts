import { NextRequest, NextResponse } from 'next/server';
import { resolveUser } from '@/lib/auth-server';
import { createServiceClient } from '@/lib/supabase/server';
import { apiError } from '@/lib/api';

const ADMIN_UID = process.env.NEXT_PUBLIC_ADMIN_UID ?? '';

type GateState = 'pass' | 'fail' | 'warn';

function gate(name: string, state: GateState, value: string, rule: string, notes?: string) {
  return { name, state, value, rule, notes: notes ?? null };
}

export async function GET(_req: NextRequest) {
  const { user } = await resolveUser(_req);
  if (!user || !ADMIN_UID || user.id !== ADMIN_UID) return apiError('Unauthorized', 401);

  const svc = createServiceClient();

  const [kpisRes, searchQualityRes, ingestRes, reliabilityRes] = await Promise.all([
    svc.from('platform_kpis').select('*').single(),
    svc.from('search_quality_daily').select('*').order('day', { ascending: false }).limit(1),
    svc.from('ingest_quality').select('*'),
    svc.from('server_reliability').select('*').limit(200),
  ]);

  const kpis = kpisRes.data ?? {};
  const sq = searchQualityRes.data?.[0] ?? null;
  const ingestRows = ingestRes.data ?? [];
  const reliabilityRows = reliabilityRes.data ?? [];

  const avgRejectionPct = ingestRows.length > 0
    ? ingestRows.reduce((sum: number, row: any) => sum + Number(row.rejection_rate_pct ?? 0), 0) / ingestRows.length
    : null;
  const avgSuccessPct = reliabilityRows.length > 0
    ? reliabilityRows.reduce((sum: number, row: any) => sum + Number(row.success_rate_pct ?? 0), 0) / reliabilityRows.length
    : null;

  const gates = [
    gate(
      'Invoke Success Rate',
      avgSuccessPct == null ? 'warn' : avgSuccessPct >= 97 ? 'pass' : 'fail',
      avgSuccessPct == null ? 'N/A' : `${avgSuccessPct.toFixed(1)}%`,
      '>= 97%'
    ),
    gate(
      'Search Cache Hit Rate',
      sq == null ? 'warn' : Number(sq.cache_hit_pct ?? 0) >= 30 ? 'pass' : 'warn',
      sq == null ? 'N/A' : `${Number(sq.cache_hit_pct ?? 0).toFixed(1)}%`,
      '>= 30% (target)',
      'Lower values are acceptable early, but should trend up.'
    ),
    gate(
      'DLP Trigger Pressure (7d)',
      Number(kpis.dlp_triggers_7d ?? 0) <= 100 ? 'pass' : 'warn',
      `${Number(kpis.dlp_triggers_7d ?? 0)}`,
      '<= 100 (warn threshold)'
    ),
    gate(
      'Ingest Rejection Rate',
      avgRejectionPct == null ? 'warn' : avgRejectionPct <= 2 ? 'pass' : 'fail',
      avgRejectionPct == null ? 'N/A' : `${avgRejectionPct.toFixed(2)}%`,
      '<= 2%'
    ),
    gate(
      'Scan Failure Count',
      Number(kpis.scan_failures ?? 0) <= 50 ? 'pass' : 'warn',
      `${Number(kpis.scan_failures ?? 0)}`,
      '<= 50 (warn threshold)'
    ),
  ];

  const blockingFailures = gates.filter((g) => g.state === 'fail');
  const release = blockingFailures.length === 0 ? 'go' : 'no-go';

  return NextResponse.json({
    generated_at: new Date().toISOString(),
    release,
    blocking_failures: blockingFailures,
    gates,
    data_sources: ['platform_kpis', 'search_quality_daily', 'ingest_quality', 'server_reliability'],
  });
}
