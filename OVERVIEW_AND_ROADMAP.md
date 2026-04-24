# Relay — Overview & Roadmap

> *The agent-centric runtime layer for the practical MCP configuration ceiling.*
> Canonical technical reference: [`docs/TECHNICAL_BACKBONE.md`](docs/TECHNICAL_BACKBONE.md)

---

## What Relay Solves

Relay solves the practical MCP configuration ceiling.

The problem is not that MCP lacks servers. The problem is that usable capacity collapses once teams have to keep discovering, wiring, authenticating, exposing, and maintaining more and more servers by hand. Long before the ecosystem runs out of capability, humans and agents hit a sanity ceiling:

- too many servers to configure explicitly
- too many tools to expose cleanly
- too much auth and transport complexity to manage by hand
- too much model confusion once the surface gets large
- too many 1:1 integration projects for each new capability

Relay changes the model from explicit preload to runtime capability resolution.

```text
search_tools("send a transactional email with HTML body")
-> returns ranked, verified server/tool options with trimmed schemas

invoke_tool({ server: "sendgrid-mail", tool: "send_email", args: {...} })
-> executes through one guarded runtime path
```

The two-tool interface is the current implementation, not the thesis by itself. The thesis is that the model-facing surface should stay small while capability discovery, auth, trust, and execution happen at runtime.

The deeper differentiator is the learning loop. Relay is designed to record which server/tool combinations actually worked for which intents so routing gets better over time instead of staying static.

---

## What Exists Today

### Core runtime

- Native MCP server at `/api/mcp-server`
- `search_tools`: FTS + trigram retrieval across 20,000+ indexed servers with confidence scoring
- `invoke_tool`: direct execution through the security proxy
- Lever 3A knowledge classifier to deflect non-action queries before search
- Intent cache for frequent intent -> server mappings
- Schema trimming so each result surfaces the most relevant tools
- Historical confidence boosts from prior invoke outcomes
- SSE transport for legacy clients

### Registry and ingest

- Ingest from active sources including Official Registry, Smithery, Glama, PulseMCP, GitHub, verified organization feeds, ClaudeMCP, MCP.so, MCP.run, and Composio
- Canonical normalized `servers` rows in Postgres
- Three-tier ingest skip pipeline: timestamp -> hash -> full refresh
- Dedup, normalization, trust scoring, scan history, and schema snapshots
- `stdio` rows preserved even when not cloud-invocable yet

### Security and execution control

- 14-layer security stack across scan, invoke, auth, DLP, SSRF, and confirmation paths
- Schema drift detection with automatic suspension on post-approval mutation
- Re-scan on drift events
- Rate limiting and response-size guards
- Per-user, per-server, per-tool policy controls
- HMAC-signed confirmation flow for destructive actions

### Credentials and vault

- Supabase Vault / pgsodium-backed secret storage
- Automatic credential injection across known key-name variants
- Structured 401 responses that tell the agent what credential is missing
- OAuth connection flow in progress as part of the runtime credential layer

### Analytics and training data

- `search_events`: every search call
- `invoke_outcomes`: every invoke result
- `intent_server_mappings`: aggregated intent -> server -> tool outcomes
- Views for top intents, gaps, search quality, and server reliability

This is the training corpus for later learned routing. The current system already records the loop that future routing depends on.

---

## What Is Good Now Vs Not Yet Optimal

Relay is already a credible MVP because it keeps the agent interface small, centralizes runtime control, and measures the full search -> invoke -> learn loop.

The current gaps are real, and they are already mapped to the roadmap:

| Current gap | What improves it | Sprint |
|---|---|---|
| Search still returns result sets the model must interpret | speculative invocation on obvious single matches; learned routing for common intents | Sprint 4, Sprint 8+ |
| Confidence is heuristic + empirical aggregate, not learned routing | learned Lever 3B classifier and later learned routing | Sprint 6, Sprint 8+ |
| Schema trimming is lexical, not intent-model-aware | stronger reranking first, then adaptive tool surfacing once confidence is high enough | Sprint 6, Sprint 8+ |
| No speculative execution yet | high-confidence speculative invocation | Sprint 4 |
| No ephemeral tool materialization yet | adaptive or ephemeral tool surfacing on stable high-confidence paths | Sprint 8+ |
| No trained fast path for common intents yet | routing model trained on `intent_server_mappings` + `invoke_outcomes` | Sprint 8+ |

The important point is that these are not random feature ideas. They are the next steps on the same problem-solving path.

---

## Roadmap

### Sprint 3A — Ingest Hardening

- make cron trust recomputation consume the same persisted security findings ingest writes
- tighten endpoint/repo dedup and trusted-source overwrite rules
- improve transport truth so cron and search do not reason from stale heuristics
- replace weak GitHub `stdio` sandbox execution assumptions with a more reliable extraction strategy
- add ingest-quality metrics for extraction coverage, schema coverage, duplicate collisions, and bad-row rate
- clean up the migration/documentation drift around source labels, search RPC shape, and local setup
- add sandbox/backfill parity so every stdio extraction path derives commands the same way
- add explicit stdio extraction provenance fields so ranking can distinguish sandbox-derived vs README-derived vs upstream-provided metadata
- support source-provided launch manifests or publisher-declared execution commands for monorepo/subdirectory stdio servers
- improve GitHub URL parsing to handle branch names with slashes and reduce tree/blob ambiguity
- replace `last_scanned_at` as a schema-stability proxy with a real `last_schema_change_at` or equivalent stability metric
- add ingest observability for sandbox call attempts, sandbox success rate, README fallback rate, and unresolved stdio rows
- define stricter retention and ranking rules for weak stdio rows with no extracted tools so MVP discovery quality stays high
- harden sandbox execution policy further if new runners are introduced beyond `npx`

### Sprint 3 — Sampling Security + OAuth

- `sampling/createMessage` rate limit and audit logging
- OAuth token refresh and retry-once flow
- bearer-only auth hardening
- type regeneration after the current migration chain

### Sprint 4 — Performance + Streaming

- session pooling for repeated MCP handshakes
- stateless probe mode for compliant servers
- SSE streaming pass-through and `progress` handling
- speculative invocation for very high-confidence single matches
- prompt caching for warm knowledge on top servers

### Sprint 5 — CLI As Native MCP Server

- `@Relay/cli`
- `Relay search`, `Relay info`, `Relay login`
- `Relay serve` as a native stdio MCP server
- subprocess lifecycle manager for local stdio execution
- local DLP and policy enforcement for offline execution
- async audit sync back to the registry

This sprint closes the largest remaining practical gap in the ecosystem: many discovered servers are `stdio` and need a local runtime bridge.

### Sprint 6 — Intelligence + Publisher Program

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
- turn `search_tools` into the fallback path for novel, ambiguous, or low-confidence intents

This is the long-term fast path: common intents stop paying the full search cost while the same registry, policy, security, and auth systems remain underneath.

---

## Full Picture

Relay is one system with four tightly coupled layers:

1. Multi-source ingest builds a canonical registry from the fragmented MCP ecosystem.
2. Runtime search keeps the agent-facing interface small while still exposing that larger capability universe by intent.
3. Guarded invocation centralizes trust, security, auth, vault injection, and policy enforcement.
4. Analytics and training data turn real outcomes into better future routing.

That is the whole story. Security, vault, confidence scoring, training, stdio bridging, and future learned routing all matter because they make the same core promise real: agents should be able to discover and use capability at runtime without humans repeatedly rebuilding the integration surface by hand.

---

*Relay — MIT licensed — built by TheSeventeen*
*https://github.com/the-17/Relay*
