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
