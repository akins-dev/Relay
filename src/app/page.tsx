import { createClient } from '@/lib/supabase/server';
import { HomeClient } from './HomeClient';
import type { GlobalStats } from '@/types';

async function getHomeData() {
  const supabase = createClient();
  const [statsRes, featuredRes] = await Promise.all([
    supabase.rpc('global_stats'),
    supabase
      .from('servers')
      .select('id, name, display_name, description, version, tags, tools, verified, stars, total_calls, calls_today, latency_ms, uptime_pct, trust_score, scan_status, scan_issues, created_at, profiles!author_id ( username, avatar_url )')
      .eq('status', 'active').eq('verified', true)
      .order('trust_score', { ascending: false }).limit(4),
  ]);

  const raw   = (statsRes.data as any) ?? {};
  const stats: GlobalStats = {
    total_servers:     raw.total_servers     ?? 0,
    active_servers:    raw.active_servers    ?? 0,
    invokable_servers: raw.invokable_servers ?? 0,
    local_servers:     raw.local_servers     ?? 0,
    verified_servers:  raw.verified_servers  ?? 0,
    total_calls:       raw.total_calls       ?? 0,
    calls_today:       raw.calls_today       ?? 0,
    avg_trust_score:   raw.avg_trust_score   ?? 0,
  };
  return { stats, featured: featuredRes.data ?? [] };
}

export default async function HomePage() {
  const { stats, featured } = await getHomeData();
  return <HomeClient stats={stats} featured={featured as any} />;
}
