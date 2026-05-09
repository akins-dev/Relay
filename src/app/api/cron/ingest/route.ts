import { NextRequest, NextResponse } from 'next/server';
import { isCronAuthorized } from '@/lib/cron/cron-auth';
import { runIngest } from '@/lib/cron/ingest';

const SOURCES = ['official', 'smithery', 'glama', 'mcp_directory'] as const;
type CronIngestSource = typeof SOURCES[number];

function parseSource(req: NextRequest): CronIngestSource {
  const source = new URL(req.url).searchParams.get('source');
  return SOURCES.includes(source as CronIngestSource)
    ? source as CronIngestSource
    : 'official';
}

export async function GET(req: NextRequest) {
  if (!isCronAuthorized(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const source = parseSource(req);
  const result = await runIngest(source, { mode: 'catalog' });
  return NextResponse.json(result, { status: (result as any).error ? 500 : 200 });
}
