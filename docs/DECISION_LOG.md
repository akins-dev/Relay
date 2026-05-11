# Relay Decision Log

This file is append-only.

Format:

- decision id
- date
- status
- decision
- rationale
- consequences

## ADR-001

Date: 2026-04-23
Status: accepted

Decision:

Postgres is the canonical system of record for Relay. Redis is cache-only and limiter-only.

Rationale:

- free-tier cache state is disposable
- business-critical analytics and registry state must survive vendor migration
- long-term moat data lives in `search_events`, `invoke_outcomes`, and `intent_server_mappings`

Consequences:

- no durable product state should be introduced in Redis
- any future performance cache must be reconstructible from Postgres or upstream sources

## ADR-002

Date: 2026-04-23
Status: accepted

Decision:

`transport` and `proxy_available` remain separate fields.

Rationale:

- `stdio` servers are important for discovery even when Relay cloud cannot invoke them
- invocability is a product capability decision, not just a transport property

Consequences:

- search and UI can show `stdio` rows without falsely implying remote execution
- future CLI/container bridges can enable new invocation modes without changing canonical source rows

## ADR-003

Date: 2026-04-23
Status: accepted

Decision:

The ingest pipeline uses a three-tier skip model: timestamp skip, hash skip, then full processing.

Rationale:

- most upstream rows do not materially change every run
- skipping aggressively is required for cost and cron runtime control

Consequences:

- `upstream_updated_at`, `schema_hash`, and `last_scanned_at` are critical ingest fields
- any new source should supply a usable upstream change signal whenever possible

## ADR-004

Date: 2026-04-23
Status: accepted

Decision:

Secrets and OAuth tokens must remain vault-backed and never be stored in app tables as plaintext.

Rationale:

- credential injection is a central trust promise of the product
- plaintext storage or logging would break the model entirely

Consequences:

- vault logging safeguards are operationally critical
- new auth flows must integrate through service-role RPCs and vault-backed storage

## ADR-005

Date: 2026-04-23
Status: accepted

Decision:

The MVP priority is ingest correctness before expanding surface area.

Rationale:

- search, trust scoring, and proxy behavior all depend on canonical registry quality
- registry duplication, transport ambiguity, and weak stdio extraction create downstream errors

Consequences:

- source contract drift and dedup defects should be fixed before major new product expansion
- new features should not outrun registry correctness

## ADR-006

Date: 2026-04-25
Status: accepted

Decision:

Narrative docs should present Relay first through a consistent "Problem" and "Vision" structure, and should explicitly position Relay as complementary to RAG and orchestration frameworks rather than competing with them.

Rationale:

- the clearest product story starts with the practical MCP configuration ceiling
- Relay is runtime infrastructure, not a replacement for reasoning, retrieval, or orchestration layers
- external messaging becomes weaker when this comparison is left implicit or scattered

Consequences:

- the README and major narrative docs should foreground the practical MCP cap before feature detail
- docs should explain how Relay fits alongside RAG, LangChain, and LangGraph where that comparison helps
- future documentation updates should preserve this framing rather than drifting into feature-first prose

## ADR-007

Date: 2026-04-25
Status: accepted

Decision:

Markdown docs should avoid hard-coding a numbered security-layer count unless the implementation and product surfaces are aligned on the same count.

Rationale:

- the repository currently contains count drift between "14-layer" and "15-layer" wording
- mismatched numbers reduce trust faster than count-neutral wording

Consequences:

- narrative docs should prefer "security stack" or equivalent until the count is fully reconciled
- future count-specific wording should be introduced only after a deliberate implementation census

## ADR-008

Date: 2026-05-05
Status: accepted

Decision:

The "real-world usage" trust score slot (15 pts) is driven by Bayesian-smoothed behavioral reliability from `intent_server_mappings`, not Smithery `use_count`.

Rationale:

- `use_count` is sourced exclusively from Smithery's listing API. Every server from any other ingestion path (official registry, Glama, mcp.directory, direct submission) automatically receives 0 in this slot. That is a 15-point structural disadvantage that has no relationship to server quality.
- The actual question the slot should answer is: "When agents invoke this server through Relay, does it succeed?" That data lives in `intent_server_mappings` and should be populated by Relay invocation outcome reports regardless of which registry listed the server.
- A Beta(3,1) Bayesian prior (`adjusted_rate = (success_count + 3) / (invoke_count + 4)`) ensures cold-start servers receive a "plausibly good, unproven" floor (~8 pts, ~0.75 rate) rather than 0. The prior washes out at ~20+ invocations as real data dominates.

Consequences:

- The trust score formula is now fully source-agnostic. No ingestion source has a structural advantage.
- New servers score ~50–73 pts at ingest time depending on scan quality, verification, and deployment quality. This is lower than the old system for Smithery servers but more honest.
- Score grows automatically as agents use the server. No manual curation required.
- `use_count` is retained in the schema and search ordering as a popularity tiebreaker but carries no weight in trust computation.
- All UI badge thresholds updated: amber at ≥ 65 (was ≥ 70) to reflect the realistic new distribution.
- The DB-side `compute_trust_score_v2()` mirrors the TypeScript formula; both must stay synchronized. A critical bug was found and fixed: PostgreSQL `LOG(x)` is natural log, not log10. Correct syntax is `LOG(10, x)`.

## ADR-009

Date: 2026-05-09
Status: accepted

Decision:

Relay's MVP is runtime discovery plus Relay Local execution, not hosted cloud invocation.

Rationale:

- the product needs a working prototype before production-only hardening
- hosted execution, proxy security, sandboxing, Vault injection, OAuth, and cron maintenance kept expanding the scope
- much of the MCP ecosystem is local `stdio`, and executing arbitrary third-party processes in shared cloud infrastructure is not the right MVP boundary
- a local Relay runtime can execute with the user's local env and secrets without Relay Cloud hosting untrusted third-party processes
- CLI-capable agents and MCP-native agents need different entry points, but they should share one runtime implementation

Consequences:

- native MCP exposes `search_tools` and `get_server_manifest`, not `invoke_tool`
- Relay Cloud returns manifests and schemas
- Relay Local executes through either CLI commands or local MCP server mode
- local Relay MCP may expose `invoke_tool` because execution happens in Relay Local, not Relay Cloud
- `/api/proxy/*` is retired from the prototype runtime
- CLI/local MCP subprocess management becomes the next execution slice
- old proxy/security/trust ideas are deferred unless they directly improve discovery quality

## ADR-010

Date: 2026-05-09
Status: accepted

Decision:

Scheduled Vercel crons are not part of the prototype runtime. Manual/admin ingest remains available behind `CRON_SECRET`.

Rationale:

- the MVP should not depend on background jobs to become useful
- scheduled probe, drift, reset, sandbox, and CVE work makes the prototype harder to reason about
- Vercel cron header auth should not be trusted as a public authorization mechanism
- explicit ingest runs make data changes easier to inspect during prototype iteration

Consequences:

- `vercel.json` does not define scheduled jobs
- cron auth requires `Authorization: Bearer $CRON_SECRET`
- post-ingest processing jobs are retired by migration `037`
- any future background job must have an MVP consumer, owner, and retention story before it is added

## ADR-011

Date: 2026-05-11
Status: accepted

Decision:

Relay Local has one runtime with two agent-facing adapters: CLI commands and local MCP server mode.

Rationale:

- Relay is agent-centric; humans configure and debug it, but agents are the primary runtime consumers.
- MCP-native agents expect tools from an MCP server.
- CLI-capable agents, coding agents, scripts, and CI expect commands they can invoke.
- Building separate CLI and MCP execution stacks would duplicate security, manifest, process, policy, and audit logic.
- A single runtime lets Relay support different agent environments while preserving one invocation boundary.

Consequences:

- `relay invoke(...)` and local MCP `invoke_tool(...)` must call the same internal runtime function.
- `relay search` and local MCP `search_tools` must share search/manifest formatting semantics.
- `relay info` and local MCP `get_server_manifest` must return the same manifest contract.
- Cloud MCP remains discovery-only for the prototype and does not expose `invoke_tool`.
- Users configure Relay once per agent environment; they should not manually connect every downstream MCP server.
