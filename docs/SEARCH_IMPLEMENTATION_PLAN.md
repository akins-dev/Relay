# Search & Intent Implementation Plan

Last updated: 2026-06-08  
Status: Active execution plan for search quality, benchmarks, and launch readiness

Parent docs: `SEARCH_PIPELINE.md`, `DELIVERY_ROADMAP.md`, `RUNTIME_INVOKE_ARCHITECTURE.md`.

---

## Principles

1. **Measure before optimizing** — baseline Server-P@1 on `benchmark/intents.jsonl` before hybrid or ML.
2. **Lexical foundation first** — FTS + tool RRF + manifest boosts; embeddings are layer 2.
3. **One `runSearch` path** — REST/MCP/cache parity tests guard regressions.
4. **MVP vs deferred** — ship runnable discovery; document deferred features explicitly.

---

## Phase A — Measurement foundation (current)

**Goal:** Repeatable precision metrics and CI-safe unit tests.

| Task | Status | Owner surface |
|------|--------|---------------|
| `benchmark/intents.jsonl` golden set | Done | benchmark/ |
| `src/benchmark/score.ts` pure scorer | Done | src/benchmark/ |
| `src/lib/intent-classifier.ts` extracted | Done | MCP route |
| `npm run test:benchmark` | Done | package.json |
| `npm run benchmark:eval` live eval | Done | src/scripts/ |
| Document metrics in `SEARCH_PIPELINE.md` | Done | docs/ |

**Exit criteria**

- `npm run test:benchmark` passes in CI without Supabase.
- Live eval produces `benchmark/reports/latest.md`.
- Team agrees on Server-P@1 baseline number for catalog ingest state.

---

## Phase B — Search relevance hardening (Sprint 2)

**Goal:** Top results are plausible and often runnable for action intents.

| Task | Priority | Notes |
|------|----------|-------|
| Apply migrations through `051` on all environments | P0 | `051` is the current bounded unified-search hot path |
| Named-provider preference in `search_servers` | P0 | Explicit provider intents should prefer exact provider servers over community wrappers |
| Package-backed stdio boost for action intents | P1 | When `websearch_to_tsquery` matches action verbs |
| REST/MCP/cache parity tests | P0 | Same shape and tool trim on hit vs miss |
| Reduce stale `proxy_available` in public payloads | P2 | Prefer `manifest.run_mode` |
| Re-run benchmark; record P@1/P@3 in report | P0 | Commit `latest.md` when ranking changes |

**Exit criteria (from MVP gate)**

- Server-P@3 acceptable on benchmark (team-defined threshold, e.g. ≥70% on `lexical_easy`).
- Runnable-P@1 improves for `requires_runnable` cases after manifest ranking.
- Search RPC mismatch returns `SEARCH_RPC_CONTRACT_ERROR`; statement timeouts require inspecting the latest migration and candidate-lane bounds.

---

## Phase C — Manifest & invoke proof (Sprint 3–4)

**Goal:** Discovery output is invokable without guesswork.

| Task | Priority |
|------|----------|
| Manifest unit tests (npm, pypi, remote, discovery_only) | P0 |
| E2E: `relay search` → `relay invoke` on one package-backed server | P0 |
| CLI outcome reporting → `intent_server_mappings` | P1 |
| `cli/smoke-test-e2e.mjs` in CI (optional live URL) | P2 |

**Exit criteria**

- At least one real package-backed stdio invoke documented in `TESTING_GUIDE.md`.
- Invoke outcomes flow when `RELAY_API_KEY` is set.

---

## Phase D — Public testing & launch (Sprint 5)

**Goal:** External agents can discover and test Relay safely.

See `LAUNCH_AND_PUBLIC_TESTING.md` for deploy checklist.

| Task | Priority |
|------|----------|
| Publish `@relay/cli` to npm | P0 |
| Production Supabase + weekly ingest | P0 |
| API keys + rate limits documented | P0 |
| Public benchmark report (sanitized) | P1 |
| Admin: top intents + ecosystem gaps | P1 |

**Exit criteria**

- `npx -y @relay/cli search "..."` works against production URL.
- MCP `/api/mcp-server` listed in agent docs.
- Known limitations published (cold stdio, no cloud invoke).

---

## Phase E — Hybrid semantic search (Sprint 6, deferred)

**Goal:** +15% Server-P@1 on conversational stratum vs FTS baseline.

| Task | Notes |
|------|-------|
| Enable pgvector | Supabase extension |
| Embedding column on `servers` | Ingest-time generation |
| `search_servers_hybrid()` | FTS + vector RRF |
| Re-run full benchmark | Compare to Phase A baseline |

**Not started in MVP** — do not block launch.

---

## Phase F — Learned routing (post-MVP)

Requires volume in `intent_server_mappings` and `invoke_outcomes`.

- Small classifier for intent → (server, tool) on high-confidence buckets
- Speculative invoke only when Runnable-P@1 and historical success rate exceed thresholds
- Document in `TECHNICAL_BACKBONE.md` § 3.4

---

## Test matrix

| Layer | Command | Needs DB |
|-------|---------|----------|
| Scorer unit | `npm run test:benchmark` | No |
| Search analytics unit | `npm test -- search-quality` | No |
| HTTP integration | `npm test -- integration` | No (mocked) |
| Live benchmark | `npm run benchmark:eval` | Yes |
| CLI e2e | `cli/smoke-test-e2e.mjs` | Live URL |

---

## Risk register

| Risk | Mitigation |
|------|------------|
| Migration `040` not applied | Ledger + health check `ensureSearchContracts` |
| Empty catalog → 0% P@1 | Ingest gate before eval; use unit benchmark tests in CI |
| Conversational intents fail FTS | Stratum tagged; Sprint 6 hybrid |
| Stale docs promise cloud invoke | `CHANGELOG` + article updates |
