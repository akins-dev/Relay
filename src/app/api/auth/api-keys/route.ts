import { NextRequest, NextResponse } from 'next/server';
import { createClient, createServiceClient } from '@/lib/supabase/server';
import { createHash, randomBytes } from 'crypto';
import { z } from 'zod';
import { zodError } from '@/lib/api';

const CreateKeySchema = z.object({
  name: z.string().min(1).max(64).default('Default Key'),
});

export async function POST(req: NextRequest) {
  const supabase = createClient();
  const authHeader = req.headers.get('Authorization');
  const token = authHeader?.startsWith('Bearer ') ? authHeader.split(' ')[1] : undefined;
  const { data: { user } } = token ? await supabase.auth.getUser(token) : await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  let body: z.infer<typeof CreateKeySchema>;
  try { body = CreateKeySchema.parse(await req.json().catch(() => ({}))); }
  catch (e) { return zodError(e); }
  const { name } = body;
  
  const svc = createServiceClient();
  const { count } = await svc.from('api_keys').select('*', { count: 'exact', head: true }).eq('user_id', user.id);
  if ((count ?? 0) >= 10) return NextResponse.json({ error: 'Maximum 10 API keys' }, { status: 429 });

  const rawKey    = `sk_mcp_${randomBytes(24).toString('hex')}`;
  const keyHash   = createHash('sha256').update(rawKey).digest('hex');
  const keyPrefix = rawKey.slice(0, 16);

  const { data, error } = await svc.from('api_keys')
    .insert({ user_id: user.id, key_hash: keyHash, key_prefix: keyPrefix, name })
    .select('id, key_prefix, name, created_at').single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ...data, key: rawKey });
}

export async function DELETE(req: NextRequest) {
  const supabase = createClient();
  const authHeader = req.headers.get('Authorization');
  const token = authHeader?.startsWith('Bearer ') ? authHeader.split(' ')[1] : undefined;
  const { data: { user } } = token ? await supabase.auth.getUser(token) : await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const id = new URL(req.url).searchParams.get('id');
  if (!id) return NextResponse.json({ error: 'Key ID required' }, { status: 400 });

  const svc = createServiceClient();
  const { error } = await svc.from('api_keys').delete().eq('id', id).eq('user_id', user.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true });
}
