import { NextRequest, NextResponse } from 'next/server';
import { runResetDailyCalls } from '@/lib/cron/reset-calls';
import { isCronAuthorized } from '@/lib/cron/cron-auth';

export async function GET(req: NextRequest) {
  if (!isCronAuthorized(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const result = await runResetDailyCalls();
  if (result.error) {
    return NextResponse.json(result, { status: 500 });
  }
  return NextResponse.json(result);
}
