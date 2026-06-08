/**
 * Search relevance benchmark types.
 * See docs/SEARCH_PIPELINE.md § Measurement.
 */

export type BenchmarkStratum =
  | 'lexical_easy'
  | 'lexical_hard'
  | 'conversational'
  | 'multi_valid'
  | 'knowledge'
  | 'discovery_only';

export interface BenchmarkCase {
  id: string;
  intent: string;
  class: 'action' | 'knowledge';
  stratum: BenchmarkStratum;
  /** When true, top result should be locally or remotely runnable. */
  requires_runnable?: boolean;
  /** Acceptable server name substrings (any match in result name counts). */
  expected_servers?: string[];
  /** Per-server acceptable tool names (substring match on trimmed tools). */
  expected_tools?: Record<string, string[]>;
  notes?: string;
}

export interface BenchmarkSearchResult {
  name: string;
  tools?: Array<{ name: string }>;
  manifest?: { run_mode?: string };
}

export interface CaseScore {
  id: string;
  stratum: BenchmarkStratum;
  class: 'action' | 'knowledge';
  server_p1: boolean;
  server_p3: boolean;
  tool_p1: boolean | null;
  runnable_p1: boolean | null;
  knowledge_deflect_expected: boolean;
  knowledge_deflected: boolean;
  result_count: number;
  top_server: string | null;
  skipped_search: boolean;
}

export interface BenchmarkSummary {
  total: number;
  scored: number;
  server_p1: number;
  server_p3: number;
  tool_p1: number;
  tool_p1_denominator: number;
  runnable_p1: number;
  runnable_p1_denominator: number;
  knowledge_precision: number;
  knowledge_denominator: number;
  by_stratum: Record<string, { count: number; server_p1: number; server_p3: number }>;
}
