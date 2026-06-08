/**
 * Live search benchmark evaluator.
 *
 * Usage:
 *   npx tsx src/scripts/run-benchmark-eval.ts
 *   BENCHMARK_FILE=benchmark/intents.jsonl npx tsx src/scripts/run-benchmark-eval.ts
 *
 * Requires NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY (or anon + RLS).
 */

import { readFileSync, mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import { loadEnvConfig } from '@next/env';

import { parseBenchmarkJsonl, scoreBenchmarkCase, summarizeBenchmarkScores, formatBenchmarkSummary } from '../benchmark/score';
import type { BenchmarkCase } from '../benchmark/types';
import { classifyIntent } from '../lib/intent-classifier';
import { runSearch } from '../lib/search';
import { createServiceClient } from '../lib/supabase/server';

const BENCHMARK_FILE = process.env.BENCHMARK_FILE ?? 'benchmark/intents.jsonl';
const LIMIT = Number(process.env.BENCHMARK_LIMIT ?? '5');
const CASE_FILTER = process.env.BENCHMARK_CASE ?? '';
const REPORT_DIR = join(process.cwd(), 'benchmark', 'reports');

loadEnvConfig(process.cwd());

async function main() {
  const raw = readFileSync(join(process.cwd(), BENCHMARK_FILE), 'utf8');
  const allCases: BenchmarkCase[] = parseBenchmarkJsonl(raw);
  const cases = CASE_FILTER
    ? allCases.filter(c => c.id === CASE_FILTER)
    : allCases;

  if (CASE_FILTER && cases.length === 0) {
    console.error(`No benchmark case found for BENCHMARK_CASE=${CASE_FILTER}`);
    process.exit(1);
  }

  if (!process.env.NEXT_PUBLIC_SUPABASE_URL) {
    console.error('Missing NEXT_PUBLIC_SUPABASE_URL. Set Supabase env vars before live eval.');
    process.exit(1);
  }

  mkdirSync(REPORT_DIR, { recursive: true });

  const caseDetails: Array<Record<string, unknown>> = [];
  const supabase = createServiceClient();

  for (const benchCase of cases) {
    if (benchCase.class === 'knowledge') {
      const deflected = classifyIntent(benchCase.intent) === 'knowledge';
      const score = scoreBenchmarkCase(benchCase, [], { knowledgeDeflected: deflected });
      caseDetails.push({ ...benchCase, score, results: [] });
      continue;
    }

    let results;
    try {
      ({ results } = await runSearch({
        intent: benchCase.intent,
        limit: LIMIT,
        surface: 'rest',
        supabaseClient: supabase,
      }));
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      throw new Error(`Benchmark case ${benchCase.id} failed: ${message}`);
    }

    const mapped = results.map(r => ({
      name: r.name,
      tools: r.tools,
      manifest: r.manifest,
    }));

    const score = scoreBenchmarkCase(benchCase, mapped);
    caseDetails.push({
      id: benchCase.id,
      intent: benchCase.intent,
      stratum: benchCase.stratum,
      score,
      top: mapped[0]?.name ?? null,
      top_results: mapped.slice(0, LIMIT).map(r => ({
        name: r.name,
        run_mode: r.manifest?.run_mode ?? null,
        tools: r.tools?.map((t: { name: string }) => t.name).slice(0, 3) ?? [],
      })),
      tools: mapped[0]?.tools?.map((t: { name: string }) => t.name) ?? [],
      run_mode: mapped[0]?.manifest?.run_mode ?? null,
    });
  }

  const scores = caseDetails.map(d => (d as { score: import('../benchmark/types').CaseScore }).score);
  const summary = summarizeBenchmarkScores(scores);
  const markdown = [
    formatBenchmarkSummary(summary),
    formatFailureDetails(caseDetails),
  ].filter(Boolean).join('\n\n');

  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  writeFileSync(join(REPORT_DIR, 'latest.md'), markdown);
  writeFileSync(join(REPORT_DIR, `eval-${stamp}.json`), JSON.stringify({ summary, cases: caseDetails }, null, 2));

  console.log(markdown);
  console.log(`\nWrote ${join(REPORT_DIR, 'latest.md')}`);

  const minP1 = Number(process.env.BENCHMARK_MIN_SERVER_P1 ?? '0');
  if (minP1 > 0 && summary.scored > 0) {
    const rate = summary.server_p1 / summary.scored;
    if (rate < minP1) {
      console.error(`Server-P@1 ${(rate * 100).toFixed(1)}% below threshold ${(minP1 * 100).toFixed(1)}%`);
      process.exit(1);
    }
  }
}

function formatFailureDetails(caseDetails: Array<Record<string, unknown>>): string {
  const misses = caseDetails.filter(d => {
    const score = d.score as import('../benchmark/types').CaseScore | undefined;
    return score?.class === 'action' && !score.server_p1;
  });

  if (misses.length === 0) return '';

  const lines = [
    '## Server-P@1 misses',
  ];

  for (const detail of misses) {
    const score = detail.score as import('../benchmark/types').CaseScore;
    const topResults = (detail.top_results ?? []) as Array<{
      name: string;
      run_mode: string | null;
      tools: string[];
    }>;
    lines.push(
      `- **${score.id}** (${score.stratum}): top=${score.top_server ?? 'none'}, P@3=${score.server_p3 ? 'yes' : 'no'}`
    );
    if (topResults.length > 0) {
      lines.push(`  - Top ${topResults.length}: ${topResults.map(r => r.name).join(', ')}`);
    }
  }

  return lines.join('\n');
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
