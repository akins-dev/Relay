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
