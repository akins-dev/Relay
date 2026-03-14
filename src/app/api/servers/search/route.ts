import { NextRequest, NextResponse } from 'next/server';
import { getDb, formatServer } from '@/lib/db';

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const q = searchParams.get('q');
  const limit = Math.min(20, parseInt(searchParams.get('limit') || '5'));
  if (!q) return NextResponse.json({ error: 'Query required' }, { status: 400 });

  const db = getDb();
  const servers = db.prepare(`
    SELECT s.*, u.username as author_name FROM servers s
    LEFT JOIN users u ON s.author_id = u.id
    WHERE s.status = 'active' ORDER BY s.trust_score DESC, s.stars DESC LIMIT 100
  `).all() as any[];

  const terms = q.toLowerCase().split(/\s+/).filter(Boolean);
  const scored = servers.map(s => {
    let score = 0;
    for (const term of terms) {
      if (s.name?.toLowerCase().includes(term)) score += 10;
      if (s.display_name?.toLowerCase().includes(term)) score += 8;
      if (s.tags?.toLowerCase().includes(term)) score += 6;
      if (s.tools?.toLowerCase().includes(term)) score += 5;
      if (s.description?.toLowerCase().includes(term)) score += 3;
    }
    score += (s.trust_score || 0) / 20;
    return { ...s, _relevance: score };
  })
    .filter(s => s._relevance > 0)
    .sort((a, b) => b._relevance - a._relevance)
    .slice(0, limit);

  return NextResponse.json({ query: q, results: scored.map(s => ({ ...formatServer(s), relevance: s._relevance })) });
}
