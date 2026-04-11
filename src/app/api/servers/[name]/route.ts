import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { resolveUser } from '@/lib/auth-server';

export async function GET(
  req: NextRequest,
  { params }: { params: { name: string } }
) {
  const supabase = createClient();

  const { data: server, error } = await supabase
    .from('servers')
    .select('*, profiles!author_id ( username, github_username, avatar_url )')
    .eq('name', params.name)
    .single();

  if (error || !server) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const { data: scans } = await supabase
    .from('scan_results')
    .select('*')
    .eq('server_id', server.id)
    .order('created_at', { ascending: false })
    .limit(5);

  const { user, supabase } = await resolveUser(req);
  let starred = false;
  if (user) {
    const { data: star } = await supabase
      .from('server_stars')
      .select('user_id')
      .eq('user_id', user.id)
      .eq('server_id', server.id)
      .maybeSingle();
    starred = !!star;
  }

  return NextResponse.json({ ...server, scans: scans ?? [], starred });
}
