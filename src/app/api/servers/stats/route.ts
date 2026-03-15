import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

export async function GET() {
  const supabase = createClient();
  const { data, error } = await supabase.rpc('global_stats');
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const { data: servers } = await supabase.from('servers').select('tags').eq('status', 'active');
  const tagCount: Record<string, number> = {};
  for (const s of servers ?? []) {
    for (const tag of (s.tags ?? [])) tagCount[tag] = (tagCount[tag] || 0) + 1;
  }
  const tags = Object.entries(tagCount)
    .sort((a, b) => b[1] - a[1]).slice(0, 20)
    .map(([tag, count]) => ({ tag, count }));

  return NextResponse.json({ ...(data as object), tags });
}
