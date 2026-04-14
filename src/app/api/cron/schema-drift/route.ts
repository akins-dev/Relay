import { safeCompare } from '@/lib/utils';
import { NextRequest, NextResponse } from 'next/server';
import { runSchemaDrift } from '@/lib/cron/schema-drift';

export async function GET(req: NextRequest) {
  if (!safeCompare(req.headers.get('authorization') ?? '', `Bearer ${process.env.CRON_SECRET ?? ''}`)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const result = await runSchemaDrift();
  return NextResponse.json(result);
}
