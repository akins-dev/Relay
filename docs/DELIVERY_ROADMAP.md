# Relay Delivery Roadmap

Last updated: 2026-05-22  
Status: Canonical sprint-by-sprint delivery plan

MVP model: **Relay Cloud** (discovery, manifests, search) + **Relay Local** (CLI + `relay serve` invoke).

Detailed search tasks: `SEARCH_IMPLEMENTATION_PLAN.md`. Pipeline reference: `SEARCH_PIPELINE.md`. Launch: `LAUNCH_AND_PUBLIC_TESTING.md`.

---

## Current delivery state

| Area | Status |
|------|--------|
| Catalog ingest | Active — manual `ingest:local`; automatic cron paused |
| Search pipeline | Active — `runSearch`, tool-level RRF, migrations `040`-`044` |
| Benchmark & metrics | **Phase A done** — `benchmark/`, `test:benchmark`, `benchmark:eval` |
| Relay Local CLI | Implemented — `cli/` package |
| Hybrid semantic search | Deferred — Sprint 6 |
| Hosted cloud invoke | Retired — out of scope |

---

## MVP gate (P0)

### Catalog

- Official + at least one community ingest succeeds
- Rows have names, tools/schemas, transport, provenance
- Primary-source ingest skips rows with no tools after extraction
- Package-backed stdio preserves package metadata

### Search

- Single `search_servers` contract; `SEARCH_RPC_CONTRACT_ERROR` on mismatch
- REST and MCP share `runSearch` (manifest + `next` on every result)
- Benchmark run documented (`benchmark/reports/latest.md`)
- Knowledge MCP intents → `no_tool_needed`

### Manifest & invoke

- `local_stdio` / `remote_mcp` / `discovery_only` deterministic
- `relay invoke` + `relay serve` + outcome reporting path documented

### Scope

- No `/api/proxy` execution; no Vercel cron on MVP path
- No scheduled GitHub Actions cron while storage/search quality are being stabilized
- `MIGRATION_LEDGER` current through `044`

---

## Sprint 0 — Scope lock ✅

Aligned docs to Cloud control plane + Local runtime. Removed cloud `invoke_tool` and proxy routes.

---

## Sprint 1 — Catalog ingest (in progress)

**Goal:** Enough reliable data for useful search.

- Default `catalog` ingest path; observable `ingest_runs`
- Package metadata over README guesses where possible

**Exit:** Manual ingest produces searchable rows; stdio rows can become `local_stdio`.

---

## Sprint 2 — Search relevance (in progress)

**Goal:** Intent → tool discovery feels sharp in demos.

### Phase A — Measurement ✅ (2026-05-22)

- `benchmark/intents.jsonl`
- `src/benchmark/score.ts` + `npm run test:benchmark`
- `npm run benchmark:eval` live scorer
- `docs/SEARCH_PIPELINE.md`, `SEARCH_IMPLEMENTATION_PLAN.md`

### Phase B — Ranking (next)

- [ ] Apply migration `040` on all DBs
- [ ] Manifest-aware SQL ranking
- [ ] REST/MCP/cache parity tests
- [ ] Baseline Server-P@1 recorded on production catalog

**Exit:** Top-3 acceptable on benchmark; runnable top hits for common action intents.

---

## Sprint 3 — Manifest hardening

**Goal:** `get_server_manifest` is the reliable invoke bridge.

- Manifest unit tests (npm, pypi, remote, discovery_only)
- Clear `discovery_only` reasons; env schema normalization

**Exit:** Agents can tell runnable vs remote vs catalog-only.

---

## Sprint 4 — Relay Local MVP ✅

Implemented `cli/`: `search`, `info`, `invoke`, `serve`, `bootstrap`.

**Remaining:** Documented E2E invoke against production Cloud URL.

---

## Sprint 5 — MVP review & public testing

**Goal:** Externally testable MVP.

- [ ] Publish `@relay/cli` to npm
- [ ] Production deploy + API keys
- [ ] `LAUNCH_AND_PUBLIC_TESTING.md` checklist complete
- [ ] Benchmark report committed after ingest stable
- [ ] CLI README for configuration

**Exit:** `npx -y @relay/cli search` works against public URL; limitations published.

---

## Sprint 6 — Hybrid semantic search (deferred)

**Goal:** +15% Server-P@1 on conversational stratum vs FTS baseline.

- pgvector + ingest embeddings + `search_servers_hybrid`
- Re-run benchmark; compare to Phase A baseline

**Exit:** Documented lift on `conversational` stratum in `benchmark/reports/`.

---

## Sprint 7+ — Learned routing (deferred)

- Classifier on `intent_server_mappings` volume
- Speculative invoke only at high confidence + Runnable-P@1
- Warm stdio pool (`relay serve --warm`)

See `TECHNICAL_BACKBONE.md` § 3.4.

---

## Deferred (explicit)

Hosted proxy, Vault injection, OAuth product, DLP/audit stack, sandbox/CVE gates, cloud stdio bridge, learned routing **before** benchmark baseline.
