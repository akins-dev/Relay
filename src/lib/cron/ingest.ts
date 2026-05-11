/**
 * Cron Ingest Orchestrator
 *
 * Runs the ingest pipeline on a schedule or on-demand.
 *
 * Source tiers:
 *   PRIMARY (endpoints + tools): official, smithery
 *   ENRICHMENT (via github_url): glama, mcp_directory
 *   PARTNER:                     partner/vendor
 *
 * Dead sources removed:
 *   - github.ts      — GitHub has no standard MCP server listing API
 *   - PulseMCP       — API returns 403
 *   - ClaudeMCP      — Relied on fragile __NEXT_DATA__ scraping
 *   - mcp.so         — No JSON API
 *   - mcpservers.org — No API (static list)
 */

import { createServiceClient } from '@/lib/supabase/server';
import {
  fetchOfficialServers,
  fetchSmitheryServers,
  fetchGlamaServers,
  fetchMcpDirectoryServers,
  upsertServers,
} from '@/lib/ingest';
import {
  buildIngestMessage,
  compactIngestResults,
  summarizeIngestResults,
} from '@/lib/ingest-response';
import { log } from '@/lib/logger';

// ── Source configuration ────────────────────────────────────────────────────

type SourceKey   = 'official' | 'smithery' | 'glama' | 'mcp_directory';
type SourceInput = 'all' | SourceKey;

interface SourceConfig {
  key:     SourceKey;
  label:   string;
  tier:    'primary' | 'enrichment';
  fetcher: () => Promise<any[]>;
}

const SOURCES: SourceConfig[] = [
  { key: 'official',      label: 'Official MCP Registry',  tier: 'primary',    fetcher: fetchOfficialServers },
  { key: 'smithery',      label: 'Smithery',               tier: 'primary',    fetcher: fetchSmitheryServers },
  { key: 'glama',         label: 'Glama',                  tier: 'enrichment', fetcher: fetchGlamaServers },
  { key: 'mcp_directory', label: 'mcp.directory',          tier: 'enrichment', fetcher: fetchMcpDirectoryServers },
];

// ── Main ────────────────────────────────────────────────────────────────────

export async function runIngest(source: SourceInput = 'all') {
  const svc = createServiceClient();
  const ingestRuns = svc.from('ingest_runs') as any;
  const startedAt = new Date().toISOString();
  const results: Record<string, any> = {};

  // Determine which sources to run
  const toRun = source === 'all'
    ? SOURCES
    : SOURCES.filter(s => s.key === source);

  if (toRun.length === 0) {
    log.warn('ingest:cron', `Unknown source: ${source}`);
    return { error: `Unknown source: ${source}` };
  }

  // Track run — M2 fix: guard for DB errors so a tracking failure doesn't
  // silently hide the ingest results or prevent the run from completing.
  const { data: run, error: runInsertErr } = await ingestRuns.insert({
    source, started_at: startedAt,
  }).select('id').single();

  if (runInsertErr) {
    log.warn('ingest:cron', 'Failed to create ingest_runs record — run will not be tracked', {
      error: runInsertErr.message,
    });
  }

  try {
    for (const src of toRun) {
      log.section(`SOURCE: ${src.label}`);

      const t0 = Date.now();
      let servers: any[];

      try {
        servers = await src.fetcher();
      } catch (err) {
        log.error(`ingest:${src.key}`, 'Fetch failed', err);
        results[src.key] = { added: 0, updated: 0, skipped: 0, rejected: 0, errors: [String(err)] };
        continue;
      }

      log.info(`ingest:${src.key}`, `Fetched ${servers.length} servers in ${((Date.now() - t0) / 1000).toFixed(1)}s. Upserting...`);

      try {
        results[src.key] = await upsertServers(servers, svc);
        results[src.key].fetched = servers.length;
      } catch (err) {
        log.error(`ingest:${src.key}`, 'Upsert failed', err);
        results[src.key] = { added: 0, updated: 0, skipped: 0, rejected: 0, errors: [String(err)] };
      }

      const r = results[src.key];
      log.info(`ingest:${src.key}`, `Complete`, {
        added: r.added, updated: r.updated, skipped: r.skipped, rejected: r.rejected,
      });
    }

    // Summarize
    const compactResults = compactIngestResults(results);
    const total = summarizeIngestResults(compactResults);
    const finishedAt = new Date().toISOString();

    if (run?.id) {
      await ingestRuns.update({
        finished_at:      finishedAt,
        servers_found:    total.servers_found,
        servers_added:    total.servers_added,
        servers_updated:  total.servers_updated,
        servers_rejected: total.servers_rejected,
      }).eq('id', run.id);
    }

    return {
      success: true,
      message: buildIngestMessage(source, total),
      run: {
        id:          run?.id ?? null,
        source,
        started_at:  startedAt,
        finished_at: finishedAt,
        duration_ms: new Date(finishedAt).getTime() - new Date(startedAt).getTime(),
      },
      results: compactResults,
      total,
      timestamp: finishedAt,
    };

  } catch (err: any) {
    const finishedAt = new Date().toISOString();
    log.error('ingest:cron', 'Fatal error', err);

    if (run?.id) {
      await ingestRuns.update({
        finished_at: finishedAt,
        error:       err.message,
      }).eq('id', run.id);
    }

    return {
      error: err.message,
      run: {
        id:          run?.id ?? null,
        source,
        started_at:  startedAt,
        finished_at: finishedAt,
      },
    };
  }
}
