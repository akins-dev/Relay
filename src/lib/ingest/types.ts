/**
 * Relay — Ingest Types
 *
 * Shared type definitions for the ingest pipeline.
 * Every upstream source normalizes into IngestServer before upsert.
 *
 * Design decisions:
 *   - Fields that are unknown are null, never defaulted to fake values like 'MIT'
 *   - Transport is a strict enum, detected from upstream contract not URL guessing
 *   - source_id is always the upstream's canonical identifier for that entry
 *   - connection_profile carries the raw upstream JSON for the Option B side table
 */

// ── Valid upstream sources ────────────────────────────────────────────────────

export type IngestSource =
  | 'official'
  | 'smithery'
  | 'glama'
  | 'github'
  | 'partner';

// ── Transport enum ───────────────────────────────────────────────────────────

export type Transport = 'stdio' | 'sse' | 'streamable_http' | 'unknown';

// ── Normalized server record ─────────────────────────────────────────────────

export interface ToolSchema {
  name:         string;
  description?: string;
  inputSchema?: Record<string, any>;
}

export interface IngestServer {
  /** Slugified name (lowercase, hyphen-separated) — max 64 chars */
  name:              string;
  /** Human-readable display name */
  display_name:      string;
  /** Short description (max 300 chars) */
  description:       string;
  /** Longer description from README or upstream */
  long_description?: string | null;
  /** Quality indicator for the description field */
  description_quality?: 'upstream' | 'readme_parsed' | 'auto_generated';
  /** Primary HTTP endpoint for remote invocation (empty for stdio) */
  endpoint:          string;
  /** Semver version string */
  version:           string;
  /** GitHub repository URL */
  github_url?:       string | null;
  /** Homepage / documentation URL */
  homepage_url?:     string | null;
  /** Short title (from official registry) — high-value for search */
  title?:            string | null;
  /** SPDX license identifier — null if unknown, never defaulted */
  license:           string | null;
  /** Tags/categories from upstream */
  tags:              string[];
  /** Tool names (strings) */
  tools:             string[];
  /** Full tool schemas (name + description + inputSchema) */
  tool_schemas:      ToolSchema[];
  /** Which upstream registry this came from */
  source:            IngestSource;
  /** Canonical ID from the upstream source */
  source_id?:        string | null;
  /** Legacy: Smithery qualified name */
  smithery_id?:      string | null;
  /** Legacy: Official registry qualified name */
  official_id?:      string | null;
  /** Legacy: Glama server ID */
  glama_id?:         string | null;
  /** Whether the upstream marks this as verified/official */
  verified?:         boolean;
  /** Transport type — determined from upstream contract, not URL guessing */
  transport:         Transport;
  /** ISO timestamp of last upstream update */
  upstream_updated_at?: string | null;
  /** URL to the raw README file */
  readme_url?:       string | null;

  // ── Connection profile (for Option B side table) ─────────────────────────

  /** Raw upstream JSON — stored verbatim in server_connection_profiles */
  raw_upstream_json?: Record<string, any> | null;
  /** Official registry: remotes[] array */
  remotes?:          any[] | null;
  /** Official registry: packages[] array */
  packages?:         any[] | null;
  /** Official registry: icons[] array */
  icons?:            any[] | null;
  /** Official registry: _meta["io.modelcontextprotocol.registry/official"] */
  official_meta?:    Record<string, any> | null;
  /** Official registry: _meta["io.modelcontextprotocol.registry/publisher-provided"] */
  publisher_meta?:   Record<string, any> | null;
}

// ── Ingest result ────────────────────────────────────────────────────────────

export interface IngestResult {
  added:    number;
  updated:  number;
  rejected: number;
  skipped:  number;
  errors:   string[];
  fetched?: number;
  extraction_metrics?: {
    sandbox_attempts: number;
    sandbox_success: number;
    readme_fallback_attempts: number;
    unresolved_stdio_rows: number;
  };
}

// ── Fetcher signature ────────────────────────────────────────────────────────

export type IngestFetcher = () => Promise<IngestServer[]>;
