# Relay Search Pipeline

Last updated: 2026-06-08  
Status: Canonical reference for intent search, ranking, measurement, and the discovery→invoke loop

This document describes what Relay **has built** and what is **planned**. For sprint tasks see `SEARCH_IMPLEMENTATION_PLAN.md`. For going live see `LAUNCH_AND_PUBLIC_TESTING.md`.

---

## North star

Collapse three gaps so agents treat MCP tools as **already available**:

| Gap | Question | Relay answer |
|-----|----------|--------------|
| Discovery | Which server might do this? | `search_servers` + `runSearch()` |
| Selection | Which tools matter for this intent? | `server_tools` RRF + `trimSchemasToIntent` (max 3) |
| Invocation | Can it run now? | `buildRelayManifest` → Relay Local `invoke_tool` / `relay invoke` |

Cloud discovers; Local executes. See `RUNTIME_INVOKE_ARCHITECTURE.md`.

---

## End-to-end flow

```mermaid
flowchart TB
  subgraph index [Indexing]
    Ingest[ingest/pipeline.ts]
    Servers[(servers.search_vector)]
    Tools[(server_tools)]
    Docs[(server_search_docs)]
    Ingest --> Servers --> Tools
    Servers --> Docs
  end

  subgraph query [Query]
    Intent[intent string]
    Gate{MCP: knowledge?}
    Cache[L1 intent cache]
    RPC[search_servers]
    App[runSearch]
    Intent --> Gate
    Gate -->|yes| Skip[no_tool_needed]
    Gate -->|no| Cache --> RPC --> App
  end

  subgraph learn [Feedback]
    Invoke[Local invoke]
    Outcome[invoke_outcomes]
    ISM[intent_server_mappings]
    Invoke --> Outcome --> ISM
    ISM -.-> RPC
  end

  index --> query
  App --> Invoke
```

### Indexing (no embeddings in production yet)

- Ingest writes `servers` with tools, `tool_schemas`, package info, env schema, transport.
- Triggers maintain weighted `servers.search_vector` (migration `040` expands fields).
- `server_tools`: one FTS row per tool, synced from catalog.
- `server_search_docs`: one compact materialized row per active server, synced from `servers`, used by the production hot path.
- Constraint: Postgres FTS + `pg_trgm` only — no paid LLM or external vector DB at index time.

### Retrieval (`search_servers`)

Current production path after migrations `047`–`051`:

1. Build bounded candidate lanes over `server_search_docs`: strict FTS, loose FTS for longer queries, server-name trigram, and tool-name trigram.
2. Fuse lanes with relevance-gated **RRF**. A result only receives lane credit when that lane actually matched.
3. Apply bounded metadata boosts: exact named-provider match, trust, canonical flag, new-server decay, and intent history.
4. Avoid broad OR scans over long tool text on the request path. `server_tools` remains a derived support index/backcompat surface.

Named-provider rule: when the user explicitly names a provider/product and that token exactly matches a server name, that server gets a bounded preference. This is intentionally separate from generic relevance because agents and users often expect the official/named provider before community wrappers.

### Application layer (`src/lib/search.ts`)

Shared by MCP `search_tools`, REST `/api/servers/search`, and browse `?q=`:

1. L1 intent cache (validated rows only)
2. `search_servers` RPC
3. Wilson confidence (40% rank, 35% trust, 25% behavioral)
4. `trimSchemasToIntent` — TF-IDF, max 3 tools per server
5. `buildRelayManifest` + `next` hint

### Intent → tool mapping (no learned router yet)

| Layer | Mechanism |
|-------|-----------|
| Bucket | `hashIntent` — Porter stem + stopwords |
| Knowledge vs action | `src/lib/intent-classifier.ts` (MCP only) |
| Intent → server | FTS + RRF + behavioral boosts |
| Intent → tools shown | TF-IDF trim |
| Intent → tool invoked | Agent chooses; outcomes update ISM |

---

## Surfaces

| Surface | Classifier | Invoke |
|---------|------------|--------|
| Cloud MCP | Yes | No (`search_tools`, `get_server_manifest` only) |
| REST search | No | Hints only |
| `relay serve` | No | `invoke_tool` |
| `relay invoke` | No | Direct |

---

## Measurement

Golden set: `benchmark/intents.jsonl` against the live catalog.

| Metric | Definition |
|--------|------------|
| **Server-P@1 / P@3** | Labeled server in top 1 / 3 (substring name match) |
| **Tool-P@1** | Labeled tool in top server's trimmed tools |
| **Runnable-P@1** | Top `run_mode` ∈ `local_stdio`, `remote_mcp` |
| **Knowledge precision** | Knowledge intents deflected without search (MCP) |
| **Provider preference** | For explicit provider intents, the named/official provider should outrank generic or community wrappers unless a wrapper is clearly more actionable |
| **E2E success** | `invoke_outcomes.success` linked to `search_events` (operational) |

Run: `npm run test:benchmark` (unit) and `npm run benchmark:eval` (live DB).

Scoring code: `src/benchmark/score.ts`.

---

## Technology stack

| Layer | Production today |
|-------|------------------|
| Index | Postgres `tsvector` + `pg_trgm` |
| Hot-path index | `server_search_docs` |
| Support tool index | `server_tools` |
| Fusion | Bounded candidate lanes + relevance-gated RRF |
| Rerank | Exact provider match, trust, canonical, ISM, new-server decay |
| Post-process | Wilson confidence, TF-IDF trim |
| Cache | In-memory LRU by intent hash |
| Semantic | **Planned** Sprint 6 (pgvector hybrid) |

---

## Key files

| Path | Role |
|------|------|
| `src/lib/search.ts` | `runSearch()` |
| `src/lib/search-analytics.ts` | Hash, trim, confidence, events |
| `src/lib/intent-classifier.ts` | Knowledge gate |
| `src/lib/relay-manifest.ts` | `run_mode` / launch |
| `supabase/migrations/047_unified_search.sql` | Unified server search docs |
| `supabase/migrations/049_bounded_unified_search_provider_preference.sql` | Bounded lanes + provider preference |
| `supabase/migrations/050_short_generic_search_timeout_guard.sql` | Short generic query timeout guard |
| `supabase/migrations/051_restore_capability_verbs_in_search.sql` | Capability verb restoration after timeout guard |
| `benchmark/` | Golden intents + reports |
| `src/scripts/run-benchmark-eval.ts` | Live eval |

---

## Planned (not MVP blockers)

- Manifest-aware SQL ranking (`run_mode`, package concreteness)
- Hybrid FTS + pgvector (Sprint 6, +15% P@1 target)
- Learned fast path from `intent_server_mappings` (post-volume)
- Warm stdio pool (`relay serve --warm`)

See `SEARCH_IMPLEMENTATION_PLAN.md` for phased tasks.
