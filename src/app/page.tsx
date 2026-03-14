import { Suspense } from 'react';
import { getDb, formatServer } from '@/lib/db';
import { ServerCard } from '@/components/registry/ServerCard';
import { HomeClient } from './HomeClient';
import type { Server, GlobalStats } from '@/types';

function getHomeData(): { stats: GlobalStats; featured: Server[] } {
  const db = getDb();

  const stats = db.prepare(`
    SELECT COUNT(*) as total_servers,
      SUM(CASE WHEN status='active' THEN 1 ELSE 0 END) as active_servers,
      SUM(CASE WHEN verified=1 THEN 1 ELSE 0 END) as verified_servers,
      SUM(total_calls) as total_calls,
      SUM(calls_today) as calls_today,
      ROUND(AVG(trust_score),1) as avg_trust_score
    FROM servers
  `).get() as any;

  const rows = db.prepare("SELECT tags FROM servers WHERE status='active'").all() as any[];
  const tagCount: Record<string, number> = {};
  for (const r of rows) {
    try { for (const t of JSON.parse(r.tags)) tagCount[t] = (tagCount[t] || 0) + 1; } catch {}
  }
  const tags = Object.entries(tagCount).sort((a, b) => b[1] - a[1]).slice(0, 20).map(([tag, count]) => ({ tag, count }));

  const featured = db.prepare(`
    SELECT s.*, u.username as author_name FROM servers s
    LEFT JOIN users u ON s.author_id = u.id
    WHERE s.status='active' AND s.verified=1
    ORDER BY s.trust_score DESC LIMIT 4
  `).all() as any[];

  return { stats: { ...stats, tags }, featured: featured.map(formatServer) };
}

export default function HomePage() {
  const { stats, featured } = getHomeData();
  return <HomeClient stats={stats} featured={featured} />;
}
