import { NextRequest, NextResponse } from 'next/server';
import { isCronAuthorized } from '@/lib/cron/cron-auth';
import { createServiceClient } from '@/lib/supabase/server';
import { processServerJobs } from '@/lib/processing-jobs';

export async function GET(req: NextRequest) {
  if (!isCronAuthorized(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const limitParam = Number(new URL(req.url).searchParams.get('limit') ?? 10);
  const limit = Number.isFinite(limitParam) ? Math.min(25, Math.max(1, limitParam)) : 10;
  const result = await processServerJobs(createServiceClient(), limit);
  return NextResponse.json(result, { status: (result as any).error ? 500 : 200 });
}
