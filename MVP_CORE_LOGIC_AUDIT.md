# MVP Core Logic Audit

Last updated: 2026-04-23
Canonical technical reference: [`docs/TECHNICAL_BACKBONE.md`](docs/TECHNICAL_BACKBONE.md)

## Purpose

This document maps the current core logic exactly as implemented today so we can:

- agree on what the real product core is
- isolate the MVP-critical failures from feature noise
- build a deterministic 50-server prototype environment
- decide the minimum implementation order for shipping

The core product loop is:

1. Ingest servers into a canonical registry.
2. Search that registry by intent.
3. Invoke a selected tool through one guarded execution path.
4. Feed invoke outcomes back into ranking.

Everything outside that loop is secondary for MVP.

## Core Components

### Canonical data sources

- `src/lib/ingest.ts`
- `src/lib/cron/ingest.ts`
- `src/lib/mcp-probe.ts`
- `supabase/migrations/*` for `servers` schema and search RPCs

### Search entrypoints

- MCP: `src/app/api/mcp-server/route.ts`
- REST: `src/app/api/servers/search/route.ts`
- SQL ranking backend: `search_servers(...)`

### Invoke entrypoints

- MCP: `src/app/api/mcp-server/route.ts`
- REST proxy: `src/app/api/proxy/[serverName]/[toolName]/route.ts`
- Shared executor: `src/lib/proxy-execute.ts`

### Learning / feedback layer

- `src/lib/search-analytics.ts`
- `supabase/migrations/022_analytics_intelligence_layer.sql`

## What The System Is Trying To Be

The intended architecture is:

1. Pull server metadata from multiple registries and normalize it into `servers`.
2. Expose the registry as a native MCP server with `search_tools` and `invoke_tool`.
3. Let agents search by intent rather than by tool name.
4. Enforce safety and auth centrally during invocation.
5. Learn from successful search -> invoke chains over time.

That is the moat. Not the browse UI, not the admin dashboard, not the docs.

## Current Ingest Flow

### High-level flow

1. `/api/ingest` validates cron auth and source selection.
2. `runIngest()` fetches from one or more upstream sources.
3. Each source returns `IngestServer[]` with mixed metadata quality.
4. `upsertServers()` normalizes names, transport, metadata, descriptions, schemas, and trust inputs.
5. HTTP-capable servers are probed live through `fetchMCPPrimitives()`.
6. `stdio` servers optionally go through the sandbox extractor, then README fallback.
7. CVE scan runs per GitHub repo.
8. Server row is inserted or updated in `servers`.

### Important ingest decisions

- `transport` and `proxy_available` are separate concepts.
- `stdio` is intentionally stored, not discarded.
- `proxy_available` is false for `stdio` rows.
- trust score is calculated at ingest time, then expected to evolve later.
- schema/tool extraction quality varies by transport and source.

### Current ingest flaws

- `src/lib/ingest.ts` does not compile because of a broken stray comment near line 655.
- endpoint dedup is intended but broken: the prefetch query in `upsertServers()` does not select `endpoint`, so `existingByEndpoint` never actually fills.
- stdio extraction path is still experimental and depends on external sandbox availability.
- ingest mixes core normalization logic with source-specific hacks and verbose debug logging.

## Current Search Flow

There are two different search products today.

### A. MCP `search_tools`

File: `src/app/api/mcp-server/route.ts`

Flow:

1. Client connects to `/api/mcp-server`.
2. Client calls `initialize`.
3. Client calls `tools/list`.
4. Client calls `tools/call` with `name = "search_tools"`.
5. Server derives caller fingerprint / API-key identity.
6. Rate limiting is applied.
7. `intent` is validated.
8. Heuristic classifier tries to detect knowledge questions and can early-return `no_tool_needed`.
9. In-memory intent cache is checked.
10. If cache misses, Supabase RPC `search_servers(query_text, result_limit)` is called.
11. Historical boost data is fetched with `get_intent_boosts(intentHash, serverNames)`.
12. Confidence score is computed from rank, trust score, and invoke history.
13. Tool schemas are trimmed to at most 3 relevant tools.
14. Good results are added to the in-memory cache.
15. Search event is recorded asynchronously.
16. Result text is returned to the MCP client.

### B. REST `/api/servers/search`

File: `src/app/api/servers/search/route.ts`

Flow:

1. Caller sends `q` and optional `limit`.
2. Query is validated.
3. Rate limiting is applied.
4. Supabase RPC `search_servers(...)` is called.
5. If results exist, a second `servers` query enriches them with auth and transport fields.
6. Final result rows are shaped for browser/agent consumption.
7. Response includes auth guidance, transport hints, proxy hints, and invocation examples.

### Search decisions in play

- MCP search is trying to be intent-first and agent-optimized.
- REST search is trying to be richer and more transparent.
- SQL ranking mixes text rank, name similarity, freshness boost, category balancing, trust score, and stars.
- MCP search adds another ranking layer on top of SQL with behavioral boosts and confidence scoring.

### Current search flaws

- The MCP and REST search flows are not using the same result contract.
- REST search calls `search_servers(query_text, result_limit, include_stdio = true)`.
- the latest visible SQL definition in migration `020_add_github_url_to_search.sql` defines only `search_servers(query_text, result_limit)`.
- MCP search expects fields like `proxy_available`, but the visible latest SQL definition does not return them.
- MCP search defaults missing `proxy_available` to `true`, which is dangerous for `stdio` rows.
- result shaping is duplicated across MCP search and REST search instead of coming from one canonical formatter.
- the intent cache is process-local only, so behavior differs across instances and cold starts.

## Current Invoke Flow

There are two invoke entrypoints, but one shared executor.

### A. MCP `invoke_tool`

File: `src/app/api/mcp-server/route.ts`

Flow:

1. Client calls `tools/call` with `name = "invoke_tool"`.
2. Rate limiting is applied.
3. `server` and `tool` args are validated.
4. `executeProxyCall()` is called directly.
5. If proxy returns 202 or 401, that structured payload is surfaced.
6. If proxy returns other 4xx/5xx, MCP error is returned.
7. If success, result body is parsed and wrapped in MCP response text.

### B. REST `/api/proxy/{server}/{tool}`

File: `src/app/api/proxy/[serverName]/[toolName]/route.ts`

Flow:

1. Caller identity is resolved from session cookie and/or API key.
2. Session/API-key mismatch is rejected.
3. Rate limiting is applied.
4. Request body is read as raw text.
5. `executeProxyCall()` is called.
6. Proxy result is returned as raw HTTP response with CORS headers.

### C. Shared execution path: `executeProxyCall()`

File: `src/lib/proxy-execute.ts`

Flow:

1. Require authenticated caller.
2. Reject body larger than 1 MB.
3. Load server record from `servers`.
4. Reject missing server.
5. Reject `proxy_available = false`.
6. Reject missing or unsafe endpoint.
7. Reject unknown tool.
8. Verify optional confirmation token.
9. Check tool policy.
10. Scan request for leaked credentials.
11. Scan request for sampling injection payloads.
12. Scan request for shell injection.
13. Scan selected URL fields for SSRF / dangerous elicitation.
14. Inject stored credential or OAuth token if configured.
15. Run MCP initialize handshake for `sse` or `unknown` servers.
16. Build a `tools/call` JSON-RPC request for the upstream server.
17. POST to the upstream MCP endpoint.
18. Follow one redirect if safe.
19. Read bounded response body.
20. Run response-side DLP / PII / leak / indirect injection scans.
21. Record metering, audit, analytics, and latency updates asynchronously.
22. Return structured auth prompt for upstream 401.
23. Return final result with metadata headers.

### Invoke decisions in play

- all real execution is supposed to pass through `executeProxyCall()`
- auth injection lives outside tool args
- policy and safety are enforced before upstream invocation
- response scanning warns but does not always block

### Current invoke flaws

- API key prefix drift was present and has now been corrected to `sk_mcp_` across the main runtime paths. Re-check any remaining docs/examples before treating this fully closed.
- the search -> invoke linkage now exists in the MCP path, but it still depends on the caller carrying `search_event_id` and `intent` forward correctly.
- request/response analytics are asynchronous, which is fine, but the higher-level search and SQL contracts still need cleanup before the feedback loop can be treated as fully trustworthy.

## Feedback Loop: Intended vs Actual

### Intended loop

1. `search_tools` records a `search_event`.
2. `invoke_tool` passes `searchEventId`, `intentHash`, and `intentText`.
3. `recordInvokeOutcome()` writes an `invoke_outcomes` row.
4. `record_intent_outcome(...)` updates `intent_server_mappings`.
5. future searches use `get_intent_boosts(...)` to rank better.

### Actual loop today

1. `search_tools` records a search event asynchronously.
2. `invoke_tool` now carries `searchEventId`, `intentHash`, and `intentText` into `executeProxyCall()` when the MCP caller supplies them.
3. `recordInvokeOutcome()` writes an `invoke_outcomes` row with those linkage fields.
4. `record_intent_outcome(...)` updates `intent_server_mappings`.
5. future searches can already consume `get_intent_boosts(...)`.

The loop is present in code now. The remaining gap is not total absence; it is contract hardening and verification across MCP, REST, SQL, and analytics.

## The Real MVP Core

For MVP, the true core is:

1. deterministic canonical server rows
2. one trustworthy search contract
3. one trustworthy invoke contract
4. one real search -> invoke -> learn loop

Everything else should be treated as optional until those are stable.

## MVP Fix Order

This is the recommended implementation sequence.

### Phase 0: Make the repo trustworthy again

1. Fix the TypeScript syntax break in `src/lib/ingest.ts`.
2. Make tests runnable without broken imports/mocks.
3. Regenerate or hand-fix stale Supabase types enough that core code can be reasoned about safely.

Exit criteria:

- `npx tsc --noEmit` passes
- core tests run cleanly

### Phase 1: Unify the search contract

1. Decide what `search_servers(...)` is supposed to return for MVP.
2. Make SQL, route code, and TypeScript types agree.
3. Decide explicitly whether MCP search should include `stdio` rows.
4. If `stdio` rows are included, return `transport` and `proxy_available` explicitly and never default them optimistically.
5. Move result shaping into one canonical formatter or one shared result contract.

Exit criteria:

- REST and MCP search read from the same search truth
- no route depends on fields the SQL function no longer returns

### Phase 2: Make invoke trustworthy

1. Standardize API key prefix naming across code, docs, and error messages.
2. Confirm the MCP protocol version being advertised is valid for the clients we support.
3. Keep `executeProxyCall()` as the single invoke core.
4. Audit the exact conditions under which response warnings should block vs warn.

Exit criteria:

- one documented invoke contract
- consistent auth instructions

### Phase 3: Harden the feedback loop

1. Keep returning a search correlation token or event ID from `search_tools`.
2. Ensure all invoke entrypoints consistently carry that linkage into `executeProxyCall()`.
3. Verify `recordInvokeOutcome()` updates `intent_server_mappings`.
4. Add tests proving a successful invoke changes future ranking input.
5. Decide whether linkage should become required or remain best-effort.

Exit criteria:

- search results can get better from real usage

### Phase 4: Build the 50-server prototype environment

1. Stop depending on live public ingest as the main testbed.
2. Seed a deterministic fixture dataset.
3. Add a controlled set of fake upstream MCP servers.
4. Run search/invoke E2E against those fixtures.

Exit criteria:

- repeatable prototype runs
- stable failure cases

## 50-Server Prototype Dataset

The goal is not realism at internet scale. The goal is enough variety to surface ranking, transport, auth, and execution bugs.

### Recommended mix

- 20 healthy `streamable_http` servers
- 8 healthy `sse` servers
- 6 auth-required HTTP servers
- 4 flaky HTTP servers
- 4 malformed metadata/schema servers
- 4 close-neighbor / duplicate-style servers
- 4 `stdio` servers

Total: 50

### Why this mix

- mostly HTTP so core invoke/search paths get heavy coverage
- enough `sse` to exercise handshake behavior
- enough auth-requiring servers to validate credential setup flow
- enough bad actors and malformed rows to expose ranking and safety bugs
- enough `stdio` to force honest transport handling
- enough near-duplicates to stress dedup and result quality

### Concrete server behavior buckets

#### Healthy HTTP

- returns valid `initialize`
- returns valid `tools/list`
- returns valid `tools/call`
- covers common categories: email, docs, github, db, payments, CRM, search

#### Auth-required

- upstream returns 401 unless auth header injected
- mix API-key and OAuth-style metadata

#### Flaky

- timeout
- 500
- invalid JSON body
- safe redirect

#### Malformed metadata

- empty description
- missing tools array
- tools without schemas
- duplicate endpoint under different source/name

#### `stdio`

- valid local-only rows
- one with strong metadata
- one with sparse metadata
- one sandbox-extractable
- one README-only fallback

## Recommended Prototype Architecture

### Do not use live internet ingest as the prototype substrate

Reasons:

- nondeterministic
- source APIs change
- rate limits vary
- server quality drifts
- failures become hard to reproduce

### Use a fixture-first environment

Build two layers:

1. Fixture rows inserted into `servers`
2. Local fake MCP upstream servers that the fixture rows point to

That gives us deterministic ranking inputs and deterministic invoke behaviors.

### Preferred implementation

- a fixture seeder script that inserts 50 known `servers` rows
- a local test harness that boots several fake MCP servers on fixed ports
- one fake server process can expose multiple server personalities if needed
- dedicated fixture tags like `prototype`, `happy-path`, `auth`, `flaky`, `stdio`

## Testing Strategy

Automated testing should be the default for the core. Manual testing should validate the final integration feel, not substitute for correctness.

### What should be automated

#### Search

- returns expected result shape
- respects rate limits
- correctly labels `stdio` vs proxy-capable servers
- handles empty results
- preserves transport/auth fields
- ranks boosted servers higher after successful invokes

#### Invoke

- rejects anonymous invoke
- rejects unsafe endpoint
- rejects unknown tool
- blocks request DLP leaks
- blocks shell injection
- handles upstream 401 with setup guidance
- handles timeout/500/redirect/malformed response
- injects credentials when configured

#### Feedback loop

- `search_tools` creates a search event
- `invoke_tool` links to that search event
- successful invoke updates `intent_server_mappings`
- failed invoke updates failure path
- next search observes boost data

#### Ingest / fixtures

- seeder inserts all 50 rows
- dedup logic behaves as expected for close-neighbor rows
- `stdio` rows never become cloud-invocable accidentally

### What should be manual

- one smoke test from a real MCP client against `/api/mcp-server`
- one smoke test through the REST proxy
- one browser-side browse/search sanity pass
- one end-to-end auth setup flow

## Current Test Reality

As of 2026-04-23:

- `npm test` passes
- `npx tsc --noEmit` passes

That restores basic signal. It does not by itself prove the contracts are clean, but it means failures can once again be treated as useful regression indicators.

## Immediate MVP Checklist

### Must do now

- fix `src/lib/ingest.ts` syntax break
- fix stale test/mocking setup
- define one canonical search contract
- align SQL, route handlers, and TypeScript types
- wire search -> invoke correlation data
- standardize auth key prefix naming
- build fixture seeder for 50 servers
- build fake upstream MCP servers
- add E2E tests for MCP search and invoke

### Can wait

- richer admin analytics UI
- production-scale cache sophistication
- fully polished stdio sandbox extraction
- extra browse UX features
- deep source coverage across every upstream registry

## MVP Decision

The recommendation is:

- do not delete all features
- freeze non-core feature work
- strengthen the core loop in place
- use a fixture-first prototype environment instead of live-source ingestion

The expensive part is not rebuilding UI later. The expensive part is repairing the trustworthiness of the search -> invoke -> learn loop. That is where effort should go first.

## Suggested Next Implementation Slice

The best next coding slice is:

1. restore compile + test signal
2. unify the search contract
3. wire invoke correlation data
4. build the 50-server fixture world
5. add E2E tests over that world

Once those are in place, we can make feature decisions from a stable core instead of from noise.
