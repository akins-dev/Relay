# Relay Technical Backbone

Last updated: 2026-04-23
Status: Canonical living technical reference

## 1. Purpose

This document is the strict technical backbone for Relay.

It exists to answer, in one place:

- what problem Relay is solving
- what the system actually does today
- what data is canonical vs disposable
- how the ingest pipeline works in detail
- what each important field means
- what infrastructure is relied on and how we would migrate it without data loss
- what is heuristic vs deterministic vs empirical
- what the current MVP blockers, trade-offs, and next sprints are

## 2. Problem Statement

Relay is solving the practical MCP configuration ceiling.

The core problem is not merely that MCP servers are numerous. It is that usable MCP capacity is capped by explicit configuration and manual integration overhead. In practice, teams hit a sanity ceiling long before they run out of available servers.

The problem decomposes into:

- agents still depend on humans to discover, choose, wire in, and maintain MCP servers
- large tool surfaces create context pressure, token cost, and routing ambiguity
- many servers require credentials, OAuth, transport handling, and runtime safety controls that raw MCP does not solve
- much of the ecosystem is `stdio`-only, so discovery and invocation are not the same problem
- public directory data is noisy, duplicative, incomplete, or operationally uneven

Relay's thesis is that the winning system is not another directory page and not merely another gateway. It is an agent-centric runtime layer that:

- lets the agent discover capability by intent at runtime
- reduces the need for explicit pre-configuration
- keeps the model-facing interface deliberately small
- centralizes auth, trust, policy, and execution controls
- accumulates empirical outcome data so routing improves over time

## 3. Product Model

Relay is best understood as four coupled systems in service of one product goal: remove the practical MCP cap by moving capability resolution into the runtime loop.

1. A canonical registry builder.
2. An agent-facing search layer.
3. A guarded execution proxy.
4. An analytics layer that learns which server/tool combinations actually work.

The MVP-critical loop is:

1. ingest server metadata into a canonical registry
2. search by user intent
3. invoke through one guarded path
4. record the outcome
5. improve future ranking

Everything else is secondary to stabilizing that loop.

## 4. System Classification

### Deterministic Components

These are rule-based and should behave the same way for the same inputs:

- name normalization via `slugify()`
- transport classification via `detectTransport()`
- trust-score calculation via `computeTrustScore()`
- policy enforcement and confirmation token verification
- SSRF guard checks
- database upsert behavior
- ingest skip checks based on timestamps and hashes

### Heuristic Components

These are useful but imperfect and should be treated as approximation layers:

- README parsing for tool names and descriptions
- knowledge-vs-action classifier in MCP search
- regex-based DLP, shell-injection, prompt-injection, and PII scans
- Glama/Smithery/source transport inference
- confidence scoring and schema trimming
- description enrichment from README content

### Empirical / Data-Driven Components

These depend on accumulated usage data:

- `intent_server_mappings`
- `get_intent_boosts(...)`
- search reranking from historical success/failure

Important: there is no trained probabilistic routing model in production yet. The system is still lexical + heuristic + empirical aggregate boosts, not ML-routed.

## 5. Infrastructure Accountability Model

The project currently depends on multiple services, some of which may run on free tiers. To avoid long-term data loss, the architecture must distinguish canonical systems of record from disposable accelerators.

### 5.1 Canonical Systems Of Record

These hold irreplaceable or primary project state and must be fully exportable:

- Supabase Postgres
  Stores `servers`, analytics tables, ingest runs, scan history, policies, OAuth metadata, secrets metadata, and operational views.
- Supabase Vault / `vault.secrets`
  Stores actual user secret material and OAuth tokens via database RPCs.
- Git repository
  Stores application code, migration history, and documentation history.

### 5.2 Disposable / Reconstructible Infrastructure

These must never be treated as the only copy of important state:

- Upstash Redis
  Used for cache and distributed rate limit state. This data is disposable.
- Vercel runtime instances
  Ephemeral compute only.
- Render sandbox service
  Execution helper for `stdio` extraction. No canonical data should live here.
- GitHub Actions cron
  Scheduler/executor only, not a data store.
- Sentry
  Diagnostic telemetry, not canonical business state.

### 5.3 Migration Rule

Any data that cannot be regenerated from:

- Postgres
- Vault
- code + migrations
- or upstream sources

must not live exclusively in a free-tier dependency.

### 5.4 Current Infrastructure Map

| Component | Role | Canonical? | Failure Impact | Migration Strategy |
|---|---|---:|---|---|
| Supabase Postgres | primary application DB | Yes | high | pg dump / logical export / migration replay |
| Supabase Vault | secrets + OAuth tokens | Yes | high | vault export + controlled re-encryption plan |
| Upstash Redis | rate limit + cache | No | low/medium | cold rebuild from traffic |
| Vercel | app hosting | No | medium | redeploy elsewhere; DB remains authoritative |
| Render sandbox | stdio schema extraction | No | medium | redeploy worker elsewhere; re-run extraction/backfill |
| GitHub Actions | cron executor | No | medium | move jobs to another runner or queue worker |
| Sentry | error telemetry | No | low | optional vendor migration |

### 5.5 Accountability Requirements Going Forward

- Postgres is the canonical store for all business-critical state.
- Redis must remain cache-only and limiter-only.
- Any derived analytics that matter long term must be persisted in Postgres, not Redis.
- Any ingestion artifact that would be costly to recompute should be stored in Postgres.
- Secrets must only exist in Vault and never in logs, code, or free-tier cache.
- All infra vendors must have a defined export or rebuild path.

### 5.6 Immediate Preservation / Migration Checklist

- Keep the schema-first migration history in `supabase/migrations`.
- Back up Postgres on a schedule and periodically test restoration.
- Export analytics tables before any destructive schema refactor.
- Keep `vault` logging safeguards documented and enforced.
- Keep Redis usage strictly non-canonical.
- Keep ingest reproducible from upstream sources plus local normalization logic.

## 6. Data Preservation Strategy

### 6.1 Canonical Data Classes

| Data class | Canonical location | Recoverability |
|---|---|---|
| normalized server registry | `public.servers` | partially rebuildable, but local enrichments should be preserved |
| ingest history | `public.ingest_runs`, `public.cron_job_runs` | not practically reconstructible from raw sources |
| scan history | `public.scan_results`, `public.schema_snapshots` | not fully reconstructible |
| runtime usage analytics | `search_events`, `invoke_outcomes`, `intent_server_mappings`, `metering_events` | not reconstructible |
| user secrets metadata | `public.user_secrets` | not reconstructible without backup |
| user secrets values | Supabase Vault | not reconstructible without backup |
| OAuth state and tokens | DB + Vault | not reconstructible without backup |

### 6.2 Export Priorities

Priority 0:

- `servers`
- `user_secrets`
- vault contents
- OAuth connection tables

Priority 1:

- `search_events`
- `invoke_outcomes`
- `intent_server_mappings`
- `metering_events`
- `scan_results`
- `schema_snapshots`

Priority 2:

- `ingest_runs`
- `cron_job_runs`
- config tables

### 6.3 Recommended Retention Policy

- Keep `intent_server_mappings` indefinitely; this is the strategic training corpus.
- Keep `search_events` and `invoke_outcomes` long term, partitioned if volume grows.
- Keep `scan_results` and `schema_snapshots` long enough to support trust and forensic workflows.
- Keep `metering_events` long enough to compute meaningful reliability signals.

## 7. High-Level Architecture

### 7.1 Inbound Registry Sources

Current implemented or partially implemented upstream source fetchers:

- official MCP registry
- Smithery
- Glama
- GitHub `modelcontextprotocol/servers`
- vendor / partner GitHub org scan
- ClaudeMCP
- MCP.so
- MCP.run fetcher exists in code but is not wired into `runIngest()`
- Composio fetcher exists in code but is not wired into `runIngest()`
- PulseMCP fetcher intentionally returns empty because public API is unavailable

### 7.2 Runtime Surfaces

- `POST /api/ingest`
- `POST /api/admin/ingest`
- `GET /api/servers/search`
- `POST /api/proxy/{server}/{tool}`
- `POST|GET /api/mcp-server`

### 7.3 Core Database Responsibilities

- canonical normalized server rows
- search RPCs
- analytics event storage
- credential metadata
- vault-backed secret retrieval
- policy checks
- operational views

## 8. Canonical Data Model

### 8.1 `servers` Table

The `servers` table is the canonical normalized registry row.

Important fields:

| Field | Meaning | Notes |
|---|---|---|
| `name` | normalized unique slug | canonical row identity in app logic |
| `display_name` | human-facing name | may vary by source |
| `description` | short normalized description | often enriched from README |
| `long_description` | longer description excerpt | optional |
| `endpoint` | remote HTTP endpoint if any | empty or null for many `stdio` rows |
| `github_url` | source repo URL | also used for dedup and README/CVE enrichment |
| `homepage_url` | vendor/site link | optional |
| `tags` | categories/attributes | used by search fallback |
| `tools` | flattened tool name list | used in search and validation |
| `tool_schemas` | JSON schema-bearing tool descriptors | quality varies by extraction path |
| `resources` | MCP resources | added in migration 014 |
| `prompts` | MCP prompts | added in migration 014 |
| `transport` | `stdio`, `sse`, `streamable_http`, or `unknown` | transport classification is still partly heuristic |
| `proxy_available` | whether Relay cloud proxy can invoke it | intentionally separate from transport |
| `protocol_version` | MCP protocol version seen during probe | null when not probed |
| `mcp_compliant` | whether handshake/probe succeeded | best-effort flag |
| `source` | upstream provenance | used in weighting and overwrite protection |
| `smithery_id` / `official_id` / `glama_id` | upstream identity keys | dedup signals |
| `verified` | high-trust publisher or source flag | affects trust scoring |
| `status` | active lifecycle status | `pending_review` is also used in code even though initial enum/docs are older |
| `schema_hash` | upstream-change hash | used by skip logic and drift logic |
| `upstream_updated_at` | source-side last modified time | zero-cost skip signal |
| `last_scanned_at` | Relay ingest scan time | skip and ops signal |
| `trust_score` | composite quality score | deterministic formula, later runtime penalties |
| `scan_status` / `scan_issues` / `cve_issues` | security state | CVE-heavy today |
| `latency_ms` / `uptime_pct` | runtime health | updated outside ingest too |

### 8.2 Analytics Tables

These tables are strategically important:

- `search_events`
  Append-only record of search intent and returned servers.
- `invoke_outcomes`
  Append-only record of invocation outcomes.
- `intent_server_mappings`
  Aggregated `(intent, server, tool)` performance signal used to improve ranking.

These are not optional telemetry. They are the learning substrate.

### 8.3 Secret and Auth Tables

- `user_secrets`
  Metadata only. Actual secret values live in Vault.
- `server_credential_hints`
  Public metadata for credential setup guidance.
- OAuth metadata tables and RPCs
  Store provider URLs and encrypted tokens.

## 9. Ingest Pipeline: Exact Current Model

### 9.1 Purpose

The ingest pipeline converts heterogeneous upstream registry data into one normalized server registry.

### 9.2 Entry Points

- `POST /api/ingest`
- `POST /api/admin/ingest`
- `runIngest(source)`
- `upsertServers(servers, svc)`

### 9.3 Source Fetch Stage

Each source fetcher emits `IngestServer` objects with this conceptual shape:

- identity
- presentation metadata
- endpoint or repo link
- tools if upstream provides them
- source provenance
- optional transport hint
- optional upstream update timestamp

### 9.4 Normalization Stage

For each incoming record:

1. normalize the name with `slugify()`
2. reject if name is invalid
3. reject unsafe endpoints with SSRF guard
4. detect transport with `detectTransport()`
5. derive `proxyAvailable = transport !== 'stdio' && Boolean(endpoint)`
6. skip only if there is truly nothing storable for a `stdio` row

### 9.5 Existing Record Resolution

Current lookup order:

- `smithery_id`
- `official_id`
- `glama_id`
- normalized `github_url`
- normalized `endpoint`
- `name`

Important implementation issue:

- the prefetch query used to build `existingByEndpoint` does not currently select `endpoint`, so endpoint-based deduplication is intended but effectively broken in the current code path.

### 9.6 Three-Tier Skip Algorithm

The ingest pipeline uses a three-tier change-detection strategy:

Tier 1: upstream timestamp skip

- if `upstream_updated_at <= last_scanned_at`, skip immediately
- complexity: `O(1)`

Tier 2: schema hash skip

- hash is built from sorted tools, version, endpoint, github URL
- if hash matches `schema_hash` and last scan was within 24h, skip

Tier 3: full pipeline

- live probe, extraction, CVE scan, description enrichment, trust score, upsert

This is directionally correct for cost control.

### 9.7 Extraction Strategy By Transport

#### HTTP-capable rows

If `proxyAvailable` is true:

- call `fetchMCPPrimitives()`
- run MCP initialize handshake
- fetch tools/resources/prompts when supported
- if zero tools returned and a GitHub URL exists, fall back to README parsing

#### `stdio` rows

If transport is `stdio`:

- do not live-probe over HTTP
- if sandbox is configured and source data is sufficient, attempt sandbox extraction
- if sandbox yields nothing, fall back to README parsing

### 9.8 Current Extraction Buckets

Bucket A:

- HTTP probe via `probeMCPServer()`

Bucket B:

- sandbox extraction for `stdio`

Bucket C:

- README fallback

### 9.9 Security/Quality Stage

Current ingest-time security behavior is mostly:

- CVE scan by GitHub repo
- reject only when a critical CVE is found
- downgrade to `pending_review` when high severity CVEs exist

Static heuristic publish-time scanning exists in `scanServer()` but is not used in automated ingest by design, to avoid false positives.

### 9.10 Description Enrichment

If upstream description is missing or low quality:

- fetch README
- derive short description and `long_description`
- mark `description_quality`

### 9.11 Trust Score Initialization

Current ingest-time trust score uses:

- verified publisher signal
- assumed `uptimePct = 100`
- synthetic `stars = 50` and `daysSinceChange = 90` for official/partner rows
- scan score from CVE outcome

This is deterministic but intentionally optimistic for trusted sources on first ingest.

### 9.12 Upsert Stage

Behavior:

- update existing rows in place
- protect `official` / `partner` rows from lower-trust overwrites
- insert new rows with `upsert(... onConflict: 'name')`
- recover from some race conditions by re-reading winner row

## 10. Ingest MVP Deep Dive

The MVP focus should be the ingest pipeline because everything downstream assumes canonical server rows are trustworthy.

### 10.1 What Is Working Well

- multiple upstream source adapters already exist
- normalization model is mostly coherent
- `transport` and `proxy_available` are separated correctly in concept
- `stdio` rows are preserved instead of dropped
- MCP probe uses initialize handshake rather than naive `tools/list`
- skip algorithm is a good cost-control shape
- CVE scan dedup by repo is sensible
- description enrichment reduces empty rows

### 10.2 What Is Not Yet Optimal

#### A. Endpoint dedup is broken

Reason:

- prefetch query omits `endpoint`, but code expects it

Impact:

- identical HTTP servers from multiple registries can survive as duplicate rows under different names

#### B. Source contract drift exists

Current drift points:

- `/api/ingest` accepts `partner`, `mcp_run`, and `composio`
- `runIngest()` actually handles `vendor`, not `partner`
- `fetchMcpRunServers()` and `fetchComposioServers()` exist but are not wired into `runIngest()`

Impact:

- API surface and actual ingest behavior are misaligned

#### C. Search RPC schema drift exists

The latest visible migration `020_add_github_url_to_search.sql` defines a 2-arg `search_servers(query_text, result_limit)` signature and drops fields that runtime code expects in earlier migrations, such as:

- `transport`
- `auth_type`
- `auth_setup_url`
- `include_stdio`

Runtime code partially compensates by doing enrichment reads, but the SQL contract is not cleanly synchronized.

#### D. Successful MCP probe does not preserve real transport type

`probeMCPServer()` returns `transport: 'streamable_http'` on successful MCP handshake regardless of whether the original transport is truly SSE or modern streamable HTTP.

Impact:

- transport is still partly heuristic, not authoritative

#### E. GitHub stdio sandbox execution path is weak

For non-Smithery stdio rows, sandbox execution currently builds:

- `npx -y tsx <github_url>`

This is not a generally valid way to execute arbitrary GitHub-hosted MCP servers.

Practical consequence:

- README fallback is currently doing most of the real work for many stdio rows

#### F. README parsing is useful but noisy

Known limitations:

- can over-extract headings that are not real tools
- cannot infer full input schemas
- may parse root README instead of subdirectory README for monorepos
- may under-represent deeply nested official reference servers

#### G. CVE scan is approximate, not complete

Current method:

- fetch root `package.json`
- hit npm advisory bulk endpoint using dependency versions

Gaps:

- misses lockfile-resolved versions
- misses subdirectory/workspace packages
- misses non-node servers
- may misstate exploitability because it does not model runtime dependency graph

### 10.3 Edge Cases The Pipeline Must Handle

#### Identity and naming

- same server appears across multiple registries with different names
- same repo backs multiple server rows
- upstream names include slashes, namespaces, symbols, or unstable casing
- repo URL points to a monorepo subdirectory rather than the repo root

#### Transport ambiguity

- endpoint exists but is not an MCP endpoint
- HTTP endpoint exists but requires auth before listing tools
- source marks server as remote while actual usage is `stdio`
- server exposes SSE semantics but probe records it as `streamable_http`
- empty endpoint but non-empty repo URL implies `stdio`

#### Extraction ambiguity

- upstream provides `tools` but no schemas
- probe succeeds but returns zero tools
- sandbox unavailable
- sandbox available but cannot execute package
- README has no structured tool listing
- auth-required upstream blocks primitive extraction

#### Data quality

- empty descriptions
- placeholder descriptions
- tags with poor category value
- missing licenses
- missing or stale `upstream_updated_at`

#### Security and runtime quality

- upstream repo contains critical CVEs
- server endpoint fails SSRF guard
- repo has no `package.json`
- `stdio` server is stored but not remotely invocable

### 10.4 Recommended Field Semantics For MVP

For the MVP, these fields should be treated as authoritative:

- `name`
- `source`
- `transport`
- `proxy_available`
- `endpoint`
- `github_url`
- `tools`
- `tool_schemas`
- `resources`
- `prompts`
- `mcp_compliant`
- `protocol_version`
- `trust_score`
- `status`
- `schema_hash`
- `upstream_updated_at`
- `last_scanned_at`

These fields should be treated as best-effort only:

- `verified` when inferred from weak sources
- `description` if README-derived
- `transport` where not probe-confirmed
- `tools` when README-derived

### 10.5 MVP Metrics That Matter

#### Ingest correctness metrics

- source fetch success rate
- normalized rows written per source
- duplicate collision rate by repo and endpoint
- extraction success rate by transport
- tool schema coverage rate
- rows with empty descriptions after enrichment
- rows with `proxy_available = true` but empty/missing usable tools

#### Ingest efficiency metrics

- skip rate tier 1
- skip rate tier 2
- full-pipeline rate tier 3
- average ingest duration per source
- sandbox success/failure ratio

#### Data quality metrics

- percent of rows with `mcp_compliant = true`
- percent of rows with real `tool_schemas`
- percent of stdio rows with only README-derived tools
- percent of rows missing `github_url`
- percent of rows in `pending_review`

#### Downstream reliability metrics

- search zero-result rate caused by ingest quality gaps
- invoke failure rate attributable to bad ingest metadata
- search->invoke success by source

### 10.6 MVP Algorithm Assessment

#### Keep

- three-tier skip algorithm
- storing `stdio` rows rather than discarding them
- separating `proxy_available` from `transport`
- handshake-first MCP probe
- repo-level CVE dedup

#### Fix immediately

- endpoint dedup bug
- source contract drift (`partner` vs `vendor`, unwired `mcp_run` and `composio`)
- search RPC/schema drift
- misleading API key hint prefix drift (`sk_relay_` vs accepted `sk_mcp_`)
- weak GitHub stdio sandbox execution path
- authoritative transport recording

#### Improve soon after MVP

- persist extraction provenance per primitive set
- add confidence/quality score for schema extraction quality
- add structured dedup precedence rules by source trust
- backfill stdio rows when sandbox becomes available
- add per-source ingest quality dashboards

## 11. Search And Runtime Coupling

Even though ingest is the current MVP focus, ingest design must serve the search and invoke loops.

Important current state:

- MCP `search_tools` now passes `search_event_id`, `intent`, and derived `intentHash` into `executeProxyCall()`
- `executeProxyCall()` records `invoke_outcomes`
- `record_intent_outcome(...)` updates `intent_server_mappings`

This means the search -> invoke learning loop is present in the current code, even though older docs in the repo still describe it as missing.

## 12. Competitor Landscape

There is no perfect one-to-one competitor that matches Relay's full intended thesis exactly. The honest way to compare the market is to separate:

- registry/discovery
- managed connections/auth
- gateway/control plane
- agent-centric runtime capability resolution

### 12.1 Thesis-Level Comparison

| System | Registry / discovery | Managed auth / connections | Gateway / control plane | Agent-centric runtime capability resolution |
|---|---|---|---|---|
| Glama | strong | strong | strong | partial |
| Smithery | strong | strong | strong | partial |
| mcp.run | medium | strong | strong | partial |
| PulseMCP | strong | weak | weak | weak |
| MCP.so | strong | weak | weak/partial | weak |
| Relay | strong | strong | strong | core thesis |

The distinction is important:

- Glama and Smithery solve major adjacent pieces very well.
- Relay's distinct claim is not that it is the only directory or only gateway.
- Relay's distinct claim is that it is explicitly designed to remove the practical MCP configuration ceiling by making runtime discovery agent-centric.

### 12.2 Competitor Notes From Current Sources

#### Glama

Current official site claims:

- 21,999 MCP servers, 2,588 connectors, 131,409 tools as of April 23, 2026
- full logging, per-tool access control, managed OAuth credentials, usage analytics
- browser-based inspector and one-click hosting
- tool-level search across server-exposed tools

What Glama clearly solves well:

- registry/discovery
- tool-level search
- gateway/control plane
- managed credentials and observability

What Glama does not clearly present as its core thesis:

- collapsing the ecosystem behind one constant model-facing runtime abstraction
- treating agent-centric runtime intent routing as the primary product boundary

Glama appears closest to Relay on gateway/control-plane sophistication, but the public positioning is broader than Relay's specific thesis.

#### Smithery

Current official docs describe Smithery as:

- the largest open marketplace of MCP servers
- a platform to find, use, and publish MCP servers
- a managed "Connect" layer for OAuth, credentials, tokens, and sessions
- a publishing/gateway layer with analytics and protocol-compliance handling
- a per-connection model where applications list a user's connections, create MCP clients per connection, and aggregate tools across those connections

What Smithery clearly solves well:

- registry/distribution
- managed auth and connection lifecycle
- MCP integration ergonomics

What Smithery's own docs still imply:

- the app explicitly creates or retrieves connections
- tools are aggregated from connected integrations into the model/tooling layer

That means Smithery reduces the operational pain of 1:1 integrations substantially, but it does not fully eliminate the explicit connection model or clearly frame constant runtime capability resolution as the core problem statement.

#### mcp.run

Current official docs describe:

- a servlet/profile model rather than only raw server listings
- local and remote execution
- portable profiles, SSO, centrally stored authenticated connections
- a security/sandbox narrative around servlet execution

This is not the same product shape as Relay, but it is highly relevant because it attacks the same "how do tools follow the user and stay manageable?" problem.

#### PulseMCP

Current site shows:

- 13,107 servers listed on April 23, 2026
- popularity-style ranking and classification labels
- `server.json`-oriented listing metadata

This appears strongest as a discovery and popularity surface.

#### MCP.so

Current site shows:

- 20,333 MCP servers collected on April 23, 2026
- hosted, official, and featured listings
- broad marketplace positioning

This is a directory/marketplace competitor more than a control-plane competitor.

#### Composio

Current public pages emphasize:

- managed MCP infrastructure
- built-in auth/security/observability
- a large catalog of integrations

This is adjacent because it is more integration-platform-oriented than open registry oriented, but it still competes for teams that want "one managed MCP layer instead of managing raw servers themselves".

### 12.3 Research Neighbors And Prior Attempts

Relay is also adjacent to several strands of tool-use and retrieval research:

#### Static tool preload

- works for bounded tool sets
- fails as the accessible tool universe grows
- preserves a human-controlled integration bottleneck

#### Tool RAG / neural API retrieval

Examples: ToolLLM / ToolBench style API retrieval systems.

These help retrieve relevant APIs from a large pre-indexed tool universe. They are useful neighbors, but they do not by themselves solve:

- live MCP ecosystem discovery
- trust and policy controls
- credential injection
- transport-aware invocation

#### Tool-use competence papers

Examples: Toolformer, Chameleon, APIBank.

These papers are highly relevant because they show:

- LLMs benefit from external tools
- tool planning/retrieval is an active research area
- bounded API/tool benchmarks are useful

But they mostly study:

- whether a model can learn to use tools
- how to retrieve or sequence tools
- how to benchmark tool-use behavior

They do not solve the infrastructure problem Relay is focused on:

- dynamic discovery across a living MCP ecosystem
- runtime capability resolution for real agents
- unified auth, policy, and execution controls

### 12.4 Relay's Current Defensible Wedge

Relay's most credible wedge is not "we also have a directory". It is:

- agent-centric runtime discovery by intent
- a deliberately small model-facing interface
- normalized multi-source registry building
- explicit security and auth controls around runtime execution
- storing both discovery metadata and empirical outcome intelligence
- treating `intent_server_mappings` as the long-term routing moat

To make that wedge real, the ingest pipeline and search/invoke data contract must become clean and dependable first.

## 13. Current Obstacles And Trade-Offs

### Obstacles

- source contract drift across route/schema/code
- incomplete wiring of source adapters
- endpoint dedup bug
- transport truth is still partly heuristic
- stdio extraction remains weak without a better execution strategy
- documentation drift already exists between repo docs and code

### Trade-Offs

- storing all stdio rows increases discovery completeness but reduces immediate invocability
- README fallback increases coverage but lowers schema precision
- CVE-only ingest rejection reduces false positives but may admit malicious-but-unflagged servers
- free-tier infra lowers cost but raises operational fragility if not clearly classified as disposable

## 14. Recommended Next Sprints

### Sprint A: Ingest Correctness

- fix endpoint-prefetch dedup bug
- wire `mcp_run` and `composio` properly or remove them from the public contract
- unify `partner` vs `vendor`
- restore one authoritative `search_servers(...)` contract
- capture authoritative transport and extraction provenance

### Sprint B: Ingest Quality

- improve stdio execution model
- add extraction quality scoring
- improve monorepo README/subdirectory handling
- expand source-level metrics and dashboards

### Sprint C: Runtime/Analytics Integrity

- verify search and invoke contracts are aligned across MCP and REST
- keep the search -> invoke linkage intact
- turn runtime reliability metrics into trust-score penalties deliberately

### Sprint D: Resilience

- formalize backup/restore runbooks
- test migration away from Redis with no data loss
- test re-ingest/backfill after sandbox outages

## 15. Operational Rules Going Forward

- No canonical project data may live only in Redis or another free-tier cache.
- Any future feature that introduces state must declare whether it is canonical, reconstructible, or disposable.
- New ingestion sources must define:
  source contract, dedup key, transport semantics, extraction path, failure modes, and backfill strategy.
- New analytics must land in Postgres if it matters for product learning or trust scoring.
- Changes to architecture or roadmap must update this file, `DECISION_LOG.md`, and `CHANGELOG.md`.

## 16. References

- Glama: https://glama.ai/
- Glama servers: https://glama.ai/mcp/servers
- Glama connectors: https://glama.ai/mcp/connectors
- Glama inspector: https://glama.ai/mcp/inspector
- Glama clients: https://glama.ai/mcp/clients
- Smithery docs: https://smithery.ai/docs
- Smithery Connect: https://smithery.ai/docs/use/connect
- Smithery server publishing: https://smithery.ai/docs/build
- mcp.run docs: https://docs.mcp.run/mcp-clients/intro/
- mcp.run security article: https://docs.mcp.run/blog/2025/04/07/mcp-run-security/
- PulseMCP directory: https://www.pulsemcp.com/servers
- MCP.so: https://mcp.so/
- Toolformer: https://arxiv.org/abs/2302.04761
- Chameleon: https://arxiv.org/abs/2304.09842
- ToolLLM: https://arxiv.org/abs/2307.16789
- APIBank (cited in agent evaluation literature): https://aclanthology.org/2023.emnlp-main.187/
