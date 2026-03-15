import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createHash, randomBytes } from 'crypto';

export async function POST(req: NextRequest) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { name = 'Default Key' } = await req.json().catch(() => ({}));
  const { count } = await supabase.from('api_keys').select('*', { count: 'exact', head: true }).eq('user_id', user.id);
  if ((count ?? 0) >= 10) return NextResponse.json({ error: 'Maximum 10 API keys' }, { status: 429 });

  const rawKey    = `sk_mcp_${randomBytes(24).toString('hex')}`;
  const keyHash   = createHash('sha256').update(rawKey).digest('hex');
  const keyPrefix = rawKey.slice(0, 16);

  const { data, error } = await supabase.from('api_keys')
    .insert({ user_id: user.id, key_hash: keyHash, key_prefix: keyPrefix, name })
    .select('id, key_prefix, name, created_at').single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ...data, key: rawKey });
}

export async function DELETE(req: NextRequest) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const id = new URL(req.url).searchParams.get('id');
  if (!id) return NextResponse.json({ error: 'Key ID required' }, { status: 400 });

  const { error } = await supabase.from('api_keys').delete().eq('id', id).eq('user_id', user.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true });
}
