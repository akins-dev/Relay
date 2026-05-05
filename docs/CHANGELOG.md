# Relay Changelog

This file is append-only.

## 2026-04-23

### Added

- Introduced `docs/TECHNICAL_BACKBONE.md` as the canonical technical reference for the project.
- Introduced `docs/DECISION_LOG.md` as the append-only architecture decision record.
- Introduced `docs/CHANGELOG.md` as the append-only project evolution log.
- Introduced `docs/README.md` as the documentation index and update contract.

### Documented

- Classified infrastructure into canonical systems of record vs disposable accelerators.
- Defined migration and preservation rules for Postgres, Vault, Redis, Vercel, sandbox workers, and cron executors.
- Mapped the ingest pipeline from source fetch to normalization, extraction, scanning, trust scoring, and upsert.
- Documented the semantics of the `servers` table and the analytics tables that form the product learning loop.
- Recorded the current competitor landscape and where Relay overlaps most directly.

### Observed Implementation Drift

- Endpoint deduplication is intended in ingest but currently ineffective because the endpoint field is not prefetched.
- Ingest source contracts are drifting: route schemas expose sources that `runIngest()` does not fully execute.
- `search_servers(...)` SQL contracts have drifted across migrations relative to runtime expectations.
- Transport recording is still partly heuristic even after successful MCP probe.
- GitHub `stdio` sandbox execution is weak, so README fallback currently carries more weight than intended.

### Policy Going Forward

- Architecture or roadmap changes should update `TECHNICAL_BACKBONE.md`, `DECISION_LOG.md`, and `CHANGELOG.md` together.

## 2026-04-25

### Updated

- Reframed the main narrative docs around a more explicit `Problem` and `Vision` structure.
- Clarified that Relay complements RAG, LangChain, and LangGraph rather than competing with them.
- Normalized the likely MVP public URL in Markdown examples to `https://relay.vercel.app`.
- Removed stale naming drift such as `Agentrail` and `openMCP` from the Markdown docs that were updated.

### Normalized

- Replaced hard-coded numbered security-layer phrasing in key narrative docs with count-neutral `security stack` wording where the repo had drift.
- Aligned roadmap ownership and footer metadata in narrative docs with the current Relay project identity.

## 2026-05-02

### Hardened

- Fixed partner/vendor ingest pagination so the GitHub org source no longer truncates at the first 100 repositories.
- Added `tool_extraction_source` to persist whether tool metadata came from upstream schemas, upstream names, live MCP probe, sandbox extraction, README fallback, or nowhere.
- Moved the public server analytics route toward aggregate views by adding `server_tool_usage_30d` and consuming aggregate audit views instead of reconstructing everything from raw audit rows in application code.
- Added ingest provenance quality views and admin/release visibility for weak `stdio` rows and servers with no persisted tool metadata.

## 2026-05-05

### Architecture: Migration 032 — Behavioral Trust & Dynamic Diversity

**Trust score formula replaced (security.ts + compute_trust_score_v2 SQL):**
- Removed Smithery `use_count` from trust score computation. It was source-biased: servers from any other source (Glama, official, direct) automatically scored 15 pts lower with no quality basis.
- New behavioral reliability slot (15 pts): Bayesian-smoothed success rate from `intent_server_mappings`. Formula: `(success_count + 3) / (invoke_count + 4) × log10(invoke_count + 5) × 15`, capped at 15. Beta(3,1) prior gives cold-start servers ~8 pts ("unproven") instead of 0 ("broken").
- `use_count` (Smithery) retained as a search ranking tiebreaker only — not removed from schema.
- `usageCount` and `stars` params kept in TypeScript as `@deprecated` fallback for backward compatibility.

**Ingest pipeline hardened (pipeline.ts + api/servers/route.ts):**
- All code paths (automated ingest, manual POST submission) now pass `invokeCount: 0, successCount: 0` at ingest time. Bayesian prior handles cold-start consistently.
- No synthetic `stars` or `daysSinceChange` overrides remain. Scores are fully data-driven from day one.

**Uptime cron hardened (cron/uptime.ts):**
- Cron now performs a two-step batch fetch: first gets ISM data for all active server names, then recomputes trust scores using real `invokeCount`/`successCount`. No redundant DB writes.

**search_servers() SQL rewritten (032 migration):**
- Old `category_counts` CTE scanned the entire `servers` table for `trust_score >= 85`. When scores clustered below 85 (inevitable with the new formula), the diversity logic silently died.
- New: `category_counts` and `result_median` scan only the current query’s result set. Diversity penalty (8% soft reduction) applies to over-represented tags that score below the result-set median. Always fires. Never uses a hardcoded absolute threshold.
- Added `idx_ism_server_reliability` covering index and `get_server_behavioral_reliability()` helper function.
- Added `invoke_count` to the search result set so consumers can distinguish "new & clean" from "aged & proven."

**UI thresholds aligned across all components:**
- SearchSpotlight.tsx, admin/page.tsx, dashboard/page.tsx, registry/[name]/page.tsx: amber badge now at `>= 65` (was `>= 70`) to reflect realistic score distribution under the new model.

**Documentation updated:**
- SECURITY.md: trust score table corrected (was showing completely wrong weights).
- ARCHITECTURE_SYSTEM_MAP.md: Section 14 (uptime cron), Section 11 (ingest), Section 6 (search) updated.
- TECHNICAL_BACKBONE.md: Section 9.11 (trust init), Section 7.1 (inbound sources), Section 13 (obstacles) updated.
- docs/ingest/README.md: new comprehensive architecture doc for the behavioral trust lifecycle.
- DECISION_LOG.md: ADR-008 added.
