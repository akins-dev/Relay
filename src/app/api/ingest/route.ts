import { safeCompare } from '@/lib/utils';
import { z } from 'zod';
import { zodError } from '@/lib/api';

const IngestSchema = z.object({
  source: z.enum(['all','official','smithery','glama','pulsemcp','github']).default('all'),
});
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
import {
  buildIngestMessage,
  compactIngestResults,
  summarizeIngestResults,
} from '@/lib/ingest-response';

function isAuthorized(req: NextRequest) {
  return safeCompare(req.headers.get('authorization') ?? '', `Bearer ${process.env.CRON_SECRET ?? ''}`);
}

function jsonResponse(payload: unknown, status = 200) {
  return new NextResponse(JSON.stringify(payload, null, 2), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}

export async function POST(req: NextRequest) {
  if (!isAuthorized(req)) return jsonResponse({ error: 'Unauthorized' }, 401);

  let body: z.infer<typeof IngestSchema>;
  try { body = IngestSchema.parse(await req.json().catch(() => ({}))); }
  catch (e) { return zodError(e); }
  const { source } = body;
  const svc = createServiceClient();
  const ingestRuns = svc.from('ingest_runs') as any;
  const startedAt = new Date().toISOString();
  const results: Record<string, any> = {};

  // Track run
  const { data: run } = await ingestRuns.insert({
    source, started_at: startedAt,
  }).select('id').single();

  try {
    if (source === 'all' || source === 'official') {
      console.log('[ingest] Fetching official registry...');
      const servers = await fetchOfficialServers();
      console.log(`[ingest] Official registry returned ${servers.length} servers. Upserting...`);
      results.official = await upsertServers(servers, svc);
      results.official.fetched = servers.length;
    }

    if (source === 'all' || source === 'smithery') {
      console.log('[ingest] Fetching Smithery...');
      const servers = await fetchSmitheryServers();
      console.log(`[ingest] Smithery returned ${servers.length} servers. Upserting...`);
      results.smithery = await upsertServers(servers, svc);
      results.smithery.fetched = servers.length;
    }

    if (source === 'all' || source === 'glama') {
      console.log('[ingest] Fetching Glama...');
      const servers = await fetchGlamaServers();
      console.log(`[ingest] Glama returned ${servers.length} servers. Upserting...`);
      results.glama = await upsertServers(servers, svc);
      results.glama.fetched = servers.length;
    }

    if (source === 'all' || source === 'pulsemcp') {
      console.log('[ingest] Fetching PulseMCP...');
      const servers = await fetchPulseMCPServers();
      console.log(`[ingest] PulseMCP returned ${servers.length} servers. Upserting...`);
      results.pulsemcp = await upsertServers(servers, svc);
      results.pulsemcp.fetched = servers.length;
    }

    if (source === 'all' || source === 'github') {
      console.log('[ingest] Fetching GitHub servers...');
      const servers = await fetchGitHubServers();
      console.log(`[ingest] GitHub returned ${servers.length} servers. Upserting...`);
      results.github = await upsertServers(servers, svc);
      results.github.fetched = servers.length;
    }

    // Update ingest run record
    const compactResults = compactIngestResults(results);
    const total = summarizeIngestResults(compactResults);
    const finishedAt = new Date().toISOString();

    if (run?.id) {
      await ingestRuns.update({
        finished_at: finishedAt,
        servers_found: total.servers_found,
        servers_added: total.servers_added,
        servers_updated: total.servers_updated,
        servers_rejected: total.servers_rejected,
      }).eq('id', run.id);
    }

    return jsonResponse({
      success: true,
      message: buildIngestMessage(source, total),
      run: {
        id: run?.id ?? null,
        source,
        started_at: startedAt,
        finished_at: finishedAt,
        duration_ms: new Date(finishedAt).getTime() - new Date(startedAt).getTime(),
      },
      results: compactResults,
      total,
      timestamp: finishedAt,
    });

  } catch (err: any) {
    const finishedAt = new Date().toISOString();
    if (run?.id) {
      await ingestRuns.update({
        finished_at: finishedAt,
        error: err.message,
      }).eq('id', run.id);
    }
    return jsonResponse({
      error: err.message,
      run: {
        id: run?.id ?? null,
        source,
        started_at: startedAt,
        finished_at: finishedAt,
      },
    }, 500);
  }
}

// GET — ingest status / last run info
export async function GET(req: NextRequest) {
  if (!isAuthorized(req)) return jsonResponse({ error: 'Unauthorized' }, 401);

  const svc = createServiceClient();
  const { data: runs } = await (svc.from('ingest_runs') as any)
    .select('*')
    .order('started_at', { ascending: false })
    .limit(10);

  return jsonResponse({ runs: runs ?? [] });
}
