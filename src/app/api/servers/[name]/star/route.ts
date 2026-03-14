import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { getAuthFromRequest } from '@/lib/auth';

export async function POST(req: NextRequest, { params }: { params: { name: string } }) {
  const auth = getAuthFromRequest(req);
  if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const db = getDb();
  const server = db.prepare('SELECT id FROM servers WHERE name = ?').get(params.name) as any;
  if (!server) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const existing = db.prepare('SELECT 1 FROM server_stars WHERE user_id = ? AND server_id = ?').get(auth.userId, server.id);
  if (existing) {
    db.prepare('DELETE FROM server_stars WHERE user_id = ? AND server_id = ?').run(auth.userId, server.id);
    db.prepare('UPDATE servers SET stars = MAX(0, stars - 1) WHERE id = ?').run(server.id);
    return NextResponse.json({ starred: false });
  } else {
    db.prepare('INSERT OR IGNORE INTO server_stars (user_id, server_id) VALUES (?, ?)').run(auth.userId, server.id);
    db.prepare('UPDATE servers SET stars = stars + 1 WHERE id = ?').run(server.id);
    return NextResponse.json({ starred: true });
  }
}
