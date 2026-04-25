import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { rateLimit, getLimitConfig } from '@/lib/ratelimit';

const Schema = z.object({
  email:    z.string().email(),
  password: z.string().min(8),
  username: z.string().min(3).max(32).regex(/^[a-zA-Z0-9_-]+$/),
});

export async function POST(req: NextRequest) {
  // Rate limit: 10 registrations per IP per minute — account creation spam protection
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
  const rlConfig = await getLimitConfig('auth');
  const rl  = await rateLimit(`register:${ip}`, rlConfig);
  if (!rl.allowed) {
    return NextResponse.json(
      { error: 'Too many registration attempts. Please wait a minute.' },
      { status: 429, headers: { 'Retry-After': '60' } }
    );
  }

  try {
    const body     = Schema.parse(await req.json());
    const supabase = createClient();
    const { error } = await supabase.auth.signUp({
      email: body.email, password: body.password,
      options: { data: { username: body.username } },
    });
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
    return NextResponse.json({ message: 'Check your email to confirm your account.' });
  } catch (e: any) {
    if (e.errors) return NextResponse.json({ error: e.errors[0]?.message }, { status: 400 });
    return NextResponse.json({ error: 'Registration failed' }, { status: 500 });
  }
}
