import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getDb } from '@/lib/db';
import { verifyPassword, signToken } from '@/lib/auth';

const Schema = z.object({ email: z.string().email(), password: z.string() });

export async function POST(req: NextRequest) {
  try {
    const body = Schema.parse(await req.json());
    const db = getDb();
    const user = db.prepare('SELECT * FROM users WHERE email = ?').get(body.email) as any;
    if (!user) return NextResponse.json({ error: 'Invalid credentials' }, { status: 401 });
    const valid = await verifyPassword(body.password, user.password_hash);
    if (!valid) return NextResponse.json({ error: 'Invalid credentials' }, { status: 401 });
    const token = signToken({ userId: user.id, username: user.username });
    return NextResponse.json({ token, user: { id: user.id, username: user.username, email: user.email } });
  } catch (e: any) {
    if (e.errors) return NextResponse.json({ error: e.errors }, { status: 400 });
    return NextResponse.json({ error: 'Login failed' }, { status: 500 });
  }
}
