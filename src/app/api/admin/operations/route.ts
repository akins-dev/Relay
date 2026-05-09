import { NextRequest, NextResponse } from 'next/server';
import { apiError } from '@/lib/api';
import { resolveUser } from '@/lib/auth-server';
import { createServiceClient } from '@/lib/supabase/server';

const ADMIN_UID = process.env.NEXT_PUBLIC_ADMIN_UID ?? '';

export async function GET(req: NextRequest) {
  const { user } = await resolveUser(req);
  if (!user || !ADMIN_UID || user.id !== ADMIN_UID) return apiError('Unauthorized', 401);

  const svc = createServiceClient();
  const [historyRes, driftRes, uptimeRes, suspendedRes, jobHealthRes] = await Promise.all([
    (svc.from('cron_job_runs') as any)
      .select('*')
      .order('started_at', { ascending: false })
      .limit(100),
    svc.from('drift_events').select('*').limit(50),
    svc.from('uptime_issues').select('*').limit(50),
    (svc.from('servers') as any)
      .select('id, name, display_name, source, status, trust_score, scan_issues, last_scanned_at, updated_at, tool_extraction_source, transport')
      .eq('status', 'suspended')
      .order('updated_at', { ascending: false })
      .limit(50),
    svc.from('processing_job_health').select('*'),
  ]);

  const firstError = historyRes.error ?? driftRes.error ?? uptimeRes.error ?? suspendedRes.error;
  if (firstError) return apiError(firstError.message, 500);

  return NextResponse.json({
    cron_history: historyRes.data ?? [],
    drift_events: driftRes.data ?? [],
    uptime_issues: uptimeRes.data ?? [],
    suspended_servers: suspendedRes.data ?? [],
    processing_job_health: jobHealthRes.error ? [] : (jobHealthRes.data ?? []),
  });
}
