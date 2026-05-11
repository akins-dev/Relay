# Relay Technical Backbone

Last updated: 2026-05-09 (Prototype scope reset)
Status: Historical technical backbone. Current MVP scope lives in `PROTOTYPE_IMPLEMENTATION_PLAN.md`.

## 0. Current MVP Override

As of 2026-05-09, Relay's prototype path is:

1. ingest MCP server metadata
2. search by intent
3. return tools, schemas, and a Relay run manifest
4. execute through Relay Local, exposed to agents as CLI commands or a local MCP server

Hosted cloud invocation, `/api/proxy/*`, Cloud MCP `invoke_tool`, Vault injection, sandbox extraction, CVE queues, and scheduled Vercel cron jobs are no longer part of the MVP runtime.

Local Relay MCP may expose `invoke_tool` later because that execution happens inside Relay Local, not Relay Cloud.

The rest of this file preserves broader architecture history and deferred production ideas. When it conflicts with `PROTOTYPE_IMPLEMENTATION_PLAN.md`, the prototype plan wins.

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

Relay's thesis is that the winning system is not another directory page and not merely another gateway. For the prototype, it is an agent-centric runtime discovery layer that:

- lets the agent discover capability by intent at runtime
- reduces the need for explicit pre-configuration
- keeps the model-facing interface deliberately small
- returns actionable run manifests for local or remote execution
- can later accumulate empirical outcome data so routing improves over time

## 2.1 Relation To RAG And Orchestration Frameworks

Relay is complementary to modern RAG and agent orchestration systems, not a replacement for them.

- RAG improves retrieval over documents, databases, and other knowledge sources
- LangChain and LangGraph improve workflow coordination, state management, and multi-step execution
- Relay solves a different infrastructure problem: runtime discovery, governed invocation, and outcome-driven routing across a large MCP ecosystem

This distinction matters because stronger reasoning and retrieval do not eliminate context bloat from large tool surfaces, manual MCP pre-configuration, transport fragmentation, open-world tool retrieval, or centralized credential and policy enforcement. Relay addresses a different bottleneck in the same broader agent system: making broad MCP capability usable at runtime under discovery, auth, trust, and execution constraints.

## 3. Product Model

Relay is currently best understood as three coupled systems in service of one product goal: remove the practical MCP cap by moving capability discovery into the runtime loop.

1. A canonical registry builder.
2. An agent-facing search layer.
3. A manifest layer that tells Relay Local how to run the selected server.

The MVP-critical loop is:

1. ingest server metadata into a canonical registry
2. search by agent intent
3. return the server/tool schema and run manifest
4. execute locally through Relay Local's CLI or MCP adapter

Everything else is secondary to stabilizing that loop.

## 3.1 How MCP Is Commonly Used Today

In a normal MCP integration, a client or agent runtime connects to one or more explicitly configured MCP servers, loads their available tool/resource/prompt surfaces, and then gives the model access to that bounded surface for planning and tool choice.

The exact implementation differs by client, but the common pattern is:

1. a human or application explicitly chooses which servers exist in the environment
2. the client loads or exposes those tool schemas to the model/runtime
3. the model decides whether to call one of the already-available tools

This works well for bounded environments. It weakens as the number of desirable MCP servers grows.

### Where That Model Breaks

- the set of accessible capabilities is still human-curated
- the model can only choose from what has already been connected
- credential and transport complexity scale with connected servers
- large tool surfaces create routing ambiguity and context pressure

## 3.2 How Relay Changes That

Relay changes the model from "preload a bounded tool universe" to "query a runtime discovery layer when needed".

The current Relay prototype does this with:

- `search_tools(intent)` for runtime capability resolution
- `get_server_manifest(server)` for local/remote execution instructions

The point is not that two tools are inherently special. The point is that:

- capability discovery becomes runtime-native
- the model-facing surface stays small
- search results can be structured, ranked, and improved over time
- execution stays with the local agent host instead of Relay cloud

## 3.3 How Relay Helps The Agent Make Better Decisions

The current solution is:

- a heuristic knowledge-vs-action classifier to avoid unnecessary tool search
- lexical + fuzzy search over a canonical registry
- historical boost data from prior invoke outcomes
- confidence scoring that combines position, trust, and history
- schema trimming so the model sees the most relevant tools per result instead of large noisy tool lists
- a separate guarded invoke path with structured auth/setup responses

This is a strong MVP architecture, but it is not the final optimal form.

## 3.4 Is The Current Solution Optimal?

Not yet.

It is a credible and efficient MVP solution, but not the theoretical optimum.

### Why It Is Good For MVP

- simple model-facing interface
- measurable search -> invoke -> learn loop
- clean place to enforce auth, trust, and policy
- efficient bootstrap without requiring a trained routing model

### Why It Is Not Yet Fully Optimal

- search still returns result sets that the model must interpret
- confidence is heuristic + empirical aggregate, not learned routing
- schema trimming is lexical, not intent-model-aware
- there is no speculative execution or ephemeral tool materialization yet
- there is no trained fast path for common intents yet

### Path Toward A More Optimal System

- stronger behavioral reranking from real invoke outcomes
- learned intent routing for common intents
- speculative invocation on very high-confidence matches
- session pooling / lower-latency invoke path
- potentially adaptive or ephemeral tool surfacing once enough confidence exists

### Roadmap Mapping For Those Gaps

| Gap | Planned improvement | Sprint |
|---|---|---|
| search still returns result sets that the model must interpret | speculative invocation on obvious single matches; learned routing for common intents | Sprint 4, Sprint 8+ |
| confidence is heuristic + empirical aggregate | learned Lever 3B classifier first, then trained routing | Sprint 6, Sprint 8+ |
| schema trimming is lexical | stronger reranking first, then adaptive tool surfacing | Sprint 6, Sprint 8+ |
| no speculative execution yet | high-confidence speculative invocation | Sprint 4 |
| no ephemeral tool materialization yet | adaptive or ephemeral tool surfacing once confidence is stable | Sprint 8+ |
| no trained fast path for common intents yet | routing model trained from `search_events`, `invoke_outcomes`, and `intent_server_mappings` | Sprint 8+ |

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

- `intent_server_mappings` (invoke_count, success_count per server)
- `get_intent_boosts(...)` for search reranking
- search reranking from historical success/failure
- **trust score behavioral reliability slot** — the Bayesian-smoothed invoke success rate from ISM is now a first-class trust signal, not a vanity metric. This closes the feedback loop between runtime outcomes and registry quality scores.

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

Active source fetchers wired into `runIngest()`:

| Source | Tier | Notes |
|---|---|---|
| Official MCP Registry | Primary | Full endpoints + tool schemas |
| Smithery | Primary | Full endpoints + tool schemas + `verified` flag |
| Glama | Enrichment | Via github_url, enriches existing rows |
| mcp.directory | Enrichment | Via github_url, enriches existing rows |

Decommissioned sources (removed from `runIngest()`):

- GitHub `modelcontextprotocol/servers` — no standard MCP server listing API
- PulseMCP — public API returns 403
- ClaudeMCP — relied on fragile `__NEXT_DATA__` scraping
- MCP.so — no JSON API
- mcpservers.org — no API (static list)
- MCP.run / Composio — fetchers exist in code but not wired in (no active API contract)

### 7.2 Runtime Surfaces

- `POST /api/ingest`
- `POST /api/admin/ingest`
- `GET /api/servers/search`
- Relay Local `relay invoke {server} {tool}` (planned runtime surface)
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
| `proxy_available` | legacy hosted-proxy eligibility flag | superseded by manifest `run_mode` for the prototype |
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

At ingest time, there is no invoke history yet. The pipeline passes `invokeCount: 0, successCount: 0` to `computeTrustScore()`, which applies a Beta(3,1) Bayesian prior to give new servers a floor of ~8 pts in the behavioral reliability slot rather than 0. This correctly signals "unproven" rather than "broken."

The trust score computation at ingest time uses:

- `verified` publisher signal from upstream source
- `uptimePct: 100` (assumed at ingest; uptime cron will update this within 15 min)
- `invokeCount: 0, successCount: 0` (Bayesian prior gives ~8pts floor)
- `scanScore`: 100 if no CVEs found; 50 if high-severity CVEs present
- `deploymentQuality: 1` if server has a working endpoint **and** at least one tool schema with `inputSchema`; 0 otherwise
- `daysSinceChange`: computed from `schema_changed_at` if the row already exists; 0 for new servers

This is deterministic and source-agnostic. No synthetic `stars` or hardcoded `daysSinceChange` overrides are applied. The score grows automatically as:

1. Uptime cron recomputes with real uptime data (updates uptime slot)
2. Agents invoke the server via proxy and `intent_server_mappings` accumulates success/failure data (updates behavioral slot)
3. `schema_changed_at` ages without mutations (updates stability slot)

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

#### B. Source contract drift — RESOLVED (migration 032 workstream)

Previous drift points (all fixed):

- `/api/ingest` previously accepted `partner`, `mcp_run`, and `composio` — now accepts only `all`, `official`, `smithery`, `glama`, `mcp_directory`
- `/api/admin/ingest` previously accepted `github`, `partner`, `vendor` — now matches `/api/ingest` exactly
- `runIngest()` previously handled `vendor` instead of the documented `partner` — now handles `official`, `smithery`, `glama`, `mcp_directory` only
- Dead fetchers (`fetchMcpRunServers()`, `fetchComposioServers()`) remain in code for reference but are not wired into `runIngest()`

Current state: API surface and actual ingest behavior are aligned.

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
- source contract alignment (resolved in migration 032 workstream — see section 10.2B)
- search RPC/schema drift
- API key hint prefix drift was present historically (`sk_relay_` vs accepted `sk_mcp_`) and should now be treated as a regression check item rather than current expected behavior.
- weak GitHub stdio sandbox execution path
- authoritative transport recording

#### Improve soon after MVP

- persist extraction provenance per primitive set
- add confidence/quality score for schema extraction quality
- add structured dedup precedence rules by source trust
- backfill stdio rows when sandbox becomes available
- add per-source ingest quality dashboards

## 11. Search And Runtime Coupling

Even though ingest is the current MVP focus, ingest design must serve the search, manifest, and Relay Local invoke loops.

Important current state:

- Cloud MCP `search_tools` records search intent metadata.
- Relay Local should report invocation outcome metadata once implemented.
- `record_intent_outcome(...)` / `intent_server_mappings` remain the future learning path.

This means the search -> local invoke -> outcome learning loop remains the intended architecture, but the prototype no longer relies on hosted proxy execution.

## 12. Story Constraint And Roadmap Alignment

This project should be explained in problem-first terms.

The central story is:

1. MCP capability does not scale cleanly under explicit pre-configuration.
2. Relay moves capability resolution into the runtime loop.
3. Security, vault-backed credentials, trust, and policy are support systems that make that runtime loop safe to use.
4. Search and invoke outcomes are recorded so the system can improve toward learned routing.

That means Relay should not be described primarily as a registry, a gateway, a vault, or a security product in isolation. Those are necessary subsystems. They are not the root story.

### 12.1 Full-System View

Relay is one coupled system with four layers:

1. multi-source ingest builds a canonical registry from fragmented upstream data
2. runtime search resolves likely capability by intent while keeping the model-facing surface small
3. guarded invocation centralizes auth, vault injection, trust, policy, and security controls
4. analytics and training data improve later routing quality

### 12.2 Current Gaps And Their Scheduled Fixes

| Current gap | Why it matters | Planned fix | Sprint |
|---|---|---|---|
| search still returns result sets the model must interpret | common intents still pay interpretation overhead | speculative invocation, then learned routing | Sprint 4, Sprint 8+ |
| confidence is heuristic + empirical aggregate | ranking quality is good but not yet model-learned | learned Lever 3B classifier, later trained routing | Sprint 6, Sprint 8+ |
| schema trimming is lexical | result payloads are cleaner, but not yet intent-model-aware | stronger reranking, then adaptive tool surfacing | Sprint 6, Sprint 8+ |
| no speculative execution yet | search and invoke remain separate on obvious cases | speculative invocation on high-confidence single matches | Sprint 4 |
| no strong `stdio` runtime bridge in general agent hosts | a large share of discovered capability is not yet equally invocable in the cloud path | CLI bridge, then cloud stdio bridge | Sprint 5, Sprint 7 |
| no trained fast path for common intents | common traffic still hits the lexical path | learned routing layer | Sprint 8+ |

### 12.3 What Must Stay In The Story

The following are essential because they directly support the core loop:

- ingest from several sources because the ecosystem is fragmented
- canonical registry normalization because runtime search quality depends on it
- vault-backed secrets and OAuth because many useful servers need credentials
- security and policy enforcement because runtime execution without controls is unacceptable
- confidence scoring because search needs a measurable ranking layer before learned routing exists
- analytics tables because training data does not appear by magic
- CLI and cloud stdio bridges because discovery without invocation is incomplete
- learned routing because the long-term goal is to reduce or remove search cost for common intents

### 12.4 What Should Be De-Emphasized

The docs should avoid drifting into:

- generic competitor framing
- feature-by-feature platform comparison
- business-model-first storytelling
- over-explaining subsystems without tying them back to the practical MCP cap

## 13. Current Obstacles And Trade-Offs

### Obstacles

- transport truth is still partly heuristic
- `stdio` extraction remains weak without a better execution strategy
- documentation drift can reintroduce narrative confusion
- ingest does not yet include MCP.run or Composio (fetchers exist but are not wired into `runIngest()`)

> **Resolved since 2026-04-23:** Source contract drift (route vs ingest) is fixed — the route and `runIngest()` now accept exactly the same four sources. Endpoint dedup is improved. The search RPC schema is fully synchronized in migration 032.

### Trade-Offs

- storing all `stdio` rows increases discovery completeness but reduces immediate cloud invocability
- README fallback increases coverage but lowers schema precision
- CVE-only ingest rejection reduces false positives but may admit malicious-but-unflagged servers
- free-tier infra lowers cost but raises operational fragility if not clearly classified as disposable

## 14. Recommended Next Work Sequence

The canonical sprint-by-sprint plan now lives in [`DELIVERY_ROADMAP.md`](DELIVERY_ROADMAP.md).

This file should keep the why and the dependency logic:

- finish runtime safety and auth correctness before optimizing latency
- solve `stdio` reachability before claiming broad capability access
- keep analytics quality high before training learned routing
- treat learned routing as the fast path that compounds from the current loop, not as a separate product

## 15. Operational Rules Going Forward

- No canonical project data may live only in Redis or another free-tier cache.
- Any future feature that introduces state must declare whether it is canonical, reconstructible, or disposable.
- New ingestion sources must define source contract, dedup key, transport semantics, extraction path, failure modes, and backfill strategy.
- New analytics must land in Postgres if they matter for product learning, trust scoring, or routing quality.
- Changes to the architecture or roadmap must update this file, [`DELIVERY_ROADMAP.md`](DELIVERY_ROADMAP.md), `DECISION_LOG.md`, and `CHANGELOG.md`.
- Changes to enforced limits or throttling behavior must update [`RATE_LIMITS.md`](RATE_LIMITS.md) in the same workstream.
- Narrative docs must describe Relay first as a solution to the practical MCP configuration ceiling and only secondarily as a collection of supporting subsystems.

## 16. References

- Toolformer: https://arxiv.org/abs/2302.04761
- Chameleon: https://arxiv.org/abs/2304.09842
- ToolLLM: https://arxiv.org/abs/2307.16789
- APIBank (cited in agent evaluation literature): https://aclanthology.org/2023.emnlp-main.187/
- ToolRet: https://aclanthology.org/2025.findings-acl.1258/
- ToolHop: https://aclanthology.org/2025.acl-long.150/
- Meta-Tool / Meta-Bench: https://aclanthology.org/2025.acl-long.1481/
- ToolSandbox: https://machinelearning.apple.com/research/toolsandbox-stateful-conversational-llm-benchmark
- Tau-bench: https://github.com/sierra-research/tau2-bench
- Tau-Knowledge: https://taubench.com/blog/tau-knowledge.html
- BFCL leaderboard: https://gorilla.cs.berkeley.edu/leaderboard
- BFCL V4 web search note: https://gorilla.cs.berkeley.edu/blogs/15_bfcl_v4_web_search.html
- MCP specification: https://modelcontextprotocol.io/specification/
- MCP 2026 roadmap: https://blog.modelcontextprotocol.io/posts/2026-mcp-roadmap/
- MCP landscape and security threats: https://arxiv.org/abs/2503.23278
- Beyond the Protocol: https://arxiv.org/abs/2506.02040
