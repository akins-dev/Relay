import { loadEnvConfig } from '@next/env';
loadEnvConfig(process.cwd());

import { fetchOfficialServers, fetchSmitheryServers, fetchGlamaServers, fetchMcpDirectoryServers, upsertServers, prefetchExistingServers } from '@/lib/ingest';
import type { ExistingLookup, IngestMode } from '@/lib/ingest';
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

const sourceNames = new Set([...Object.keys(fetchers), ...Object.keys(sourceGroups)]);

// ── CLI parsing ─────────────────────────────────────────────────────────────

interface CliOptions {
  source: string;
  mode: IngestMode;
  reverse: boolean;
  offset: number;
  limit: number | null;
}

function readNumber(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? Math.floor(parsed) : fallback;
}

function parseCliOptions(argv: string[]): CliOptions {
  let source = 'all';
  let mode = (process.env.LOCAL_INGEST_MODE === 'catalog' ? 'catalog' : 'full') as IngestMode;
  let reverse = process.env.LOCAL_INGEST_REVERSE === 'true';
  let offset = readNumber(process.env.LOCAL_INGEST_OFFSET, 0);
  let limit: number | null = process.env.LOCAL_INGEST_LIMIT
    ? readNumber(process.env.LOCAL_INGEST_LIMIT, 0)
    : null;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const normalized = arg.replace(/^--/, '');

    if (sourceNames.has(normalized)) {
      source = normalized;
      continue;
    }

    if (arg === '--reverse') { reverse = true; continue; }
    if (arg === '--catalog') { mode = 'catalog'; continue; }
    if (arg === '--full')    { mode = 'full'; continue; }

    if (arg === '--mode') {
      const next = argv[++i];
      if (next !== 'catalog' && next !== 'full') throw new Error('--mode must be catalog or full');
      mode = next;
      continue;
    }
    if (arg.startsWith('--mode=')) {
      const value = arg.slice('--mode='.length);
      if (value !== 'catalog' && value !== 'full') throw new Error('--mode must be catalog or full');
      mode = value;
      continue;
    }

    if (arg === '--offset') { offset = readNumber(argv[++i], 0); continue; }
    if (arg.startsWith('--offset=')) { offset = readNumber(arg.slice('--offset='.length), 0); continue; }

    if (arg === '--limit') { limit = readNumber(argv[++i], 0); continue; }
    if (arg.startsWith('--limit=')) { limit = readNumber(arg.slice('--limit='.length), 0); continue; }

    throw new Error(
      `Unknown argument "${arg}". Use: all, official, smithery, enrich, glama, mcp_directory, --mode, --reverse, --offset, --limit.`
    );
  }

  return { source, mode, reverse, offset, limit };
}

// ── Main ────────────────────────────────────────────────────────────────────

async function runLocalIngest() {
  const options = parseCliOptions(process.argv.slice(2));
  const { source } = options;

  if (!sourceGroups[source] && !fetchers[source]) {
    throw new Error(`Unknown source "${source}". Use all, official, smithery, enrich, glama, or mcp_directory.`);
  }

  const svc = createServiceClient();
  const workerSemaphore = new Semaphore(WORKER_CONCURRENCY);

  log.section('LOCAL INGEST PIPELINE');
  log.info('local', `Target: ${source} | Mode: ${options.mode} | Concurrency: ${WORKER_CONCURRENCY} (Sandbox protected at 3)`);
  if (options.reverse) log.info('local', 'Processing order: REVERSE');
  if (options.offset > 0 || options.limit !== null) {
    log.info('local', `Slice: offset=${options.offset} limit=${options.limit ?? 'none'}`);
  }
  if (requestedConcurrency > MAX_WORKER_CONCURRENCY) {
    log.warn('local', `LOCAL_INGEST_CONCURRENCY=${requestedConcurrency} is above the safe cap; using ${MAX_WORKER_CONCURRENCY}`);
  }

  const sourcesToRun = sourceGroups[source] ?? [source];

  // ── PRE-FETCH ONCE: shared across all workers ─────────────────────────────
  // This eliminates the N+1 full-table scan problem where each concurrent
  // worker was independently querying ALL existing servers from the DB.
  log.info('local', 'Pre-fetching existing servers (one-time shared lookup)...');
  const existingLookup: ExistingLookup = await prefetchExistingServers(svc);

  const globalResults: Record<string, any> = {};
  let totalServers = 0;
  let totalStarted = 0;
  let totalCompleted = 0;

  for (const src of sourcesToRun) {
    log.section(`Fetching ${src}...`);
    const fetcher = fetchers[src];
    if (!fetcher) {
      log.error('local', `Unknown source ${src}`);
      continue;
    }

    let servers: any[];
    let fetchedCount = 0;
    try {
      servers = await fetcher(svc);
      fetchedCount = servers.length;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      log.error('local', `Fetch failed for ${src}`, err);
      globalResults[src] = {
        fetched: 0,
        added: 0, updated: 0, skipped: 0, rejected: 0,
        errors: [message],
      };
      continue;
    }

    // Apply --reverse
    if (options.reverse) servers = [...servers].reverse();

    // Apply --offset / --limit slicing
    if (options.offset > 0 || options.limit !== null) {
      const end = options.limit === null ? undefined : options.offset + options.limit;
      servers = servers.slice(options.offset, end);
    }

    log.info('local', `Fetched ${fetchedCount} from ${src}; selected ${servers.length} for processing`);
    totalServers += servers.length;

    log.info('local', `[${src}] Processing ${servers.length} servers with concurrency=${WORKER_CONCURRENCY}`);

    // Process concurrently — passing shared existingLookup to each worker
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
        const res = await upsertServers([server], svc, {
          mode: options.mode,
          existingLookup,  // shared — no DB query per worker
        });
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
