import { safeCompare } from '@/lib/utils';
import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';

export async function GET(req: NextRequest) {
  if (!safeCompare(req.headers.get('authorization') ?? '', `Bearer ${process.env.CRON_SECRET ?? ''}`)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const svc = createServiceClient();

  // Track cron job run for admin dashboard
  const { data: cronRun } = await svc.from('cron_job_runs').insert({
    job_name: 'reset_daily_calls', status: 'running',
  }).select('id').single().catch(() => ({ data: null }));

  const { error } = await svc.from('servers').update({ calls_today: 0 }).neq('id', '');

  if (error) {
    if (cronRun?.id) {
      await svc.from('cron_job_runs').update({
        finished_at: new Date().toISOString(), status: 'error', error: error.message,
      }).eq('id', cronRun.id).catch(() => {});
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // Record completion
  if (cronRun?.id) {
    await svc.from('cron_job_runs').update({
      finished_at: new Date().toISOString(), status: 'success', result: { reset: true },
    }).eq('id', cronRun.id).catch(() => {});
  }

  return NextResponse.json({ reset: true, timestamp: new Date().toISOString() });
}
