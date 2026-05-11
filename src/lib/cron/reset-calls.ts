import { createServiceClient } from '@/lib/supabase/server';
import { log } from '@/lib/logger';

export async function runResetDailyCalls() {
  const svc = createServiceClient();
  let cronRun: { id: string } | null = null;
  try {
    const { data } = await svc.from('cron_job_runs').insert({
      job_name: 'reset_daily_calls', status: 'running',
    }).select('id').single();
    cronRun = (data as any) ?? null;
  } catch (err) {
    log.warn('cron:reset-calls', 'Could not create cron_job_runs entry', err);
  }

  const { error } = await svc.from('servers').update({ calls_today: 0 }).not('id', 'is', null);
  if (error) {
    if (cronRun?.id) {
      await (svc.from('cron_job_runs') as any).update({
        finished_at: new Date().toISOString(), status: 'error', error: error.message,
      }).eq('id', cronRun.id);
    }
    return { error: error.message };
  }

  if (cronRun?.id) {
    await (svc.from('cron_job_runs') as any).update({
      finished_at: new Date().toISOString(), status: 'success', result: { reset: true },
    }).eq('id', cronRun.id);
  }

  return { reset: true, timestamp: new Date().toISOString() };
}
