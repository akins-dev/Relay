import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { nanoid } from 'nanoid';
import { getDb } from '@/lib/db';
import { hashPassword, signToken } from '@/lib/auth';

const Schema = z.object({
  username: z.string().min(3).max(32).regex(/^[a-zA-Z0-9_-]+$/),
  email: z.string().email(),
  password: z.string().min(8),
});

export async function POST(req: NextRequest) {
  try {
    const body = Schema.parse(await req.json());
    const db = getDb();
    const existing = db.prepare('SELECT id FROM users WHERE email = ? OR username = ?').get(body.email, body.username);
    if (existing) return NextResponse.json({ error: 'Email or username already taken' }, { status: 409 });
    const id = nanoid();
    const passwordHash = await hashPassword(body.password);
    db.prepare('INSERT INTO users (id, username, email, password_hash) VALUES (?, ?, ?, ?)').run(id, body.username, body.email, passwordHash);
    const token = signToken({ userId: id, username: body.username });
    return NextResponse.json({ token, username: body.username });
  } catch (e: any) {
    if (e.errors) return NextResponse.json({ error: e.errors }, { status: 400 });
    return NextResponse.json({ error: 'Registration failed' }, { status: 500 });
  }
}
