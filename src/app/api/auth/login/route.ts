import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { rateLimit, getLimitConfig } from '@/lib/ratelimit';

const Schema = z.object({ email: z.string().email(), password: z.string() });

export async function POST(req: NextRequest) {
  // Rate limit: 10 attempts per IP per minute — brute force protection
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
  const rlConfig = await getLimitConfig('auth');
  const rl  = await rateLimit(`auth:${ip}`, rlConfig);
  if (!rl.allowed) {
    return NextResponse.json(
      { error: 'Too many login attempts. Please wait a minute before trying again.' },
      { status: 429, headers: { 'Retry-After': '60' } }
    );
  }

  try {
    const body     = Schema.parse(await req.json());
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
