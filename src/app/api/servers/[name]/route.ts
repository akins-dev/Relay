import { NextRequest, NextResponse } from 'next/server';
import { getDb, formatServer } from '@/lib/db';
import { getAuthFromRequest } from '@/lib/auth';

export async function GET(req: NextRequest, { params }: { params: { name: string } }) {
  const db = getDb();
  const server = db.prepare(`
    SELECT s.*, u.username as author_name, u.github_username as author_github
    FROM servers s LEFT JOIN users u ON s.author_id = u.id
    WHERE s.name = ?
  `).get(params.name) as any;

  if (!server) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const scans = db.prepare('SELECT * FROM scan_results WHERE server_id = ? ORDER BY created_at DESC LIMIT 5').all(server.id) as any[];
  const auth = getAuthFromRequest(req);
  let starred = false;
  if (auth) {
    starred = !!db.prepare('SELECT 1 FROM server_stars WHERE user_id = ? AND server_id = ?').get(auth.userId, server.id);
  }

  return NextResponse.json({
    ...formatServer(server),
    scans: scans.map(s => ({ ...s, issues: JSON.parse(s.issues || '[]') })),
    starred,
  });
}
