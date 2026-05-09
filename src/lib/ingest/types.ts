/**
 * Relay — Ingest Types v2
 *
 * Shared type definitions for the ingest pipeline.
 * Every upstream source normalizes into IngestServer before upsert.
 *
 * Design decisions:
 *   - Fields that are unknown are null, never defaulted to fake values
 *   - Transport is a strict enum, detected from upstream contract not URL guessing
 *   - endpoint is null for stdio servers (they cannot be cloud-proxied)
 *   - version is null for Smithery/Glama/mcp.directory (they don't version)
 *   - use_count / popularity signals go to the analytics table, NOT here
 *   - Glama and mcp.directory are enrichment sources: they never provide endpoints
 *
 * Field grades (A = critical for search_tools/invoke_tool, F = analytics only):
 *   A: name, display_name, description, transport, endpoint (HTTP), package_info (stdio),
 *      tool_schemas (inputSchema+description), env_var_schema
 *   B: tags, title, verified, github_url (stdio), env_var_schema
 *   C: resources, prompts, long_description, license, github_url (HTTP)
 *   D: icon_url, homepage_url, version
 *   F: use_count, stars, downloads (→ analytics table only)
 */

// ── Valid upstream sources ────────────────────────────────────────────────────

export type IngestSource =
  | 'official'       // Primary: registry.modelcontextprotocol.io
  | 'smithery'       // Primary: registry.smithery.ai
  | 'glama'          // Enrichment only: glama.ai
  | 'mcp_directory'  // Enrichment only: mcp.directory
  | 'direct';        // Servers submitted directly to this registry

// ── Transport enum ───────────────────────────────────────────────────────────

export type Transport = 'stdio' | 'sse' | 'streamable_http' | 'unknown';

/**
 * Tracks how tool_schemas was populated for this server.
 * Used for quality grading and retry logic.
 */
export type ToolExtractionSource =
  | 'smithery_detail'   // Full inputSchema from Smithery GET /servers/{id}
  | 'mcp_probe'         // Live MCP handshake to a running HTTP/SSE endpoint
  | 'sandbox'           // Sandboxed local execution of a stdio package
  | 'upstream_schemas'  // Schemas provided directly by the upstream API
  | 'upstream_names'    // Only tool names available (no inputSchema)
  | 'readme_parsed'     // Parsed from README markdown (low confidence, stdio fallback)
  | 'none';             // No tool data from any source

export type IngestMode = 'catalog' | 'full';


// ── Capability sub-types ─────────────────────────────────────────────────────

export interface ToolSchema {
  /** Tool name — must match [a-zA-Z0-9_-]+ per MCP spec */
  name:         string;
  /** Description — Grade A for search_tools intent matching */
  description?: string;
  /** JSON Schema for tool arguments — Grade A for invoke_tool validation */
  inputSchema?: Record<string, unknown>;
}

export interface McpResource {
  uri:          string;
  name:         string;
  description?: string;
  mimeType?:    string;
}

export interface McpPrompt {
  name:         string;
  description?: string;
  arguments?:   Array<{ name: string; description?: string; required?: boolean }>;
}

/**
 * Normalized environment variable specification. Grade A for invoke.
 *
 * Normalized from:
 *   Official:       packages[].environmentVariables[]
 *   Smithery:       connections[].configSchema.properties
 *   Glama:          environmentVariablesJsonSchema.properties
 */
export interface EnvVarSpec {
  name:          string;
  description?:  string;
  isRequired:    boolean;
  isSecret:      boolean;
  defaultValue?: string;
  format?:       'string' | 'number' | 'boolean' | 'filepath';
  placeholder?:  string;
  choices?:      string[];
}

/**
 * Package install specification. Grade A for stdio invoke.
 * Only the Official registry provides this data.
 */
export interface PackageInfo {
  /** npm | pypi | oci | nuget | mcpb */
  registryType:     string;
  registryBaseUrl?: string;
  /** e.g. '@modelcontextprotocol/server-filesystem' */
  identifier:       string;
  version?:         string;
  /** npx | uvx | docker | dnx */
  runtimeHint?:     string;
  fileSha256?:      string;
  transport:        Transport;
}

// ── Normalized server record ─────────────────────────────────────────────────

export interface IngestServer {
  // ── Identity — Grade A ────────────────────────────────────────────────────

  /** Slugified name (lowercase, hyphen-separated) — DB primary key */
  name:         string;
  /** Human-readable display name */
  display_name: string;
  /** Short description — core search_tools corpus */
  description:  string;
  /** Transport type — determines HTTP proxy vs CLI companion routing */
  transport:    Transport;

  // ── Identity — Grade B–C ──────────────────────────────────────────────────

  /** Short title from Official registry — high-value for exact name search */
  title?:               string | null;
  /** Longer description from README or upstream */
  long_description?:    string | null;
  description_quality?: 'upstream' | 'readme_parsed' | 'auto_generated';

  // ── Connection — Grade A (HTTP/SSE); null for stdio ───────────────────────

  /**
   * Live HTTP endpoint URL for remote invocation.
   * null for stdio servers — they cannot be cloud-proxied.
   * Sources: Official remotes[].url, Smithery deploymentUrl.
   * Glama and mcp.directory NEVER provide this.
   */
  endpoint: string | null;

  // ── Versioning — Grade D ──────────────────────────────────────────────────

  /**
   * Semver version string. null for Smithery/Glama/mcp.directory
   * (they don't version their listings).
   */
  version: string | null;

  // ── Tool Capabilities — Grade A ───────────────────────────────────────────

  /** Tool names for full-text search index */
  tools:        string[];
  /** Full tool schemas: name + description (search) + inputSchema (invoke) */
  tool_schemas: ToolSchema[];
  /** How tool_schemas was populated — used for grading and retry */
  tool_extraction_source?: ToolExtractionSource;
  /** MCP Resources — Grade C */
  resources?:   McpResource[];
  /** MCP Prompts — Grade C */
  prompts?:     McpPrompt[];

  // ── Config — Grade A ─────────────────────────────────────────────────────

  /**
   * Environment variable requirements — Grade A for both HTTP and stdio invoke.
   * Sources: Official packages[].environmentVariables[], Smithery configSchema,
   *          Glama environmentVariablesJsonSchema.
   */
  env_var_schema?: EnvVarSpec[] | null;

  /**
   * Package install specs — Grade A for stdio invoke.
   * Source: Official registry packages[] only. Never available from Smithery/Glama.
   */
  package_info?: PackageInfo[] | null;

  // ── URLs — Grade B–D ─────────────────────────────────────────────────────

  /** GitHub repository URL — Grade B for stdio (CLI install), Grade D for HTTP */
  github_url?:   string | null;
  /** Homepage / documentation URL — Grade D */
  homepage_url?: string | null;
  /** Server logo — Grade D, UI only */
  icon_url?:     string | null;
  /** URL to the raw README file — Grade D */
  readme_url?:   string | null;

  // ── Classification — Grade B–D ────────────────────────────────────────────

  /** SPDX license string — null if unknown, never defaulted. Source: Glama only */
  license: string | null;
  /** Category tags for search. Sources: Glama attributes[], mcp.directory classification */
  tags:    string[];
  /** Trust tier for proxy routing. Meaning differs by source — see docs/ingest/README.md */
  verified?: boolean;

  // ── Provenance ────────────────────────────────────────────────────────────

  source:             IngestSource;
  source_id?:         string | null;
  smithery_id?:       string | null;
  official_id?:       string | null;
  glama_id?:          string | null;
  mcp_directory_id?:  string | null;
  upstream_updated_at?: string | null;

  /**
   * True when Smithery itself built and hosts this server (bySmithery: true in listing API).
   * These are Smithery's own curated integrations (Gmail, GitHub, Google Sheets, etc.).
   * Used to set is_canonical = true in the DB for superior search ranking.
   */
  by_smithery?:       boolean;

  /**
   * Real-world usage count from Smithery listing API (useCount field).
   * Grade B signal for trust scoring — proxy for "this actually works and is used."
   * Only populated for source = 'smithery'.
   */
  use_count?:         number | null;

  // ── Raw upstream (→ server_connection_profiles side table) ────────────────

  raw_upstream_json?: Record<string, unknown> | null;
  /** Official remotes[] — auth header specs for vault injection */
  remotes?:           unknown[] | null;
  /** Official packages[] — kept verbatim for CLI companion */
  packages?:          unknown[] | null;
  /** Official icons[] */
  icons?:             unknown[] | null;
  official_meta?:     Record<string, unknown> | null;
  publisher_meta?:    Record<string, unknown> | null;
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
    smithery_detail_fetched:  number;
    smithery_detail_success:  number;
    smithery_rate_limited:    number;
    probe_attempts:           number;
    probe_success:            number;
    sandbox_attempts:         number;
    sandbox_success:          number;
    /** Servers with all Grade-A fields populated */
    grade_a_complete:         number;
    /** Servers with all Grade-A + Grade-B fields populated */
    grade_b_complete:         number;
  };
}

// ── Fetcher signature ────────────────────────────────────────────────────────

export type IngestFetcher = () => Promise<IngestServer[]>;
