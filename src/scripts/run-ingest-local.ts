import { loadEnvConfig } from '@next/env';
loadEnvConfig(process.cwd());

import { fetchOfficialServers, fetchSmitheryServers, fetchGlamaServers, fetchMcpDirectoryServers, upsertServers } from '@/lib/ingest';
import { createServiceClient } from '@/lib/supabase/server';
import { Semaphore } from '@/lib/ingest/semaphore';
import { log } from '@/lib/logger';
import { compactIngestResults, summarizeIngestResults } from '@/lib/ingest-response';

const WORKER_CONCURRENCY = Number(process.env.LOCAL_INGEST_CONCURRENCY || 40);
const PROGRESS_EVERY = Number(process.env.LOCAL_INGEST_PROGRESS_EVERY || 25);

type FetchedSource = {
  source: string;
  servers: any[];
};

const fetchers: Record<string, (svc?: any) => Promise<any[]>> = {
  official: fetchOfficialServers,
  smithery: fetchSmitheryServers,
  glama: fetchGlamaServers,
  mcp_directory: fetchMcpDirectoryServers,
};

async function runLocalIngest() {
  const source = process.argv[2] || 'all';
  if (source !== 'all' && !fetchers[source]) {
    throw new Error(`Unknown source "${source}". Use all, official, smithery, glama, or mcp_directory.`);
  }

  const svc = createServiceClient();
  const workerSemaphore = new Semaphore(WORKER_CONCURRENCY);

  log.section('LOCAL INGEST PIPELINE');
  log.info('local', `Target: ${source} | Concurrency: ${WORKER_CONCURRENCY} (Sandbox protected at 3)`);

  const sourcesToRun = source === 'all' ? Object.keys(fetchers) : [source];

  const globalResults: Record<string, any> = {};
  const fetchedSources: FetchedSource[] = [];
  let totalServers = 0;

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
    fetchedSources.push({ source: src, servers });
    totalServers += servers.length;
  }

  log.info('local', `Total fetched across selected sources: ${totalServers}`);

  let totalStarted = 0;
  let totalCompleted = 0;

  for (const { source: src, servers } of fetchedSources) {
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
