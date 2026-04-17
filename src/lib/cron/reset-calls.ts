import { createServiceClient } from '@/lib/supabase/server';

export async function runResetDailyCalls() {
  const svc = createServiceClient();
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
    return { error: error.message };
  }

  if (cronRun?.id) {
    await svc.from('cron_job_runs').update({
      finished_at: new Date().toISOString(), status: 'success', result: { reset: true },
    }).eq('id', cronRun.id).catch(() => {});
  }

  return { reset: true, timestamp: new Date().toISOString() };
}
