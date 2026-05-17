import { loadEnvConfig } from '@next/env';
loadEnvConfig(process.cwd());

import { fetchOfficialServers, fetchSmitheryServers, fetchGlamaServers, fetchMcpDirectoryServers, upsertServers } from '@/lib/ingest';
import { createServiceClient } from '@/lib/supabase/server';
import { Semaphore } from '@/lib/ingest/semaphore';
import { log } from '@/lib/logger';
import { compactIngestResults, summarizeIngestResults } from '@/lib/ingest-response';

const DEFAULT_WORKER_CONCURRENCY = 40;
const MAX_WORKER_CONCURRENCY = 100;
const requestedConcurrency = Number(process.env.LOCAL_INGEST_CONCURRENCY || DEFAULT_WORKER_CONCURRENCY);
const WORKER_CONCURRENCY = Math.min(
  MAX_WORKER_CONCURRENCY,
  Number.isFinite(requestedConcurrency) && requestedConcurrency > 0
    ? Math.floor(requestedConcurrency)
    : DEFAULT_WORKER_CONCURRENCY
);
const requestedProgressEvery = Number(process.env.LOCAL_INGEST_PROGRESS_EVERY || 25);
const PROGRESS_EVERY = Number.isFinite(requestedProgressEvery) && requestedProgressEvery > 0
  ? Math.floor(requestedProgressEvery)
  : 25;

const fetchers: Record<string, (svc?: any) => Promise<any[]>> = {
  official: fetchOfficialServers,
  smithery: fetchSmitheryServers,
  glama: fetchGlamaServers,
  mcp_directory: fetchMcpDirectoryServers,
};

const sourceGroups: Record<string, string[]> = {
  all: Object.keys(fetchers),
  enrich: ['glama', 'mcp_directory'],
};

function normalizeSourceArg(arg: string | undefined): string {
  const raw = arg || 'all';
  return raw.replace(/^--/, '');
}

async function runLocalIngest() {
  const source = normalizeSourceArg(process.argv[2]);
  if (!sourceGroups[source] && !fetchers[source]) {
    throw new Error(`Unknown source "${process.argv[2]}". Use all, official, smithery, enrich, glama, or mcp_directory.`);
  }

  const svc = createServiceClient();
  const workerSemaphore = new Semaphore(WORKER_CONCURRENCY);

  log.section('LOCAL INGEST PIPELINE');
  log.info('local', `Target: ${source} | Concurrency: ${WORKER_CONCURRENCY} (Sandbox protected at 3)`);
  if (requestedConcurrency > MAX_WORKER_CONCURRENCY) {
    log.warn('local', `LOCAL_INGEST_CONCURRENCY=${requestedConcurrency} is above the safe cap; using ${MAX_WORKER_CONCURRENCY}`);
  }

  const sourcesToRun = sourceGroups[source] ?? [source];

  const globalResults: Record<string, any> = {};
  let totalServers = 0;
  let totalStarted = 0;
  let totalCompleted = 0;

  // Fetch and process each source immediately. In all-mode this keeps the
  // official registry payload from being retained while later sources run.
  for (const src of sourcesToRun) {
    log.section(`Fetching ${src}...`);
    const fetcher = fetchers[src];
    if (!fetcher) {
      log.error('local', `Unknown source ${src}`);
      continue;
    }

    let servers: any[];
    try {
      servers = await fetcher(svc);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      log.error('local', `Fetch failed for ${src}`, err);
      globalResults[src] = {
        fetched: 0,
        added: 0,
        updated: 0,
        skipped: 0,
        rejected: 0,
        errors: [message],
      };
      continue;
    }

    log.info('local', `Fetched ${servers.length} servers from ${src}`);
    totalServers += servers.length;

    log.info('local', `[${src}] Processing ${servers.length} servers with concurrency=${WORKER_CONCURRENCY}`);

    // Process concurrently
    let started = 0;
    let completed = 0;
    const srcResult = { fetched: servers.length, added: 0, updated: 0, skipped: 0, rejected: 0, errors: [] as string[] };

    const tasks = servers.map((server: any) => workerSemaphore.run(async () => {
      started++;
      totalStarted++;
      if (started === 1 || started % PROGRESS_EVERY === 0 || started === servers.length) {
        log.info('local', `[${src}] Started: ${started}/${servers.length} | Overall started: ${totalStarted}/${totalServers} | Active: ${started - completed}`);
      }

      try {
        const res = await upsertServers([server], svc, { mode: 'full' });
        srcResult.added += res.added;
        srcResult.updated += res.updated;
        srcResult.skipped += res.skipped;
        srcResult.rejected += res.rejected;
        if (res.errors) srcResult.errors.push(...res.errors);
      } catch (err: any) {
        srcResult.errors.push(err.message || String(err));
      } finally {
        completed++;
        totalCompleted++;
        if (completed === 1 || completed % PROGRESS_EVERY === 0 || completed === servers.length) {
          log.info(
            'local',
            `[${src}] Completed: ${completed}/${servers.length} | Overall completed: ${totalCompleted}/${totalServers} | Active: ${started - completed} | Added: ${srcResult.added} | Updated: ${srcResult.updated} | Skipped: ${srcResult.skipped} | Errors: ${srcResult.errors.length}`
          );
        }
      }
    }));

    await Promise.all(tasks);
    globalResults[src] = srcResult;
  }

  const compact = compactIngestResults(globalResults);
  const total = summarizeIngestResults(compact);

  log.section('LOCAL INGEST COMPLETE');
  console.log(JSON.stringify(total, null, 2));
  if (total.errors > 0) process.exitCode = 1;
}

runLocalIngest().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
