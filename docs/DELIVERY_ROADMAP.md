# Relay Delivery Roadmap

Last updated: 2026-04-25
Status: Canonical sprint-by-sprint delivery plan

This file is the single source of truth for Relay's sprint plan.

Other docs may summarize direction or mention sprint numbers when explaining trade-offs, but they should not carry independent detailed sprint lists. If sprint scope changes, update this file first.

## Current Delivery State

- Foundation work through Sprint 2 is complete.
- The current build already has the core search -> invoke -> learn loop in place.
- The active delivery path now centers on ingest hardening, runtime safety, stdio reachability, and the later learned-routing fast path.

## MVP Gate (Go / No-Go)

The MVP is launchable only when all P0 gates are green for two consecutive weekly reviews.

### P0 Gates

- Discovery trust
  - endpoint/repo dedup collision rate under 2%
  - bad-row rate under 1% per ingest source
  - transport classification coverage above 95% on active rows
  - weak stdio rows (no extracted tools and no launch manifest) below 10% of stdio inventory
- Search contract stability
  - one canonical `search_servers(query_text, result_limit, include_stdio)` runtime contract across all environments
  - `search_tools` response shape parity between cache-hit and cold-path responses
  - top-3 relevance above 85% on the fixed intent benchmark set
- Invocation reliability and safety
  - invoke success rate above 97% for proxy-eligible tools
  - p95 invoke latency under 2500 ms for non-streaming calls
  - 100% of blocked decisions include auditable reason and correlation context
  - auth-remediation responses are correct in at least 95% of sampled failures
- Learning loop integrity
  - `search_events` to `invoke_outcomes` linkage above 95%
  - 100% typed outcome taxonomy coverage in invoke recording
  - weekly benchmark evaluation report is generated and reviewed

### Weekly Review Inputs

- ingest quality dashboard (coverage, collisions, bad rows, stdio provenance)
- search quality benchmark report and schema contract checks
- invocation SLO report (success, latency, error taxonomy)
- security/audit completeness report

### Release Rule

- Green across all P0 gates for two consecutive runs: Go
- Any red P0 gate: No-Go until corrected and re-validated

## Completed Foundation

### Sprint 1 — Core Protocol Correctness

- MCP initialize handshake and JSON-RPC tool execution path
- resources and prompts proxy routes
- tools/list pagination handling
- ingestion and storage for tools, resources, and prompts
- `stdio` discovery with `proxy_available=false`
- redirect SSRF guard
- content-type sanitization

### Sprint 2 — Discovery And Security Hardening

- native MCP server surface
- CORS policy and preflight handling
- stronger IP and SSRF handling
- bearer-token-first auth across routes
- ingestion correctness fixes
- environment validation at boot

## Upcoming Sprints

### Sprint 3A — Ingest Hardening

- make cron trust recomputation consume the same persisted security findings ingest writes
- tighten endpoint and repo dedup plus trusted-source overwrite rules
- improve transport truth so cron and search do not reason from stale heuristics
- replace weak GitHub `stdio` sandbox assumptions with a more reliable extraction path
- add ingest-quality metrics for extraction coverage, schema coverage, duplicate collisions, and bad-row rate
- clean up migration and documentation drift around source labels, search RPC shape, and local setup
- add sandbox and backfill parity so all stdio extraction paths derive commands consistently
- add explicit stdio extraction provenance so ranking can distinguish sandbox-derived, README-derived, and upstream-provided metadata
- support source-provided launch manifests or publisher-declared execution commands for monorepo and subdirectory stdio servers
- improve GitHub URL parsing for branch names with slashes and tree/blob ambiguity
- replace `last_scanned_at` as a schema-stability proxy with a real schema-change signal
- add ingest observability for sandbox attempts, sandbox success, README fallback, and unresolved stdio rows
- define stricter retention and ranking rules for weak stdio rows with no extracted tools
- harden sandbox execution policy further if new runners are introduced beyond `npx`

### Sprint 3 — Sampling Security And OAuth

- `sampling/createMessage` rate limiting and audit logging
- OAuth token refresh with retry-once flow
- bearer-only auth hardening
- type regeneration after the current migration chain

### Sprint 4 — Performance And Streaming

- session pooling for repeated MCP handshakes
- stateless probe mode for compliant servers
- SSE streaming pass-through and `progress` handling
- speculative invocation for very high-confidence single matches
- prompt caching for warm knowledge on top servers

### Sprint 5 — CLI As Native MCP Server

- `@relay/cli`
- `relay search`, `relay info`, and `relay login`
- `relay serve` as a native stdio MCP server
- subprocess lifecycle manager for local stdio execution
- local DLP and policy enforcement for offline execution
- async audit sync back into the registry

This sprint closes the biggest current reachability gap: a large share of discovered MCP capability is `stdio` and needs a local runtime bridge.

### Sprint 6 — Intelligence And Publisher Program

- Lever 3B learned classifier replacing the current heuristic gate
- stronger behavioral trust signals from runtime outcomes
- hybrid retrieval reranker only if lexical misses justify it
- verified publisher pipeline
- TypeScript and Python SDKs
- schema registry and publisher tooling

### Sprint 7 — Cloud Stdio Bridge

- container-based stdio invocation for agents that cannot run the CLI
- per-request isolation
- scale-to-zero execution

### Sprint 8+ — Learned Routing Layer

- train a routing model on `search_events`, `invoke_outcomes`, and `intent_server_mappings`
- route common intents directly to `(server, tool, confidence)` without a search step
- surface tools adaptively when confidence is strong enough
- keep `search_tools` as the fallback path for novel, ambiguous, or low-confidence intents

## Roadmap Logic

The roadmap is not a list of disconnected features. It follows one progression:

1. Make discovery trustworthy.
2. Make invocation governed and fast.
3. Make `stdio` capability actually reachable.
4. Turn outcome data into learned routing.

That sequence is the product strategy. Everything else is support work around it.
