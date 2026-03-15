import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';

const Schema = z.object({
  email:    z.string().email(),
  password: z.string().min(8),
  username: z.string().min(3).max(32).regex(/^[a-zA-Z0-9_-]+$/),
});

export async function POST(req: NextRequest) {
  try {
    const body = Schema.parse(await req.json());
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
