import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

export async function GET() {
  const supabase = createClient();
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const [profileRes, serversRes, keysRes] = await Promise.all([
    supabase.from('profiles').select('*').eq('id', user.id).single(),
    supabase.from('servers')
      .select('id, name, display_name, stars, total_calls, status, trust_score')
      .eq('author_id', user.id).order('created_at', { ascending: false }),
    supabase.from('api_keys')
      .select('id, key_prefix, name, last_used_at, created_at')
      .eq('user_id', user.id).order('created_at', { ascending: false }),
  ]);

  return NextResponse.json({
    user:    { ...profileRes.data, email: user.email },
    servers: serversRes.data ?? [],
    apiKeys: keysRes.data ?? [],
  });
}
