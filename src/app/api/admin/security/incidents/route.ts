import { NextRequest, NextResponse } from 'next/server';
import { resolveUser } from '@/lib/auth-server';
import { createServiceClient } from '@/lib/supabase/server';

const ADMIN_UID = process.env.NEXT_PUBLIC_ADMIN_UID ?? '';

export async function GET(req: NextRequest) {
  const { user } = await resolveUser(req);
  if (!user || !ADMIN_UID || user.id !== ADMIN_UID) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const url = new URL(req.url);
  const type = url.searchParams.get('type');
  const limit = Math.min(Number(url.searchParams.get('limit') ?? '200'), 200);

  const svc = createServiceClient();
  let q = svc.from('security_incidents').select('*').order('created_at', { ascending: false }).limit(limit);
  if (type) q = (q as any).eq('incident', type);

  const res = await q;
  if (res.error) return NextResponse.json({ error: res.error.message }, { status: 500 });
  return NextResponse.json({ incidents: res.data ?? [] });
}
