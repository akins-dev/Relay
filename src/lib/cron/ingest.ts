import { createServiceClient } from '@/lib/supabase/server';
import {
  fetchVendorServers,
  fetchOfficialServers,
  fetchSmitheryServers,
  fetchGitHubServers,
  fetchGlamaServers,
  fetchPulseMCPServers,
  fetchClaudeMCPServers,
  fetchMcpSoServers,
  fetchMcpRunServers,
  fetchComposioServers,
  upsertServers,
} from '@/lib/ingest';
import {
  buildIngestMessage,
  compactIngestResults,
  summarizeIngestResults,
} from '@/lib/ingest-response';

export async function runIngest(
  source: 'all'|'official'|'smithery'|'glama'|'pulsemcp'|'github'|'partner'|'vendor'|'claudemcp'|'mcpso'|'mcp_run'|'composio' = 'all'
) {
  const svc = createServiceClient();
  const ingestRuns = svc.from('ingest_runs') as any;
  const startedAt = new Date().toISOString();
  const results: Record<string, any> = {};
  const normalizedSource = source === 'vendor' ? 'partner' : source;

  // Track run
  const { data: run } = await ingestRuns.insert({
    source: normalizedSource, started_at: startedAt,
  }).select('id').single();

  try {
    if (normalizedSource === 'all' || normalizedSource === 'partner') {
      console.log('\n══════════════════════════════════════════════');
      console.log('[ingest] ▶ SOURCE: Verified Organization Registry');
      console.log('══════════════════════════════════════════════');
      const t0 = Date.now();
      const servers = await fetchVendorServers();
      console.log(`[ingest] Fetched ${servers.length} servers in ${((Date.now()-t0)/1000).toFixed(1)}s. Upserting...`);
      results.partner = await upsertServers(servers, svc);
      results.partner.fetched = servers.length;
      console.log(`[ingest] ✓ Partner complete: +${results.partner.added} added, ~${results.partner.updated} updated, ${results.partner.skipped} skipped, ${results.partner.rejected} rejected\n`);
    }

    if (normalizedSource === 'all' || normalizedSource === 'official') {
      console.log('\n══════════════════════════════════════════════');
      console.log('[ingest] ▶ SOURCE: Official MCP Registry');
      console.log('══════════════════════════════════════════════');
      const t0 = Date.now();
      const servers = await fetchOfficialServers();
      console.log(`[ingest] Fetched ${servers.length} servers in ${((Date.now()-t0)/1000).toFixed(1)}s. Upserting...`);
      results.official = await upsertServers(servers, svc);
      results.official.fetched = servers.length;
      console.log(`[ingest] ✓ Official complete: +${results.official.added} added, ~${results.official.updated} updated, ${results.official.skipped} skipped, ${results.official.rejected} rejected\n`);
    }

    if (normalizedSource === 'all' || normalizedSource === 'smithery') {
      console.log('\n══════════════════════════════════════════════');
      console.log('[ingest] ▶ SOURCE: Smithery');
      console.log('══════════════════════════════════════════════');
      const t0 = Date.now();
      const servers = await fetchSmitheryServers();
      console.log(`[ingest] Fetched ${servers.length} servers in ${((Date.now()-t0)/1000).toFixed(1)}s. Upserting...`);
      results.smithery = await upsertServers(servers, svc);
      results.smithery.fetched = servers.length;
      console.log(`[ingest] ✓ Smithery complete: +${results.smithery.added} added, ~${results.smithery.updated} updated, ${results.smithery.skipped} skipped, ${results.smithery.rejected} rejected\n`);
    }

    if (normalizedSource === 'all' || normalizedSource === 'glama') {
      console.log('\n══════════════════════════════════════════════');
      console.log('[ingest] ▶ SOURCE: Glama');
      console.log('══════════════════════════════════════════════');
      const t0 = Date.now();
      const servers = await fetchGlamaServers();
      console.log(`[ingest] Fetched ${servers.length} servers in ${((Date.now()-t0)/1000).toFixed(1)}s. Upserting...`);
      results.glama = await upsertServers(servers, svc);
      results.glama.fetched = servers.length;
      console.log(`[ingest] ✓ Glama complete: +${results.glama.added} added, ~${results.glama.updated} updated, ${results.glama.skipped} skipped, ${results.glama.rejected} rejected\n`);
    }

    if (normalizedSource === 'all' || normalizedSource === 'pulsemcp') {
      console.log('\n══════════════════════════════════════════════');
      console.log('[ingest] ▶ SOURCE: PulseMCP');
      console.log('══════════════════════════════════════════════');
      const t0 = Date.now();
      const servers = await fetchPulseMCPServers();
      console.log(`[ingest] Fetched ${servers.length} servers in ${((Date.now()-t0)/1000).toFixed(1)}s. Upserting...`);
      results.pulsemcp = await upsertServers(servers, svc);
      results.pulsemcp.fetched = servers.length;
      console.log(`[ingest] ✓ PulseMCP complete: +${results.pulsemcp.added} added, ~${results.pulsemcp.updated} updated, ${results.pulsemcp.skipped} skipped, ${results.pulsemcp.rejected} rejected\n`);
    }

    if (normalizedSource === 'all' || normalizedSource === 'claudemcp') {
      console.log('\n══════════════════════════════════════════════');
      console.log('[ingest] ▶ SOURCE: ClaudeMCP');
      console.log('══════════════════════════════════════════════');
      const t0 = Date.now();
      const servers = await fetchClaudeMCPServers();
      console.log(`[ingest] Fetched ${servers.length} servers in ${((Date.now()-t0)/1000).toFixed(1)}s. Upserting...`);
      results.claudemcp = await upsertServers(servers, svc);
      results.claudemcp.fetched = servers.length;
      console.log(`[ingest] ✓ ClaudeMCP complete: +${results.claudemcp.added} added, ~${results.claudemcp.updated} updated, ${results.claudemcp.skipped} skipped, ${results.claudemcp.rejected} rejected\n`);
    }

    if (normalizedSource === 'all' || normalizedSource === 'mcpso') {
      console.log('\n══════════════════════════════════════════════');
      console.log('[ingest] ▶ SOURCE: MCP.so');
      console.log('══════════════════════════════════════════════');
      const t0 = Date.now();
      const servers = await fetchMcpSoServers();
      console.log(`[ingest] Fetched ${servers.length} servers in ${((Date.now()-t0)/1000).toFixed(1)}s. Upserting...`);
      results.mcpso = await upsertServers(servers, svc);
      results.mcpso.fetched = servers.length;
      console.log(`[ingest] ✓ MCP.so complete: +${results.mcpso.added} added, ~${results.mcpso.updated} updated, ${results.mcpso.skipped} skipped, ${results.mcpso.rejected} rejected\n`);
    }

    if (normalizedSource === 'all' || normalizedSource === 'github') {
      console.log('\n══════════════════════════════════════════════');
      console.log('[ingest] ▶ SOURCE: GitHub MCP Servers');
      console.log('══════════════════════════════════════════════');
      const t0 = Date.now();
      const servers = await fetchGitHubServers();
      console.log(`[ingest] Fetched ${servers.length} servers in ${((Date.now()-t0)/1000).toFixed(1)}s. Upserting...`);
      results.github = await upsertServers(servers, svc);
      results.github.fetched = servers.length;
      console.log(`[ingest] ✓ GitHub complete: +${results.github.added} added, ~${results.github.updated} updated, ${results.github.skipped} skipped, ${results.github.rejected} rejected\n`);
    }

    if (normalizedSource === 'all' || normalizedSource === 'mcp_run') {
      console.log('\n══════════════════════════════════════════════');
      console.log('[ingest] ▶ SOURCE: MCP.run');
      console.log('══════════════════════════════════════════════');
      const t0 = Date.now();
      const servers = await fetchMcpRunServers();
      console.log(`[ingest] Fetched ${servers.length} servers in ${((Date.now()-t0)/1000).toFixed(1)}s. Upserting...`);
      results.mcp_run = await upsertServers(servers, svc);
      results.mcp_run.fetched = servers.length;
      console.log(`[ingest] ✓ MCP.run complete: +${results.mcp_run.added} added, ~${results.mcp_run.updated} updated, ${results.mcp_run.skipped} skipped, ${results.mcp_run.rejected} rejected\n`);
    }

    if (normalizedSource === 'all' || normalizedSource === 'composio') {
      console.log('\n══════════════════════════════════════════════');
      console.log('[ingest] ▶ SOURCE: Composio');
      console.log('══════════════════════════════════════════════');
      const t0 = Date.now();
      const servers = await fetchComposioServers();
      console.log(`[ingest] Fetched ${servers.length} servers in ${((Date.now()-t0)/1000).toFixed(1)}s. Upserting...`);
      results.composio = await upsertServers(servers, svc);
      results.composio.fetched = servers.length;
      console.log(`[ingest] ✓ Composio complete: +${results.composio.added} added, ~${results.composio.updated} updated, ${results.composio.skipped} skipped, ${results.composio.rejected} rejected\n`);
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

    return {
      success: true,
      message: buildIngestMessage(normalizedSource, total),
      run: {
        id: run?.id ?? null,
        source: normalizedSource,
        started_at: startedAt,
        finished_at: finishedAt,
        duration_ms: new Date(finishedAt).getTime() - new Date(startedAt).getTime(),
      },
      results: compactResults,
      total,
      timestamp: finishedAt,
    };

  } catch (err: any) {
    const finishedAt = new Date().toISOString();
    if (run?.id) {
      await ingestRuns.update({
        finished_at: finishedAt,
        error: err.message,
      }).eq('id', run.id);
    }
    return {
        error: err.message,
        run: {
          id: run?.id ?? null,
          source: normalizedSource,
          started_at: startedAt,
          finished_at: finishedAt,
        },
    };
  }
}
