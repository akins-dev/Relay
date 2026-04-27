/**
 * Cron Ingest Orchestrator
 *
 * Runs the ingest pipeline on a schedule or on-demand.
 * Sources: official, smithery, glama, github, partner (vendor).
 *
 * Dead sources removed (see docs/DECISION_LOG.md):
 *   - PulseMCP (API returns 403)
 *   - ClaudeMCP (relied on fragile __NEXT_DATA__ scraping)
 *   - MCP.so (speculative guessed API, no official docs)
 *   - MCP.run (speculative guessed API, no official docs)
 *   - Composio (not an MCP registry — returns generic app metadata)
 *
 * Introspection hooks removed — replaced by docs-first field mapping.
 */

import { createServiceClient } from '@/lib/supabase/server';
import {
  fetchVendorServers,
  fetchOfficialServers,
  fetchSmitheryServers,
  fetchGitHubServers,
  fetchGlamaServers,
  upsertServers,
} from '@/lib/ingest';
import {
  buildIngestMessage,
  compactIngestResults,
  summarizeIngestResults,
} from '@/lib/ingest-response';
import { log } from '@/lib/logger';

// ── Source configuration ────────────────────────────────────────────────────

type SourceKey = 'partner' | 'official' | 'smithery' | 'glama' | 'github';
type SourceInput = 'all' | SourceKey | 'vendor';

interface SourceConfig {
  key:     SourceKey;
  label:   string;
  fetcher: () => Promise<any[]>;
}

const SOURCES: SourceConfig[] = [
  { key: 'partner',  label: 'Verified Organization Registry', fetcher: fetchVendorServers },
  { key: 'official', label: 'Official MCP Registry',          fetcher: fetchOfficialServers },
  { key: 'smithery', label: 'Smithery',                       fetcher: fetchSmitheryServers },
  { key: 'glama',    label: 'Glama',                          fetcher: fetchGlamaServers },
  { key: 'github',   label: 'GitHub MCP Servers',             fetcher: fetchGitHubServers },
];

// ── Main ────────────────────────────────────────────────────────────────────

export async function runIngest(source: SourceInput = 'all') {
  const svc = createServiceClient();
  const ingestRuns = svc.from('ingest_runs') as any;
  const startedAt = new Date().toISOString();
  const results: Record<string, any> = {};

  // Normalize 'vendor' → 'partner'
  const normalizedSource: SourceInput = source === 'vendor' ? 'partner' : source;

  // Determine which sources to run
  const toRun = normalizedSource === 'all'
    ? SOURCES
    : SOURCES.filter(s => s.key === normalizedSource);

  if (toRun.length === 0) {
    log.warn('ingest:cron', `Unknown source: ${source}`);
    return { error: `Unknown source: ${source}` };
  }

  // Track run
  const { data: run } = await ingestRuns.insert({
    source: normalizedSource, started_at: startedAt,
  }).select('id').single();

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
      message: buildIngestMessage(normalizedSource, total),
      run: {
        id:          run?.id ?? null,
        source:      normalizedSource,
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
        source:      normalizedSource,
        started_at:  startedAt,
        finished_at: finishedAt,
      },
    };
  }
}
