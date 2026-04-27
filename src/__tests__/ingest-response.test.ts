import {
  buildIngestMessage,
  compactIngestResults,
  summarizeIngestResults,
} from '../lib/ingest-response';

describe('ingest response formatting', () => {
  test('compacts verbose ingest results into count-only summaries', () => {
    const compact = compactIngestResults({
      official: {
        fetched: 12,
        added: 7,
        updated: 2,
        skipped: 1,
        rejected: 2,
        errors: ['server-a: timeout', 'server-b: invalid manifest'],
      },
    });

    expect(compact).toEqual({
      official: {
        fetched: 12,
        added: 7,
        updated: 2,
        skipped: 1,
        rejected: 2,
        error_count: 2,
      },
    });
    expect(JSON.stringify(compact)).not.toContain('server-a');
    expect(JSON.stringify(compact)).not.toContain('server-b');
  });

  test('builds an aggregate ingest summary message', () => {
    const summary = summarizeIngestResults({
      official: { fetched: 12, added: 7, updated: 2, skipped: 1, rejected: 2, error_count: 2 },
      github: { fetched: 5, added: 1, updated: 1, skipped: 3, rejected: 0, error_count: 0 },
    });

    expect(summary).toEqual({
      sources_processed: 2,
      servers_found: 17,
      servers_added: 8,
      servers_updated: 3,
      servers_skipped: 4,
      servers_rejected: 2,
      errors: 2,
    });
    expect(buildIngestMessage('all', summary)).toBe(
      'Ingest completed for all configured sources. 17 fetched 8 added 3 updated 4 skipped 2 rejected 2 errors'
    );
  });

  test('preserves extraction metrics when provided', () => {
    const compact = compactIngestResults({
      smithery: {
        fetched: 4,
        added: 1,
        updated: 1,
        skipped: 2,
        rejected: 0,
        errors: [],
        extraction_metrics: {
          sandbox_attempts: 3,
          sandbox_success: 2,
          readme_fallback_attempts: 1,
          unresolved_stdio_rows: 1,
        },
      },
    });

    expect(compact.smithery.extraction_metrics).toEqual({
      sandbox_attempts: 3,
      sandbox_success: 2,
      readme_fallback_attempts: 1,
      unresolved_stdio_rows: 1,
    });
  });
});
