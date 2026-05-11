import { safeCompare } from '@/lib/utils';
import { NextRequest, NextResponse } from 'next/server';
import { runResetDailyCalls } from '@/lib/cron/reset-calls';

export async function GET(req: NextRequest) {
  if (!safeCompare(req.headers.get('authorization') ?? '', `Bearer ${process.env.CRON_SECRET ?? ''}`)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const result = await runResetDailyCalls();
  if (result.error) {
    return NextResponse.json(result, { status: 500 });
  }
  return NextResponse.json(result);
}
