import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import {
  fetchOfficialServers,
  fetchSmitheryServers,
  fetchGitHubServers,
  fetchGlamaServers,
  fetchPulseMCPServers,
  upsertServers,
} from '@/lib/ingest';

function isAuthorized(req: NextRequest) {
  return req.headers.get('authorization') === `Bearer ${process.env.CRON_SECRET}`;
}

export async function POST(req: NextRequest) {
  if (!isAuthorized(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { source = 'all' } = await req.json().catch(() => ({}));
  const svc = createServiceClient();
  const startedAt = new Date().toISOString();
  const results: Record<string, any> = {};

  // Track run
  const { data: run } = await svc.from('ingest_runs').insert({
    source, started_at: startedAt,
  }).select('id').single();

  try {
    if (source === 'all' || source === 'official') {
      console.log('[ingest] Fetching official registry...');
      const servers = await fetchOfficialServers();
      results.official = await upsertServers(servers, svc);
      results.official.fetched = servers.length;
    }

    if (source === 'all' || source === 'smithery') {
      console.log('[ingest] Fetching Smithery...');
      const servers = await fetchSmitheryServers();
      results.smithery = await upsertServers(servers, svc);
      results.smithery.fetched = servers.length;
    }

    if (source === 'all' || source === 'glama') {
      console.log('[ingest] Fetching Glama...');
      const servers = await fetchGlamaServers();
      results.glama = await upsertServers(servers, svc);
      results.glama.fetched = servers.length;
    }

    if (source === 'all' || source === 'pulsemcp') {
      console.log('[ingest] Fetching PulseMCP...');
      const servers = await fetchPulseMCPServers();
      results.pulsemcp = await upsertServers(servers, svc);
      results.pulsemcp.fetched = servers.length;
    }

    if (source === 'all' || source === 'github') {
      console.log('[ingest] Fetching GitHub servers...');
      const servers = await fetchGitHubServers();
      results.github = await upsertServers(servers, svc);
      results.github.fetched = servers.length;
    }

    // Update ingest run record
    const total = Object.values(results).reduce((acc: any, r: any) => ({
      servers_found:    (acc.servers_found    || 0) + (r.fetched    || 0),
      servers_added:    (acc.servers_added    || 0) + (r.added      || 0),
      servers_updated:  (acc.servers_updated  || 0) + (r.updated    || 0),
      servers_rejected: (acc.servers_rejected || 0) + (r.rejected   || 0),
    }), {});

    if (run?.id) {
      await svc.from('ingest_runs').update({
        finished_at: new Date().toISOString(),
        ...total,
      }).eq('id', run.id);
    }

    return NextResponse.json({
      success: true,
      results,
      total,
      timestamp: new Date().toISOString(),
    });

  } catch (err: any) {
    if (run?.id) {
      await svc.from('ingest_runs').update({
        finished_at: new Date().toISOString(),
        error: err.message,
      }).eq('id', run.id);
    }
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

// GET — ingest status / last run info
export async function GET(req: NextRequest) {
  if (!isAuthorized(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const svc = createServiceClient();
  const { data: runs } = await svc
    .from('ingest_runs')
    .select('*')
    .order('started_at', { ascending: false })
    .limit(10);

  return NextResponse.json({ runs: runs ?? [] });
}
