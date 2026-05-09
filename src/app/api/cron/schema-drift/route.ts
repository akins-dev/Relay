import { NextRequest, NextResponse } from 'next/server';
import { runSchemaDrift } from '@/lib/cron/schema-drift';
import { isCronAuthorized } from '@/lib/cron/cron-auth';

export async function GET(req: NextRequest) {
  if (!isCronAuthorized(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  try {
    const result = await runSchemaDrift();
    return NextResponse.json(result);
  } catch (err: any) {
    console.error('[schema-drift] Error:', err);
    return NextResponse.json({ error: err?.message ?? 'Schema drift check failed' }, { status: 500 });
  }
}
