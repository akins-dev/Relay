/**
 * GET /api/cron/uptime-check
 */
import { safeCompare } from '@/lib/utils';
import { NextRequest, NextResponse } from 'next/server';
import { runUptimeCheck } from '@/lib/cron/uptime';

export async function GET(req: NextRequest) {
  if (!safeCompare(req.headers.get('authorization') ?? '', `Bearer ${process.env.CRON_SECRET ?? ''}`)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const result = await runUptimeCheck();
  if ((result as any).error) {
    return NextResponse.json(result, { status: 500 });
  }
  return NextResponse.json(result);
}