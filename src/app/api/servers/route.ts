import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient, createServiceClient } from '@/lib/supabase/server';
import { resolveUser } from '@/lib/auth-server';
import { rateLimit, LIMITS } from '@/lib/ratelimit';
import { scanServer, computeTrustScore } from '@/lib/security';
import { createHash } from 'crypto';
import { SITE_URL } from '@/lib/site';

const PublishSchema = z.object({
  name:             z.string().min(3).max(64).regex(/^[a-z0-9-]+$/),
  display_name:     z.string().min(3).max(100),
  description:      z.string().min(20).max(500),
  long_description: z.string().max(5000).optional(),
  endpoint:         z.string().url(),
  version:          z.string().default('1.0.0'),
  github_url:       z.string().url().optional().or(z.literal('')),
  homepage_url:     z.string().url().optional().or(z.literal('')),
  license:          z.string().default('MIT'),
  tags:             z.array(z.string()).min(1).max(10),
  tools:            z.array(z.string()).min(1).max(100),
});

export async function GET(req: NextRequest) {
  const supabase = createClient();
  const { searchParams } = new URL(req.url);

  const q         = searchParams.get('q') || '';
  const tag       = searchParams.get('tag') || '';
  const sort      = searchParams.get('sort') || 'stars';
  const verified  = searchParams.get('verified') === 'true';
  const source    = searchParams.get('source') || '';
  const transport = searchParams.get('transport') || '';
  const page      = Math.max(1, parseInt(searchParams.get('page') || '1'));
  const limit     = Math.min(50, parseInt(searchParams.get('limit') || '12'));
  const from      = (page - 1) * limit;
  const to        = from + limit - 1;

  let query = supabase
    .from('servers')
    .select(`
      id, name, display_name, description, version, tags, tools,
      status, verified, stars, total_calls, calls_today,
      latency_ms, uptime_pct, trust_score, scan_status, scan_issues,
      created_at, profiles!author_id ( username, avatar_url )
    `, { count: 'exact' })
    .in('status', ['active', 'pending_review']);

  if (source)    query = query.eq('source', source);
  if (q)         query = query.or(`name.ilike.%${q}%,display_name.ilike.%${q}%,description.ilike.%${q}%`);
  if (tag)       query = query.contains('tags', [tag]);
  if (verified)  query = query.eq('verified', true);
  if (transport === 'cloud') query = query.neq('transport', 'stdio');
  if (transport === 'stdio') query = query.eq('transport', 'stdio');

  const sortMap: Record<string, { column: string; ascending: boolean }> = {
    stars:   { column: 'stars',       ascending: false },
    calls:   { column: 'total_calls', ascending: false },
    trust:   { column: 'trust_score', ascending: false },
    recent:  { column: 'created_at',  ascending: false },
    latency: { column: 'latency_ms',  ascending: true  },
  };
  const s = sortMap[sort] ?? sortMap.stars;
  query = query.order(s.column, { ascending: s.ascending });

  const { data, count, error } = await query.range(from, to);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({
    servers: data ?? [],
    total: count ?? 0,
    page,
    pages: Math.ceil((count ?? 0) / limit),
  });
}

export async function POST(req: NextRequest) {
  const { user, supabase } = await resolveUser(req);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const rlCheck = await rateLimit(`publish:${user.id}`, LIMITS.publish);
  if (!rlCheck.allowed) return NextResponse.json({ error: 'Rate limit exceeded', hint: `Create a free API key at ${SITE_URL} for higher limits (200 calls/min)` }, { status: 429 });

  try {
    const body = PublishSchema.parse(await req.json());

    // Name taken?
    const { data: existing } = await supabase
      .from('servers').select('id').eq('name', body.name).maybeSingle();
    if (existing) return NextResponse.json({ error: 'Server name already taken' }, { status: 409 });

    // L8: Typosquatting check via SQL RPC
    const { data: similar } = await supabase
      .rpc('find_similar_names', { candidate: body.name });
    const highRisk = (similar ?? []).filter((s: any) => s.similarity > 0.8);
    if (highRisk.length > 0) {
      return NextResponse.json({
        error: `Name too similar to existing verified server: ${highRisk.map((s: any) => s.name).join(', ')}`,
        similar: highRisk,
      }, { status: 409 });
    }

    // L1: Static security scan
    const scanResult = scanServer({
      name: body.name, description: body.description,
      long_description: body.long_description,
      endpoint: body.endpoint, tools: body.tools, tags: body.tags,
    });

    const schemaHash = createHash('sha256')
      .update(JSON.stringify(body.tools.slice().sort()) + body.version)
      .digest('hex');
    const status     = scanResult.passed ? 'active' : 'rejected';
    const trustScore = computeTrustScore({
      verified: 0, scanScore: scanResult.score,
      uptimePct: 100, stars: 0, daysSinceChange: 0,
    });

    const { data: server, error: insertErr } = await supabase
      .from('servers')
      .insert({
        name:             body.name,
        display_name:     body.display_name,
        description:      body.description,
        long_description: body.long_description ?? null,
        author_id:        user.id,
        version:          body.version,
        endpoint:         body.endpoint,
        github_url:       body.github_url  || null,
        homepage_url:     body.homepage_url || null,
        license:          body.license,
        tags:             body.tags,
        tools:            body.tools,
        status:           status as any,
        schema_hash:      schemaHash,
        scan_status:      (scanResult.passed ? 'passed' : 'failed') as any,
        scan_issues:      scanResult.issues as any,
        trust_score:      trustScore,
        last_scanned_at:  new Date().toISOString(),
      })
      .select('id, name')
      .single();

    if (insertErr) return NextResponse.json({ error: insertErr.message }, { status: 500 });

    // Write scan result via service client (RLS: users can't write scan_results)
    const svc = createServiceClient();
    await svc.from('scan_results').insert({
      server_id: server.id,
      scan_type: 'static',
      passed:    scanResult.passed,
      score:     scanResult.score,
      issues:    scanResult.issues as any,
      details:   scanResult.details,
    });

    return NextResponse.json({
      id: server.id, name: server.name,
      status, scan: scanResult, trust_score: trustScore,
      similar_names: similar ?? [],
    }, { status: 201 });

  } catch (e: any) {
    if (e.errors) return NextResponse.json({ error: e.errors[0]?.message }, { status: 400 });
    return NextResponse.json({ error: 'Publish failed' }, { status: 500 });
  }
}
