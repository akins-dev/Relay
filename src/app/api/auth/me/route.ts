import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { getAuthFromRequest } from '@/lib/auth';

export async function GET(req: NextRequest) {
  const auth = getAuthFromRequest(req);
  if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const db = getDb();
  const user = db.prepare('SELECT id, username, email, avatar_url, bio, github_username, created_at FROM users WHERE id = ?').get(auth.userId) as any;
  if (!user) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  const servers = db.prepare('SELECT id, name, display_name, stars, total_calls, status FROM servers WHERE author_id = ?').all(auth.userId);
  const apiKeys = db.prepare('SELECT id, key_prefix, name, last_used_at, created_at FROM api_keys WHERE user_id = ?').all(auth.userId);
  return NextResponse.json({ user, servers, apiKeys });
}
