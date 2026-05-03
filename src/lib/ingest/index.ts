/**
 * Relay — Ingest Module
 *
 * Barrel export for the modularised ingestion pipeline.
 *
 * Architecture:
 *   types.ts          — IngestServer v2, EnvVarSpec, PackageInfo, McpResource, McpPrompt
 *   helpers.ts        — slugify, detectTransport, README parsing
 *   official.ts       — PRIMARY: Official MCP Registry (endpoints + package_info + env_vars)
 *   smithery.ts       — PRIMARY: Smithery (endpoints + full tool schemas via detail API)
 *   glama.ts          — ENRICHMENT: Glama (license, env_var_schema, tags, github_url)
 *   mcp_directory.ts  — ENRICHMENT: mcp.directory (verified, icon_url, transport hint)
 *   vendor.ts         — Partner/vendor org fetcher
 *   pipeline.ts       — Upsert pipeline (dedup, enrichment pass, probe, DB write)
 *   legacy-bridge.ts  — Bridges to old ingest.ts functions during migration
 *
 * Removed sources:
 *   - github.ts       — GitHub has no standard MCP server listing API
 *   - PulseMCP        — Returns 403
 *   - ClaudeMCP       — Fragile __NEXT_DATA__ scraping
 *   - mcp.so          — No JSON API (web-only)
 *   - mcpservers.org  — No API (static curated list)
 */

// ── Types ─────────────────────────────────────────────────────────────────────
export type {
  IngestServer,
  IngestResult,
  IngestSource,
  Transport,
  ToolSchema,
  McpResource,
  McpPrompt,
  EnvVarSpec,
  PackageInfo,
  ToolExtractionSource,
  IngestFetcher,
} from './types';

// ── Fetchers — Primary (provide endpoints + tool schemas) ─────────────────────
export { fetchOfficialServers }       from './official';
export { fetchSmitheryServers }       from './smithery';

// ── Fetchers — Enrichment (enrich via github_url cross-reference) ─────────────
export { fetchGlamaServers }          from './glama';
export { fetchMcpDirectoryServers }   from './mcp_directory';

// ── Other fetchers ────────────────────────────────────────────────────────────
export { fetchVendorServers }         from './vendor';

// ── Pipeline ──────────────────────────────────────────────────────────────────
export { upsertServers }              from './pipeline';

// ── Helpers ───────────────────────────────────────────────────────────────────
export {
  slugify,
  detectTransport,
  parseReadmeSchemas,
  parseReadmeDescription,
} from './helpers';

// ── Smithery helpers (exported for tests) ─────────────────────────────────────
export { resolveSmitheryTransport }   from './smithery';

// ── Legacy bridge (temporary — will be removed as migration completes) ────────
export { fetchMCPPrimitives, buildSandboxCommand } from './legacy-bridge';
