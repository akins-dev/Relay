import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { resolveUser } from '@/lib/auth-server';

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ name: string }> }
) {
  const { name } = await params;
  const supabase = createClient();
  const serversTable = supabase.from('servers') as any;
  const scanResultsTable = supabase.from('scan_results') as any;
  const relatedSelect = `
    id, name, display_name, description, trust_score, verified, stars,
    calls_today, latency_ms, uptime_pct, scan_status, tags, source,
    profiles!author_id ( username, avatar_url )
  `;

  const { data: serverRow, error } = await serversTable
    .select('*, profiles!author_id ( username, github_username, avatar_url )')
    .eq('name', name)
    .single();

  const server = serverRow as any;
  if (error || !server) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const { data: scans } = await scanResultsTable
    .select('*')
    .eq('server_id', server.id)
    .order('created_at', { ascending: false })
    .limit(5);

  const { data: sameSource } = await serversTable
    .select(relatedSelect)
    .neq('name', name)
    .eq('status', 'active')
    .eq('source', server.source)
    .order('trust_score', { ascending: false })
    .limit(6);

  const related = [...(sameSource ?? [])];
  const seen = new Set(related.map((item: any) => item.name));
  const primaryTag = server.tags?.[0];

  if (related.length < 6 && primaryTag) {
    const { data: sameTag } = await serversTable
      .select(relatedSelect)
      .neq('name', name)
      .eq('status', 'active')
      .contains('tags', [primaryTag])
      .order('trust_score', { ascending: false })
      .limit(12);

    for (const item of sameTag ?? []) {
      if (seen.has(item.name)) continue;
      related.push(item);
      seen.add(item.name);
      if (related.length >= 6) break;
    }
  }

  const { user, supabase: userSupabase } = await resolveUser(req);
  let starred = false;
  if (user) {
    const { data: star } = await userSupabase
      .from('server_stars')
      .select('user_id')
      .eq('user_id', user.id)
      .eq('server_id', server.id)
      .maybeSingle();
    starred = !!star;
  }

  return NextResponse.json({
    ...server,
    scans: scans ?? [],
    starred,
    related_servers: related.slice(0, 6),
  });
}
