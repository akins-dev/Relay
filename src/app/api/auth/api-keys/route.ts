import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { getAuthFromRequest, createApiKey } from '@/lib/auth';

export async function POST(req: NextRequest) {
  const auth = getAuthFromRequest(req);
  if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { name = 'Default Key' } = await req.json().catch(() => ({}));
  const db = getDb();
  const count = (db.prepare('SELECT COUNT(*) as c FROM api_keys WHERE user_id = ?').get(auth.userId) as any).c;
  if (count >= 10) return NextResponse.json({ error: 'Max 10 API keys' }, { status: 429 });
  const { id, rawKey, keyPrefix } = await createApiKey(auth.userId, name);
  return NextResponse.json({ id, key: rawKey, prefix: keyPrefix, name });
}

export async function DELETE(req: NextRequest) {
  const auth = getAuthFromRequest(req);
  if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { searchParams } = new URL(req.url);
  const id = searchParams.get('id');
  if (!id) return NextResponse.json({ error: 'Key ID required' }, { status: 400 });
  getDb().prepare('DELETE FROM api_keys WHERE id = ? AND user_id = ?').run(id, auth.userId);
  return NextResponse.json({ success: true });
}
