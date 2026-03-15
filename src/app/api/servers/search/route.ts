import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const q     = searchParams.get('q');
  const limit = Math.min(20, parseInt(searchParams.get('limit') || '5'));
  if (!q) return NextResponse.json({ error: 'Query required' }, { status: 400 });

  const supabase = createClient();

  // Use Postgres full-text search via RPC
  const { data, error } = await supabase
    .rpc('search_servers', { query_text: q, result_limit: limit });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Enrich with author profile
  const ids = (data ?? []).map((s: any) => s.id);
  let results = data ?? [];
  if (ids.length > 0) {
    const { data: enriched } = await supabase
      .from('servers')
      .select(`
        id, name, display_name, description, version, tags, tools,
        verified, stars, latency_ms, uptime_pct, trust_score, scan_status,
        profiles!author_id ( username )
      `)
      .in('id', ids)
      .eq('status', 'active');
    if (enriched) results = enriched;
  }

  return NextResponse.json({ query: q, results });
}
