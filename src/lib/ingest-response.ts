type RawIngestResult = {
  fetched?: number;
  added?: number;
  updated?: number;
  skipped?: number;
  rejected?: number;
  errors?: string[];
  extraction_metrics?: {
    smithery_detail_fetched?: number;
    probe_attempts?: number;
    probe_success?: number;
    sandbox_attempts?: number;
    sandbox_success?: number;
    grade_a_complete?: number;
    grade_b_complete?: number;
  };
};

type RawIngestResults = Record<string, RawIngestResult>;

export interface CompactIngestResult {
  fetched: number;
  added: number;
  updated: number;
  skipped: number;
  rejected: number;
  error_count: number;
  extraction_metrics?: {
    smithery_detail_fetched: number;
    probe_attempts: number;
    probe_success: number;
    sandbox_attempts: number;
    sandbox_success: number;
    grade_a_complete: number;
    grade_b_complete: number;
  };
}

export interface IngestRunSummary {
  sources_processed: number;
  servers_found: number;
  servers_added: number;
  servers_updated: number;
  servers_skipped: number;
  servers_rejected: number;
  errors: number;
}

export function compactIngestResults(results: RawIngestResults): Record<string, CompactIngestResult> {
  return Object.fromEntries(
    Object.entries(results).map(([source, result]) => [
      source,
      {
        fetched: result.fetched ?? 0,
        added: result.added ?? 0,
        updated: result.updated ?? 0,
        skipped: result.skipped ?? 0,
        rejected: result.rejected ?? 0,
        error_count: Array.isArray(result.errors) ? result.errors.length : 0,
        ...(result.extraction_metrics
          ? {
              extraction_metrics: {
                smithery_detail_fetched: result.extraction_metrics.smithery_detail_fetched ?? 0,
                probe_attempts:          result.extraction_metrics.probe_attempts ?? 0,
                probe_success:           result.extraction_metrics.probe_success ?? 0,
                sandbox_attempts:        result.extraction_metrics.sandbox_attempts ?? 0,
                sandbox_success:         result.extraction_metrics.sandbox_success ?? 0,
                grade_a_complete:        result.extraction_metrics.grade_a_complete ?? 0,
                grade_b_complete:        result.extraction_metrics.grade_b_complete ?? 0,
              },
            }
          : {}),
      },
    ])
  );
}


export function summarizeIngestResults(results: Record<string, CompactIngestResult>): IngestRunSummary {
  return Object.values(results).reduce<IngestRunSummary>((acc, result) => ({
    sources_processed: acc.sources_processed + 1,
    servers_found: acc.servers_found + result.fetched,
    servers_added: acc.servers_added + result.added,
    servers_updated: acc.servers_updated + result.updated,
    servers_skipped: acc.servers_skipped + result.skipped,
    servers_rejected: acc.servers_rejected + result.rejected,
    errors: acc.errors + result.error_count,
  }), {
    sources_processed: 0,
    servers_found: 0,
    servers_added: 0,
    servers_updated: 0,
    servers_skipped: 0,
    servers_rejected: 0,
    errors: 0,
  });
}

export function buildIngestMessage(
  requestedSource: string,
  summary: IngestRunSummary
): string {
  const target = requestedSource === 'all' ? 'all configured sources' : requestedSource;
  return [
    `Ingest completed for ${target}.`,
    `${summary.servers_found} fetched`,
    `${summary.servers_added} added`,
    `${summary.servers_updated} updated`,
    `${summary.servers_skipped} skipped`,
    `${summary.servers_rejected} rejected`,
    `${summary.errors} errors`,
  ].join(' ');
}
