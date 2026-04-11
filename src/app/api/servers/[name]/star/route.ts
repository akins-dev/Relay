import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { resolveUser } from '@/lib/auth-server';

export async function POST(
  req: NextRequest,
  { params }: { params: { name: string } }
) {
  const supabase = createClient();
  const { user } = await resolveUser(req);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { data: server } = await supabase
    .from('servers').select('id').eq('name', params.name).single();
  if (!server) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const { data: existing } = await supabase
    .from('server_stars')
    .select('user_id')
    .eq('user_id', user.id).eq('server_id', server.id)
    .maybeSingle();

  if (existing) {
    await supabase.from('server_stars').delete().eq('user_id', user.id).eq('server_id', server.id);
    await supabase.rpc('decrement_stars', { server_id: server.id });
    return NextResponse.json({ starred: false });
  } else {
    await supabase.from('server_stars').insert({ user_id: user.id, server_id: server.id });
    await supabase.rpc('increment_stars', { server_id: server.id });
    return NextResponse.json({ starred: true });
  }
}
