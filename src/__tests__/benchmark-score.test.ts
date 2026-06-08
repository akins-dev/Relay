import {
  anyExpectedServerInResults,
  scoreBenchmarkCase,
  summarizeBenchmarkScores,
  topToolMatches,
  parseBenchmarkJsonl,
} from '../benchmark/score';
import type { BenchmarkCase, BenchmarkSearchResult } from '../benchmark/types';

describe('benchmark scoring', () => {
  const emailCase: BenchmarkCase = {
    id: 'test-email',
    intent: 'send email',
    class: 'action',
    stratum: 'lexical_easy',
    requires_runnable: true,
    expected_servers: ['resend', 'sendgrid'],
    expected_tools: { resend: ['send_email'] },
  };

  const results: BenchmarkSearchResult[] = [
    {
      name: 'resend-mcp',
      tools: [{ name: 'send_email' }, { name: 'list_domains' }],
      manifest: { run_mode: 'local_stdio' },
    },
    { name: 'other', tools: [], manifest: { run_mode: 'discovery_only' } },
  ];

  test('Server-P@1 and P@3 with substring match', () => {
    expect(anyExpectedServerInResults(results, ['resend'], 1)).toBe(true);
    expect(anyExpectedServerInResults(results, ['sendgrid'], 3)).toBe(false);
    expect(anyExpectedServerInResults(results, ['resend', 'sendgrid'], 3)).toBe(true);
  });

  test('scoreBenchmarkCase computes tool and runnable metrics', () => {
    const score = scoreBenchmarkCase(emailCase, results);
    expect(score.server_p1).toBe(true);
    expect(score.tool_p1).toBe(true);
    expect(score.runnable_p1).toBe(true);
  });

  test('knowledge case scores deflection', () => {
    const kCase: BenchmarkCase = {
      id: 'k1',
      intent: 'what is REST',
      class: 'knowledge',
      stratum: 'knowledge',
    };
    const deflected = scoreBenchmarkCase(kCase, [], { knowledgeDeflected: true });
    expect(deflected.knowledge_deflected).toBe(true);
    const notDeflected = scoreBenchmarkCase(kCase, [{ name: 'x' }], { knowledgeDeflected: false });
    expect(notDeflected.knowledge_deflected).toBe(false);
  });

  test('summarizeBenchmarkScores aggregates action cases', () => {
    const scores = [
      scoreBenchmarkCase(emailCase, results),
      scoreBenchmarkCase(
        { ...emailCase, id: 'miss', expected_servers: ['stripe'] },
        results
      ),
    ];
    const summary = summarizeBenchmarkScores(scores);
    expect(summary.scored).toBe(2);
    expect(summary.server_p1).toBe(1);
    expect(summary.tool_p1_denominator).toBe(2);
  });

  test('topToolMatches uses first server key fallback', () => {
    expect(
      topToolMatches(
        [{ name: 'fx-html-mailer', tools: [{ name: 'send_email' }] }],
        { 'fx-html-mailer': ['send_email'] }
      )
    ).toBe(true);
  });

  test('parseBenchmarkJsonl skips comments and blanks', () => {
    const raw = `
# comment
{"id":"a","intent":"x","class":"action","stratum":"lexical_easy"}

`;
    const parsed = parseBenchmarkJsonl(raw);
    expect(parsed).toHaveLength(1);
    expect(parsed[0].id).toBe('a');
  });
});
