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

import { parseBenchmarkJsonl, scoreBenchmarkCase, summarizeBenchmarkScores, formatBenchmarkSummary } from '../benchmark/score';
import type { BenchmarkCase } from '../benchmark/types';
import { classifyIntent } from '../lib/intent-classifier';
import { runSearch } from '../lib/search';

const BENCHMARK_FILE = process.env.BENCHMARK_FILE ?? 'benchmark/intents.jsonl';
const LIMIT = Number(process.env.BENCHMARK_LIMIT ?? '5');
const REPORT_DIR = join(process.cwd(), 'benchmark', 'reports');

async function main() {
  const raw = readFileSync(join(process.cwd(), BENCHMARK_FILE), 'utf8');
  const cases: BenchmarkCase[] = parseBenchmarkJsonl(raw);

  if (!process.env.NEXT_PUBLIC_SUPABASE_URL) {
    console.error('Missing NEXT_PUBLIC_SUPABASE_URL. Set Supabase env vars before live eval.');
    process.exit(1);
  }

  mkdirSync(REPORT_DIR, { recursive: true });

  const caseDetails: Array<Record<string, unknown>> = [];

  for (const benchCase of cases) {
    if (benchCase.class === 'knowledge') {
      const deflected = classifyIntent(benchCase.intent) === 'knowledge';
      const score = scoreBenchmarkCase(benchCase, [], { knowledgeDeflected: deflected });
      caseDetails.push({ ...benchCase, score, results: [] });
      continue;
    }

    const { results } = await runSearch({
      intent: benchCase.intent,
      limit: LIMIT,
      surface: 'rest',
    });

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
      tools: mapped[0]?.tools?.map((t: { name: string }) => t.name) ?? [],
      run_mode: mapped[0]?.manifest?.run_mode ?? null,
    });
  }

  const scores = caseDetails.map(d => (d as { score: import('../benchmark/types').CaseScore }).score);
  const summary = summarizeBenchmarkScores(scores);
  const markdown = formatBenchmarkSummary(summary);

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

main().catch(err => {
  console.error(err);
  process.exit(1);
});
