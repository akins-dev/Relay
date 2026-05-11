import { NextRequest, NextResponse } from 'next/server';
import { resolveUser } from '@/lib/auth-server';
import { apiError, zodError } from '@/lib/api';
import { runUptimeCheck } from '@/lib/cron/uptime';
import { runSchemaDrift } from '@/lib/cron/schema-drift';
import { runResetDailyCalls } from '@/lib/cron/reset-calls';
import { z } from 'zod';

const ADMIN_UID = process.env.NEXT_PUBLIC_ADMIN_UID ?? '';

const AdminCronRunSchema = z.object({
  job: z.enum(['uptime_check', 'schema_drift', 'reset_daily_calls']),
});

export async function POST(req: NextRequest) {
  const { user } = await resolveUser(req);
  if (!user || !ADMIN_UID || user.id !== ADMIN_UID) return apiError('Unauthorized', 401);

  let body: z.infer<typeof AdminCronRunSchema>;
  try {
    body = AdminCronRunSchema.parse(await req.json().catch(() => ({})));
  } catch (e) {
    return zodError(e);
  }

  try {
    const result = body.job === 'uptime_check'
      ? await runUptimeCheck()
      : body.job === 'schema_drift'
        ? await runSchemaDrift()
        : await runResetDailyCalls();

    if ((result as any)?.error) {
      return NextResponse.json(result, { status: 500 });
    }

    return NextResponse.json({
      success: true,
      job: body.job,
      result,
      timestamp: new Date().toISOString(),
    });
  } catch (err: any) {
    return NextResponse.json({
      error: err?.message ?? `Failed to run ${body.job}`,
      job: body.job,
    }, { status: 500 });
  }
}
