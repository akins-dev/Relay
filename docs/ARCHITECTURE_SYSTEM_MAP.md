# Relay Architecture System Map

Last updated: 2026-05-05 (Migration 032: Behavioral Trust & Dynamic Diversity)
Status: Deep code-grounded architecture overview

Canonical technical reference: [`TECHNICAL_BACKBONE.md`](TECHNICAL_BACKBONE.md)
Presentation-oriented flow view: [`ARCHITECTURE_FLOWS.md`](ARCHITECTURE_FLOWS.md)
Companion Excalidraw starter scene: [`diagrams/relay-system-overview.excalidraw`](diagrams/relay-system-overview.excalidraw) (importable into Excalidraw and usable as the base canvas in Obsidian)

This file is the single deep architecture walkthrough for Relay as it exists in code. It is designed to support review, diagramming, and visual modeling work. It connects the actual request paths, control paths, data paths, background jobs, and storage contracts.

## 1. Scope

This map covers the system end to end:

- entry surfaces: MCP, REST, prompt-driven HTTP, admin, cron
- identity resolution: session auth, API keys, service-role execution
- rate limiting and cache layers
- runtime search and ranked tool discovery
- guarded invocation and upstream MCP execution
- secrets and OAuth credential flows
- policy and confirmation gates
- security scanning at publish time, invoke time, and drift time
- ingest and canonical registry construction
- analytics and learning loops
- uptime, drift, and maintenance cron flows
- Postgres, Vault, and Redis-backed state

## 2. The Whole System At Once

```text
Clients / agents / admins / cron
  -> entry routes
  -> auth + identity
  -> rate limits + cache
  -> one of:
       A. runtime search
       B. guarded invocation
       C. ingest / maintenance job
  -> Supabase-backed state changes
  -> analytics / audit / trust updates
  -> future routing improves
```

## 3. Runtime Entry Surfaces

### 3.1 Native MCP server

Primary code:

- `src/app/api/mcp-server/route.ts`

What it does:

- exposes Relay itself as a standard MCP server
- supports `initialize`, `tools/list`, `tools/call`, `ping`
- exposes only two model-facing tools:
  - `search_tools`
  - `invoke_tool`

Transport behavior:

- POST handles Streamable HTTP MCP calls
- GET exposes SSE compatibility for older clients

### 3.2 REST search and invoke

Primary code:

- `src/app/api/servers/search/route.ts`
- `src/app/api/proxy/[serverName]/[toolName]/route.ts`

What it does:

- search by natural-language intent over the registry
- invoke a concrete tool on a concrete server through the guarded proxy

### 3.3 Prompt-driven HTTP usage

Primary code:

- `src/app/agents.md/route.ts`
- `src/app/api/mcp/route.ts`

What it does:

- lets a model use Relay over plain HTTP even if the host does not wire MCP natively

### 3.4 Admin and cron surfaces

Primary code:

- `src/app/api/ingest/route.ts`
- `src/app/api/admin/ingest/route.ts`
- `src/app/api/cron/schema-drift/route.ts`
- `src/app/api/cron/uptime-check/route.ts`
- `src/app/api/cron/reset-daily-calls/route.ts`
- `src/lib/cron/cron-auth.ts`

What it does:

- triggers ingest and maintenance jobs
- records operational runs into database tracking tables
- authenticates cron execution via `Authorization: Bearer <CRON_SECRET>` or Vercel's `x-vercel-cron: 1`

## 4. Identity, Auth, And Caller Resolution

### 4.1 Session auth

Primary code:

- `src/lib/supabase/server.ts`
- `src/lib/auth-server.ts`

Flow:

1. `createClient()` builds a cookie-aware Supabase SSR client.
2. `resolveUser()` checks:
   - `Authorization: Bearer <supabase-jwt>` first
   - cookie session second
3. Routes that need a human user use this path.

Used by:

- secrets
- OAuth flows
- policy management
- admin ingest
- API key creation

### 4.2 API key auth

Primary code:

- `src/lib/auth-server.ts`
- `src/app/api/auth/api-keys/route.ts`

Flow:

1. User creates key at `POST /api/auth/api-keys`.
2. Raw key is generated as `sk_mcp_<random>`.
3. Only the SHA-256 hash and key prefix are stored in `api_keys`.
4. `resolveApiKey()` hashes the presented token and looks it up.
5. Key resolution is cached for 5 minutes via `withCache(...)`.

Used by:

- MCP server requests
- proxy invocation
- REST search with higher limits

### 4.3 Service-role execution

Primary code:

- `src/lib/supabase/server.ts`

Flow:

1. `createServiceClient()` uses `SUPABASE_SERVICE_ROLE_KEY`.
2. This bypasses RLS.
3. It is used only for server-side trusted operations:
   - ingest
   - scan and audit writes
   - secrets RPCs
   - OAuth token RPCs
   - analytics writes
   - cron jobs

### 4.4 Cron auth

Primary code:

- `src/lib/cron/cron-auth.ts`

Flow:

1. cron routes call `isCronAuthorized(req)`
2. manual or local callers can use `Authorization: Bearer <CRON_SECRET>`
3. Vercel scheduled invocations can use `x-vercel-cron: 1`
4. unauthorized job triggers are rejected before ingest or maintenance work starts

## 5. Rate Limiting And Cache Layers

### 5.1 Rate limiting

Primary code:

- `src/lib/ratelimit.ts`
- `docs/RATE_LIMITS.md`

Behavior:

- production uses Upstash sliding-window rate limiting
- local falls back to in-memory counters
- some contexts are DB-configurable via `rate_limit_config`
- some route-specific limits remain hardcoded in handlers

Core contexts in active use:

- `search`
- `browse`
- `proxy`
- `proxyAuth`
- `auth`
- `publish`

Keying model:

- anonymous traffic by IP
- authenticated traffic by user ID
- MCP falls back to a request fingerprint if no usable IP is present

### 5.2 Shared caching

Primary code:

- `src/lib/cache.ts`

Behavior:

- Upstash Redis if configured
- otherwise in-memory LRU fallback
- used to cache:
  - API key resolution
  - server lookups
  - policy lookups
  - OAuth token retrieval
  - secret-hint lookup
  - vault secret retrieval

### 5.3 Intent cache

Primary code:

- `src/lib/search-analytics.ts`

Behavior:

- a separate in-memory intent-to-server cache
- used as a fast path for repeated successful intents
- TTL depends on prior confidence

## 6. Runtime Search Flow

Primary code:

- `src/app/api/mcp-server/route.ts`
- `src/app/api/servers/search/route.ts`
- `src/lib/search-analytics.ts`
- `public.search_servers(...)` SQL RPC

### 6.1 MCP search path

Flow:

1. client calls `tools/call(search_tools, { intent, limit })`
2. route resolves API key identity if present
3. rate limit is enforced
4. intent is classified by the Lever 3A heuristic gate:
   - knowledge
   - action
5. if knowledge-only:
   - no external search
   - `search_event` still recorded as `no_tool_needed`
6. if action:
   - intent hash is computed
   - intent cache is checked
7. on cache miss:
   - `search_servers` RPC is called
   - server rows are enriched from `servers`
   - historical boosts are loaded from `get_intent_boosts(...)`
   - confidence scores are computed
   - schemas are trimmed to the most relevant tools
8. `search_event` is recorded asynchronously
9. formatted ranked results are returned to the agent

### 6.2 REST search path

Flow:

1. caller hits `GET /api/servers/search?q=...`
2. route optionally resolves API key ownership
3. rate limit is enforced
4. `search_servers(...)` RPC runs
5. results are enriched from `servers`
6. auth guidance and invocation hints are attached
7. stdio servers return `proxy_available=false` and CLI guidance

### 6.3 Search output contract

Search is not just retrieval. It is also a control-surface shaper:

- ranked capability options
- trust score (Bayesian behavioral model; also exposed as `invoke_count` for maturity context)
- transport
- proxy availability
- trimmed schemas
- credential setup guidance
- correlation ID for the learning loop

Search diversity (migration 032): a soft 8% penalty is applied to servers from over-represented categories that score below the result-set median. The threshold is always relative to the current query result set — no hardcoded global cutoff.

## 7. Guarded Invocation Flow

Primary code:

- `src/app/api/mcp-server/route.ts`
- `src/app/api/proxy/[serverName]/[toolName]/route.ts`
- `src/lib/proxy-execute.ts`

### 7.1 Invocation pipeline

Flow:

1. caller chooses `server + tool + args`
2. route resolves caller identity
3. route applies rate limit
4. route delegates to `executeProxyCall(...)`
5. proxy execution performs:
   - auth-required gate
   - body-size guard
   - server lookup
   - stdio block / CLI handoff
   - tool existence check
   - confirmation-token verification
   - policy lookup
   - request DLP
   - sampling-injection detection
   - shell-injection detection
   - URL-elicitation checks
   - endpoint SSRF validation
   - credential injection
   - MCP initialize handshake for SSE / unknown transport
   - upstream `tools/call`
   - response security scans
   - metering / analytics / audit scheduling
   - structured auth / confirmation responses if needed
6. final response is returned to REST or MCP caller

### 7.2 Why all invocation paths converge here

`executeProxyCall(...)` is the core runtime chokepoint. It centralizes:

- auth enforcement
- policy enforcement
- vault-based credential injection
- security scanning
- metering
- analytics
- audit logging

This is one of the most important architectural facts in Relay.

## 8. Credential And Secret Flows

### 8.1 API-key-style secrets

Primary code:

- `src/app/api/secrets/route.ts`
- `supabase/migrations/011_vault_secrets.sql`

Flow:

1. authenticated user stores a secret with:
   - `server_name`
   - `secret_name`
   - `secret_value`
2. route checks per-user rate limit
3. route checks the 100-secret cap
4. route calls `store_user_secret(...)`
5. DB function stores secret in `vault.secrets`
6. metadata row is written to `user_secrets`
7. later, invoke-time credential injection uses:
   - `server_credential_hints`
   - `get_user_secret(...)`
8. decrypted value is injected into the upstream `Authorization` header

### 8.2 OAuth connections

Primary code:

- `src/app/api/oauth/start/route.ts`
- `src/app/api/oauth/callback/route.ts`
- `src/app/api/oauth/connections/route.ts`
- `supabase/migrations/012_oauth_connections.sql`

Flow:

1. authenticated user requests `/api/oauth/start?server=...`
2. route rate limits the request
3. route validates redirect target
4. route loads OAuth metadata from `servers`
5. route stores a CSRF `state` row in `oauth_states`
6. user is redirected to provider consent
7. provider redirects to `/api/oauth/callback`
8. callback validates state and expiry
9. callback loads provider token metadata from `servers` and the client secret from `OAUTH_SECRET_<SERVER_NAME>`
10. callback exchanges `code` for access token
11. callback calls `store_oauth_connection(...)`
12. tokens are stored in Vault, metadata in `user_oauth_connections`
13. later invoke-time credential injection calls `get_oauth_token(...)`
14. token is injected as `Authorization: Bearer <token>`

### 8.3 Credential hints

Primary tables / flows:

- `server_credential_hints`
- search response enrichment
- proxy-time 401 setup responses

Purpose:

- guide the user to configure the right secret without exposing raw credentials to the model

## 9. Policy And Confirmation Flows

Primary code:

- `src/app/api/policies/route.ts`
- `supabase/migrations/007_tool_policies.sql`
- `src/lib/proxy-execute.ts`
- `src/lib/utils.ts`

Flow:

1. user creates policy patterns:
   - `allow`
   - `confirm`
   - `block`
2. patterns are stored in `tool_policies`
3. invoke path calls `check_tool_policy(...)`
4. if blocked:
   - request ends with 403
5. if confirmation required:
   - proxy returns 202
   - signed confirm token is returned
6. caller resends with `X-Confirm-Token`
7. proxy verifies HMAC token using `verifyToken(...)`
8. invocation continues

## 10. Security Layers By Lifecycle Stage

### 10.1 Publish-time / manual submission security

Primary code:

- `src/lib/security.ts`
- `src/app/api/servers/route.ts`

Applies to:

- manual server publication

Checks:

- static prompt-injection patterns
- dangerous tool names
- insecure endpoint patterns
- typosquatting via SQL similarity RPC

### 10.2 Ingest-time security

Primary code:

- `src/lib/ingest.ts`
- `src/lib/security.ts`

Applies to:

- upstream-ingested servers

Checks:

- SSRF validation on endpoints
- transport detection
- MCP primitive probing
- README fallback parsing
- npm CVE scan
- high-severity status downgrades
- critical CVE rejection

### 10.3 Invoke-time security

Primary code:

- `src/lib/proxy-execute.ts`
- `src/lib/security.ts`

Checks:

- request DLP
- sampling injection
- shell injection
- URL elicitation
- response DLP
- PII leakage
- context leakage
- indirect injection in returned data
- bounded response size
- safe redirect handling

### 10.4 Drift-time security

Primary code:

- `src/lib/cron/schema-drift.ts`

Flow:

1. active HTTP-accessible servers are probed again
2. current tool set is re-hashed
3. hash is compared to `servers.schema_hash`
4. if changed:
   - tool descriptions are re-scanned
   - server is suspended
   - `scan_results` row is written

## 11. Ingest And Registry-Building Flow

Primary code:

- `src/lib/cron/ingest.ts`
- `src/lib/ingest.ts`
- `src/lib/mcp-probe.ts`
- `src/app/api/ingest/route.ts`

### 11.1 Trigger flow

1. cron or admin triggers ingest
2. `runIngest(source)` creates an `ingest_runs` row
3. source-specific fetchers collect upstream metadata
4. `upsertServers(...)` processes each candidate

### 11.2 Source intake

Active sources in `runIngest()`:

| Source | Tier | Notes |
|---|---|---|
| Official MCP Registry | Primary | Full endpoints + tool schemas |
| Smithery | Primary | Full endpoints + tool schemas + `verified` flag |
| Glama | Enrichment | Enriches existing rows via `github_url` |
| mcp.directory | Enrichment | Enriches existing rows via `github_url` |

Decommissioned (code may still reference, not wired into `runIngest()`):

- GitHub `modelcontextprotocol/servers` — no standard MCP listing API
- PulseMCP — public API returns 403
- ClaudeMCP — relied on fragile `__NEXT_DATA__` scraping
- MCP.so / mcpservers.org — no JSON API
- MCP.run / Composio — fetchers exist in code but not wired in

### 11.3 Upsert pipeline

Per server:

1. normalize and validate name
2. SSRF-check endpoint
3. detect transport
4. find existing server by:
   - source IDs
   - GitHub URL
   - endpoint
   - name
5. run the three-tier skip algorithm:
   - upstream timestamp skip
   - schema-hash skip
   - full processing if changed
6. if HTTP/SSE reachable:
   - probe with MCP initialize handshake
   - collect tools/resources/prompts
7. if stdio:
   - preserve row
   - optionally attempt sandbox extraction
   - fall back to README parsing
8. scan npm dependencies once per repo
9. enrich weak descriptions from README if needed
10. compute trust score using `computeTrustScore()` with `invokeCount: 0, successCount: 0` at ingest time — Bayesian prior gives a ~8pt floor ("unproven"), not zero ("broken"). Score grows as the uptime cron integrates real invoke data from `intent_server_mappings`
11. derive server status (`active` or `pending_review` for high-severity CVEs)
12. insert or update canonical `servers` row
13. write `scan_results` if needed

### 11.4 Why ingest matters architecturally

Relay search quality depends on registry quality. Ingest is not cosmetic metadata collection. It is the upstream truth-shaping layer for:

- server identity
- transport truth
- schema quality
- auth hints
- **initial trust score** (behavioral slot starts at ~8pts Bayesian floor; grows as invoke data accumulates)
- proxy availability

The behavioral reliability slot in the trust score means ingest quality and runtime quality are now coupled: the registry score is honest about what is known at listing time, and it improves automatically as agents use the server — no manual curation required.

## 12. MCP Probe Flow

Primary code:

- `src/lib/mcp-probe.ts`

Flow:

1. safe URL validation
2. `initialize` request
3. `notifications/initialized`
4. capabilities inspection
5. conditional `tools/list`
6. conditional `resources/list`
7. conditional `prompts/list`
8. transport detection
9. latency measurement

This probe logic is shared conceptually across:

- ingest
- uptime checks
- drift checks

## 13. Analytics And Learning Loop

Primary code:

- `src/lib/search-analytics.ts`
- `supabase/migrations/022_analytics_intelligence_layer.sql`

Primary tables:

- `search_events`
- `invoke_outcomes`
- `intent_server_mappings`
- `metering_events`
- `audit_log`

Flow:

1. search path records `search_events`
2. invoke path records `invoke_outcomes`
3. invoke path also records `metering_events`
4. invoke path updates `intent_server_mappings` through `record_intent_outcome(...)`
5. future searches call `get_intent_boosts(...)`
6. ranking becomes better over time

This is the live feedback loop that turns Relay from a static registry into a learning runtime.

## 14. Uptime And Trust Recalculation

Primary code:

- `src/lib/cron/uptime.ts`
- `src/lib/security.ts` (`computeTrustScore`)

Flow:

1. cron selects all active servers
2. for HTTP-capable servers: `probeUptime(...)` checks liveness and latency
3. EWMA uptime is updated
4. EWMA latency is updated
5. **behavioral data batch fetch**: cron queries `intent_server_mappings` for all active server names in one batch, building an `invokeCount`/`successCount` map
6. trust score is recomputed using the Bayesian behavioral model:
   - security quality (scan score)
   - uptime (EWMA)
   - publisher credibility (verified flag)
   - **behavioral reliability**: `(successCount + 3) / (invokeCount + 4) × log10(invokeCount + 5) × 15` — source-agnostic, from proxy invoke history
   - deployment quality (endpoint + inputSchema)
   - schema stability (days since schema_hash changed)
   - runtime penalties: failure rate (−15 max) + DLP rate (−10 max)
7. `scan_results` records the uptime outcome
8. `cron_job_runs` records the job result

Note: `stars` and Smithery `use_count` are **not** part of the trust score formula. `use_count` remains a search ranking tiebreaker only.

## 15. Operational Tracking And Cron Jobs

Primary tables / code:

- `ingest_runs`
- `cron_job_runs`
- `src/lib/cron/*.ts`
- `src/scripts/cron-*.ts`

Purpose:

- allow hosted cron and GitHub Actions execution
- persist operational outcomes for the admin surface
- keep maintenance jobs observable

## 16. Storage Map

### 16.1 Canonical system-of-record tables

- `servers`
- `profiles`
- `api_keys`
- `user_secrets`
- `user_oauth_connections`
- `tool_policies`
- `ingest_runs`
- `cron_job_runs`
- `search_events`
- `invoke_outcomes`
- `intent_server_mappings`
- `metering_events`
- `audit_log`
- `scan_results`
- `schema_snapshots`

### 16.2 Vault-backed secret material

- `vault.secrets`
- `vault.decrypted_secrets`

### 16.3 Disposable acceleration layers

- Upstash Redis
- in-memory LRU cache
- in-memory intent cache

## 17. Current Architectural Boundaries And Incomplete Edges

These are important because the system map should show both what exists and where the edges stop today.

- stdio discovery exists, but generalized stdio invocation depends on the future CLI bridge
- OAuth storage exists, but automatic refresh/retry is still roadmap work
- sampling protection exists, but stronger sampling governance is still incomplete
- learned routing does not yet replace lexical search; it is being bootstrapped through analytics
- some rate limits are DB-configurable and some are still route-local

## 18. Excalidraw Build Guidance

If you draw this on a single canvas, use these lanes from left to right:

1. Clients and entry surfaces
2. Control plane
   auth, rate limits, cache, policy, confirmation
3. Runtime plane
   search, invoke, secrets, OAuth injection, security scans
4. External execution plane
   MCP servers, provider OAuth endpoints, upstream APIs
5. Data plane
   Postgres, Vault, analytics, cron tracking
6. Maintenance plane
   ingest, probe, uptime, drift, trust recomputation

The companion `.excalidraw` scene gives you a starting layout, but this file is the real source for what each box and arrow should mean.
