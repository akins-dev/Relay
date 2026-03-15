import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';

const Schema = z.object({ email: z.string().email(), password: z.string() });

export async function POST(req: NextRequest) {
  try {
    const body = Schema.parse(await req.json());
    const supabase = createClient();
    const { data, error } = await supabase.auth.signInWithPassword({
      email: body.email, password: body.password,
    });
    if (error) return NextResponse.json({ error: error.message }, { status: 401 });
    const { data: profile } = await supabase
      .from('profiles').select('id, username, avatar_url').eq('id', data.user.id).single();
    return NextResponse.json({ user: { ...profile, email: data.user.email } });
  } catch (e: any) {
    if (e.errors) return NextResponse.json({ error: e.errors[0]?.message }, { status: 400 });
    return NextResponse.json({ error: 'Login failed' }, { status: 500 });
  }
}
