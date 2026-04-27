/**
 * Relay — Ingest Module
 *
 * Barrel export for the modularised ingestion pipeline.
 *
 * Architecture (post-refactor):
 *   types.ts         — shared IngestServer, IngestResult, Transport types
 *   helpers.ts       — slugify, detectTransport, README parsing, GitHub helpers
 *   official.ts      — Official MCP Registry fetcher (OpenAPI-first)
 *   smithery.ts      — Smithery fetcher (API-first)
 *   glama.ts         — Glama fetcher (API-first)
 *   github.ts        — GitHub reference servers fetcher
 *   vendor.ts        — Vendor/partner org fetcher
 *   pipeline.ts      — upsert pipeline (dedup, probe, scan, trust score, DB write)
 *   legacy-bridge.ts — bridges to old ingest.ts functions during migration
 *
 * Dead sources removed:
 *   - PulseMCP (returns 403)
 *   - ClaudeMCP (fragile __NEXT_DATA__ scraping)
 *   - MCP.so (speculative guessed API)
 *   - MCP.run (speculative guessed API)
 *   - Composio (not an MCP registry — returns generic app metadata)
 */

// ── Types ────────────────────────────────────────────────────────────────────
export type {
  IngestServer,
  IngestResult,
  IngestSource,
  Transport,
  ToolSchema,
  IngestFetcher,
} from './types';

// ── Fetchers ─────────────────────────────────────────────────────────────────
export { fetchOfficialServers }  from './official';
export { fetchSmitheryServers }  from './smithery';
export { fetchGlamaServers }     from './glama';
export { fetchGitHubServers }    from './github';
export { fetchVendorServers }    from './vendor';

// ── Pipeline ─────────────────────────────────────────────────────────────────
export { upsertServers }         from './pipeline';

// ── Helpers ──────────────────────────────────────────────────────────────────
export { slugify, detectTransport, parseReadmeSchemas } from './helpers';

// ── Legacy bridge (temporary — will be removed as migration completes) ──────
export { fetchMCPPrimitives, buildSandboxCommand } from './legacy-bridge';
