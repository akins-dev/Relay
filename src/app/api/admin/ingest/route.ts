import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { apiError, zodError } from '@/lib/api';
import { z } from 'zod';

const AdminIngestSchema = z.object({
  source: z.enum(['all','official','smithery','glama','pulsemcp','github']).default('official'),
});

const ADMIN_UID = process.env.NEXT_PUBLIC_ADMIN_UID ?? '';

export async function POST(req: NextRequest) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user || !ADMIN_UID || user.id !== ADMIN_UID) return apiError('Unauthorized', 401);

  let body: z.infer<typeof AdminIngestSchema>;
  try { body = AdminIngestSchema.parse(await req.json().catch(() => ({}))); }
  catch (e) { return zodError(e); }
  const { source } = body;
  const origin = new URL(req.url).origin;

  const res = await fetch(`${origin}/api/ingest`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${process.env.CRON_SECRET ?? ''}` },
    body:    JSON.stringify({ source }),
  });
  return NextResponse.json(await res.json(), { status: res.status });
}
