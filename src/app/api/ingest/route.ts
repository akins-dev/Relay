import { isCronAuthorized }        from '@/lib/cron/cron-auth';
import { z }                       from 'zod';
import { zodError }                from '@/lib/api';
import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient }     from '@/lib/supabase/server';
import { runIngest }               from '@/lib/cron/ingest';

const IngestSchema = z.object({
  source: z.enum(['all','official','smithery','glama','pulsemcp','github','partner','claudemcp','mcpso','mcp_run','composio']).default('all'),
});

function jsonResponse(payload: unknown, status = 200) {
  return new NextResponse(JSON.stringify(payload, null, 2), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}

export async function POST(req: NextRequest) {
  if (!isCronAuthorized(req)) return jsonResponse({ error: 'Unauthorized' }, 401);

  let body: z.infer<typeof IngestSchema>;
  try { body = IngestSchema.parse(await req.json().catch(() => ({}))); }
  catch (e) { return zodError(e); }

  const result = await runIngest(body.source as any);
  return jsonResponse(result, result.error ? 500 : 200);
}

export async function GET(req: NextRequest) {
  if (!isCronAuthorized(req)) return jsonResponse({ error: 'Unauthorized' }, 401);

  const svc = createServiceClient();
  const { data: runs } = await (svc.from('ingest_runs') as any)
    .select('*')
    .order('started_at', { ascending: false })
    .limit(10);

  return jsonResponse({ runs: runs ?? [] });
}
