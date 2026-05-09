/**
 * GET /api/cron/uptime-check
 */
import { NextRequest, NextResponse } from 'next/server';
import { runUptimeCheck } from '@/lib/cron/uptime';
import { isCronAuthorized } from '@/lib/cron/cron-auth';

export async function GET(req: NextRequest) {
  if (!isCronAuthorized(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const result = await runUptimeCheck();
  if ((result as any).error) {
    return NextResponse.json(result, { status: 500 });
  }
  return NextResponse.json(result);
}
