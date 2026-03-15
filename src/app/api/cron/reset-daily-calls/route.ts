import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';

export async function GET(req: NextRequest) {
  if (req.headers.get('authorization') !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const svc = createServiceClient();
  const { error } = await svc.from('servers').update({ calls_today: 0 }).neq('id', '');
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ reset: true, timestamp: new Date().toISOString() });
}
