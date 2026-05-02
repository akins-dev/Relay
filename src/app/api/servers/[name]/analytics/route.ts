import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ name: string }> }
) {
  const { name } = await params;
  const supabase = createClient();

  // Server must exist and be active or owned by caller
  const { data: server } = await supabase
    .from('servers')
    .select('id, author_id, status, trust_score, total_calls, calls_today, latency_ms, uptime_pct')
    .eq('name', name)
    .single();

  if (!server) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const { data: auditSummaryRows } = await (supabase as any)
    .from('audit_summary')
    .select('day, total_calls, successful_calls, blocked_calls, error_calls, dlp_events, avg_latency_ms')
    .eq('server_name', name)
    .order('day', { ascending: true });

  const rows = auditSummaryRows ?? [];

  // Aggregate by day
  const byDay: Record<string, { calls: number; errors: number; dlp: number; latency: number | null }> = {};
  let totalErrors = 0;
  let totalDlp    = 0;
  let totalCalls = 0;

  for (const row of rows) {
    const day = row.day;
    const calls = row.total_calls ?? 0;
    const errors = (row.blocked_calls ?? 0) + (row.error_calls ?? 0);
    const dlp = row.dlp_events ?? 0;

    byDay[day] = {
      calls,
      errors,
      dlp,
      latency: row.avg_latency_ms ?? null,
    };
    totalCalls += calls;
    totalErrors += errors;
    totalDlp += dlp;
  }

  // Build time series (fill gaps)
  const callsTimeSeries = [];
  for (let i = 29; i >= 0; i--) {
    const d = new Date(Date.now() - i * 24 * 60 * 60 * 1000);
    const day = d.toISOString().slice(0, 10);
    const entry = byDay[day] || { calls: 0, errors: 0, dlp: 0, latency: null };
    callsTimeSeries.push({
      date:    day,
      calls:   entry.calls,
      errors:  entry.errors,
      dlp:     entry.dlp,
      latency: entry.latency,
    });
  }

  const { data: toolRows } = await (supabase as any)
    .from('server_tool_usage_30d')
    .select('tool_name, total_calls, successful_calls, error_calls, dlp_events, avg_latency_ms')
    .eq('server_name', name)
    .order('total_calls', { ascending: false })
    .limit(10);

  const topTools = (toolRows ?? []).map((row: any) => ({
    tool: row.tool_name,
    calls: row.total_calls ?? 0,
    successful_calls: row.successful_calls ?? 0,
    error_calls: row.error_calls ?? 0,
    dlp_events: row.dlp_events ?? 0,
    avg_latency_ms: row.avg_latency_ms ?? null,
  }));

  // Last 5 scans
  const { data: scans } = await supabase
    .from('scan_results')
    .select('scan_type, passed, score, created_at')
    .eq('server_id', server.id)
    .order('created_at', { ascending: false })
    .limit(5);

  return NextResponse.json({
    server: {
      trust_score:  server.trust_score,
      total_calls:  server.total_calls,
      calls_today:  server.calls_today,
      latency_ms:   server.latency_ms,
      uptime_pct:   server.uptime_pct,
    },
    period: '30d',
    summary: {
      total_calls:    totalCalls,
      total_errors:   totalErrors,
      total_dlp:      totalDlp,
      error_rate:     totalCalls > 0 ? ((totalErrors / totalCalls) * 100).toFixed(1) : '0',
    },
    calls_time_series: callsTimeSeries,
    top_tools: topTools,
    recent_scans: scans ?? [],
  });
}
