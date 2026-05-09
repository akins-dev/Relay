import { NextRequest, NextResponse } from 'next/server';
import { isCronAuthorized } from '@/lib/cron/cron-auth';
import { runIngest } from '@/lib/cron/ingest';

export async function GET(req: NextRequest) {
  if (!isCronAuthorized(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const result = await runIngest('smithery', { mode: 'catalog' });
  return NextResponse.json(result, { status: (result as any).error ? 500 : 200 });
}
