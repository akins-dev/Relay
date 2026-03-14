import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';

export async function GET() {
  const db = getDb();
  const stats = db.prepare(`
    SELECT COUNT(*) as total_servers,
      SUM(CASE WHEN status='active' THEN 1 ELSE 0 END) as active_servers,
      SUM(CASE WHEN verified=1 THEN 1 ELSE 0 END) as verified_servers,
      SUM(total_calls) as total_calls,
      SUM(calls_today) as calls_today,
      AVG(trust_score) as avg_trust_score
    FROM servers
  `).get() as any;

  const rows = db.prepare("SELECT tags FROM servers WHERE status='active'").all() as any[];
  const tagCount: Record<string, number> = {};
  for (const r of rows) {
    try { for (const t of JSON.parse(r.tags)) tagCount[t] = (tagCount[t] || 0) + 1; } catch {}
  }
  const tags = Object.entries(tagCount).sort((a, b) => b[1] - a[1]).slice(0, 20).map(([tag, count]) => ({ tag, count }));

  return NextResponse.json({ ...stats, tags });
}
