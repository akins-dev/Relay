/**
 * Pure scoring for search relevance benchmarks.
 * No database — safe for unit tests and offline CI.
 */

import type {
  BenchmarkCase,
  BenchmarkSearchResult,
  BenchmarkSummary,
  CaseScore,
} from './types';

export function serverNameMatches(resultName: string, expected: string): boolean {
  const normalize = (value: string) => value.toLowerCase().replace(/[^a-z0-9]/g, '');
  const r = normalize(resultName);
  const e = normalize(expected);
  return r === e || r.includes(e) || e.includes(r);
}

export function anyExpectedServerInResults(
  results: BenchmarkSearchResult[],
  expectedServers: string[],
  k: number
): boolean {
  const slice = results.slice(0, k);
  return slice.some(r =>
    expectedServers.some(exp => serverNameMatches(r.name, exp))
  );
}

export function topToolMatches(
  results: BenchmarkSearchResult[],
  expectedTools: Record<string, string[]>
): boolean {
  if (results.length === 0) return false;
  const top = results[0];
  const patterns = Object.entries(expectedTools).flatMap(([serverKey, tools]) => {
    if (serverNameMatches(top.name, serverKey)) return tools;
    return [];
  });
  if (patterns.length === 0) {
    const firstPatterns = Object.values(expectedTools)[0];
    if (!firstPatterns) return false;
    return firstPatterns.some(p =>
      (top.tools ?? []).some(t => t.name.toLowerCase().includes(p.toLowerCase()))
    );
  }
  return patterns.some(p =>
    (top.tools ?? []).some(t => t.name.toLowerCase().includes(p.toLowerCase()))
  );
}

export function topIsRunnable(results: BenchmarkSearchResult[]): boolean {
  const mode = results[0]?.manifest?.run_mode;
  return mode === 'local_stdio' || mode === 'remote_mcp';
}

export function scoreBenchmarkCase(
  benchCase: BenchmarkCase,
  results: BenchmarkSearchResult[],
  options: { knowledgeDeflected?: boolean } = {}
): CaseScore {
  const knowledgeDeflected = options.knowledgeDeflected ?? false;
  const knowledgeExpected = benchCase.class === 'knowledge';

  if (knowledgeExpected) {
    return {
      id: benchCase.id,
      stratum: benchCase.stratum,
      class: benchCase.class,
      server_p1: false,
      server_p3: false,
      tool_p1: null,
      runnable_p1: null,
      knowledge_deflect_expected: true,
      knowledge_deflected: knowledgeDeflected,
      result_count: results.length,
      top_server: results[0]?.name ?? null,
      skipped_search: knowledgeDeflected,
    };
  }

  const expected = benchCase.expected_servers ?? [];
  const hasExpected = expected.length > 0;

  return {
    id: benchCase.id,
    stratum: benchCase.stratum,
    class: benchCase.class,
    server_p1: hasExpected
      ? anyExpectedServerInResults(results, expected, 1)
      : results.length > 0,
    server_p3: hasExpected
      ? anyExpectedServerInResults(results, expected, 3)
      : results.length > 0,
    tool_p1: benchCase.expected_tools
      ? topToolMatches(results, benchCase.expected_tools)
      : null,
    runnable_p1: benchCase.requires_runnable
      ? results.length > 0 && topIsRunnable(results)
      : null,
    knowledge_deflect_expected: false,
    knowledge_deflected: false,
    result_count: results.length,
    top_server: results[0]?.name ?? null,
    skipped_search: false,
  };
}

export function summarizeBenchmarkScores(scores: CaseScore[]): BenchmarkSummary {
  const actionScores = scores.filter(s => s.class === 'action');
  const knowledgeScores = scores.filter(s => s.knowledge_deflect_expected);

  const toolScores = actionScores.filter(s => s.tool_p1 !== null);
  const runnableScores = actionScores.filter(s => s.runnable_p1 !== null);

  const by_stratum: BenchmarkSummary['by_stratum'] = {};
  for (const s of actionScores) {
    if (!by_stratum[s.stratum]) {
      by_stratum[s.stratum] = { count: 0, server_p1: 0, server_p3: 0 };
    }
    by_stratum[s.stratum].count += 1;
    if (s.server_p1) by_stratum[s.stratum].server_p1 += 1;
    if (s.server_p3) by_stratum[s.stratum].server_p3 += 1;
  }

  return {
    total: scores.length,
    scored: actionScores.length,
    server_p1: actionScores.filter(s => s.server_p1).length,
    server_p3: actionScores.filter(s => s.server_p3).length,
    tool_p1: toolScores.filter(s => s.tool_p1).length,
    tool_p1_denominator: toolScores.length,
    runnable_p1: runnableScores.filter(s => s.runnable_p1).length,
    runnable_p1_denominator: runnableScores.length,
    knowledge_precision: knowledgeScores.filter(s => s.knowledge_deflected).length,
    knowledge_denominator: knowledgeScores.length,
    by_stratum,
  };
}

export function formatBenchmarkSummary(summary: BenchmarkSummary): string {
  const pct = (n: number, d: number) => (d === 0 ? 'n/a' : `${((n / d) * 100).toFixed(1)}%`);

  const lines = [
    '# Search benchmark summary',
    '',
    `Cases: ${summary.total} (${summary.scored} action, ${summary.knowledge_denominator} knowledge)`,
    '',
    '## Primary metrics',
    `- **Server-P@1**: ${summary.server_p1}/${summary.scored} (${pct(summary.server_p1, summary.scored)})`,
    `- **Server-P@3**: ${summary.server_p3}/${summary.scored} (${pct(summary.server_p3, summary.scored)})`,
    `- **Tool-P@1** (trimmed top-3): ${summary.tool_p1}/${summary.tool_p1_denominator} (${pct(summary.tool_p1, summary.tool_p1_denominator)})`,
    `- **Runnable-P@1**: ${summary.runnable_p1}/${summary.runnable_p1_denominator} (${pct(summary.runnable_p1, summary.runnable_p1_denominator)})`,
    `- **Knowledge precision** (deflect): ${summary.knowledge_precision}/${summary.knowledge_denominator} (${pct(summary.knowledge_precision, summary.knowledge_denominator)})`,
    '',
    '## By stratum (action cases)',
  ];

  for (const [stratum, stats] of Object.entries(summary.by_stratum)) {
    lines.push(
      `- **${stratum}**: P@1 ${stats.server_p1}/${stats.count}, P@3 ${stats.server_p3}/${stats.count}`
    );
  }

  return lines.join('\n');
}

export function parseBenchmarkJsonl(raw: string): import('./types').BenchmarkCase[] {
  return raw
    .split('\n')
    .map(line => line.trim())
    .filter(line => line.length > 0 && !line.startsWith('#'))
    .map(line => JSON.parse(line) as import('./types').BenchmarkCase);
}
