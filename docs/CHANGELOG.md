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
