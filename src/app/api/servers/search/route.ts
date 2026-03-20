import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { rateLimit, LIMITS } from '@/lib/ratelimit';

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const q     = searchParams.get('q');
  const limit = Math.min(20, parseInt(searchParams.get('limit') || '5'));

  if (!q) return NextResponse.json({ error: 'Query required' }, { status: 400 });

  // Rate limit
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0] || 'unknown';
  const rl  = rateLimit(`search:${ip}`, LIMITS.search);
  if (!rl.allowed) {
    return NextResponse.json({ error: 'Rate limit exceeded' }, { status: 429 });
  }

  const supabase = createClient();

  const { data, error } = await supabase
    .rpc('search_servers', { query_text: q, result_limit: limit });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  if (!data || data.length === 0) {
    return NextResponse.json({ query: q, results: [], message: 'No servers found. Try broader terms.' });
  }

  // Enrich with tool_schemas + author — single query
  const ids = data.map((s: any) => s.id);
  const { data: enriched } = await supabase
    .from('servers')
    .select(`
      id, name, display_name, description, version, tags, tools, tool_schemas,
      trust_score, verified, source, scan_status, cve_issues,
      latency_ms, uptime_pct, stars, calls_today, endpoint,
      profiles!author_id ( username )
    `)
    .in('id', ids)
    .eq('status', 'active');

  const results = (enriched ?? data).map((s: any) => ({
    name:         s.name,
    display_name: s.display_name,
    description:  s.description,
    version:      s.version,
    trust_score:  s.trust_score,
    verified:     s.verified,
    source:       s.source ?? 'direct',
    scan_status:  s.scan_status,
    latency_ms:   s.latency_ms,
    uptime_pct:   s.uptime_pct,
    stars:        s.stars,
    calls_today:  s.calls_today,
    tags:         s.tags,
    author:       s.profiles?.username ?? 'unknown',
    // Tool names (backward compat)
    tools: s.tools ?? [],
    // Full schemas — agents use these for argument construction
    tool_schemas: (s.tool_schemas ?? []).length > 0
      ? s.tool_schemas
      : (s.tools ?? []).map((name: string) => ({ name })),
    // Usage hint for agents
    invoke: {
      rest: `POST /api/proxy/${s.name}/{toolName}`,
      mcp:  `invoke_tool({ server: "${s.name}", tool: "{toolName}", args: {...} })`,
    },
  }));

  return NextResponse.json({
    query:   q,
    count:   results.length,
    results,
  });
}
