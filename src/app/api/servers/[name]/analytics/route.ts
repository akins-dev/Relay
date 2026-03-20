import { NextRequest, NextResponse } from 'next/server';
import { createClient, createServiceClient } from '@/lib/supabase/server';

export async function GET(
  req: NextRequest,
  { params }: { params: { name: string } }
) {
  const supabase = createClient();

  // Server must exist and be active or owned by caller
  const { data: server } = await supabase
    .from('servers')
    .select('id, author_id, status, trust_score, total_calls, calls_today, latency_ms, uptime_pct')
    .eq('name', params.name)
    .single();

  if (!server) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const svc = createServiceClient();

  // Last 30 days of audit log entries for this server
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();

  const { data: auditRows } = await svc
    .from('audit_log')
    .select('action, tool_name, latency_ms, status_code, dlp_triggered, created_at')
    .eq('server_id', server.id)
    .gte('created_at', thirtyDaysAgo)
    .order('created_at', { ascending: true });

  const rows = auditRows ?? [];

  // Aggregate by day
  const byDay: Record<string, { calls: number; errors: number; dlp: number; totalLatency: number; count: number }> = {};
  const byTool: Record<string, number> = {};
  let totalErrors = 0;
  let totalDlp    = 0;

  for (const row of rows) {
    const day = row.created_at.slice(0, 10); // YYYY-MM-DD
    if (!byDay[day]) byDay[day] = { calls: 0, errors: 0, dlp: 0, totalLatency: 0, count: 0 };

    if (row.action.includes('proxy_call') || row.action.includes('proxy_error') || row.action.includes('blocked')) {
      byDay[day].calls++;
      if (row.action.includes('error') || (row.status_code ?? 0) >= 400) {
        byDay[day].errors++;
        totalErrors++;
      }
      if (row.dlp_triggered) { byDay[day].dlp++; totalDlp++; }
      if (row.latency_ms) { byDay[day].totalLatency += row.latency_ms; byDay[day].count++; }
    }

    if (row.tool_name) byTool[row.tool_name] = (byTool[row.tool_name] || 0) + 1;
  }

  // Build time series (fill gaps)
  const callsTimeSeries = [];
  for (let i = 29; i >= 0; i--) {
    const d = new Date(Date.now() - i * 24 * 60 * 60 * 1000);
    const day = d.toISOString().slice(0, 10);
    const entry = byDay[day] || { calls: 0, errors: 0, dlp: 0, totalLatency: 0, count: 0 };
    callsTimeSeries.push({
      date:    day,
      calls:   entry.calls,
      errors:  entry.errors,
      dlp:     entry.dlp,
      latency: entry.count > 0 ? Math.round(entry.totalLatency / entry.count) : null,
    });
  }

  // Top tools
  const topTools = Object.entries(byTool)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([tool, calls]) => ({ tool, calls }));

  // Last 5 scans
  const { data: scans } = await svc
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
      total_calls:    rows.filter(r => r.action.includes('proxy')).length,
      total_errors:   totalErrors,
      total_dlp:      totalDlp,
      error_rate:     rows.length > 0 ? ((totalErrors / rows.length) * 100).toFixed(1) : '0',
    },
    calls_time_series: callsTimeSeries,
    top_tools: topTools,
    recent_scans: scans ?? [],
  });
}
