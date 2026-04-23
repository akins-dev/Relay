# Agentrail / Relay — Architecture Deep-Dive
**Perspective: 10,000x engineer with full MCP protocol knowledge**
*Last updated: April 2026*
*Canonical technical reference: [`docs/TECHNICAL_BACKBONE.md`](docs/TECHNICAL_BACKBONE.md)*

> **Brand Identity**: All product names derive from `BRAND` constants safely in configuration.
> Active Brand: `Relay` / `Agentrail`
> CLI: `Relay CLI` | Vault: `Relay Vault` | Cloud: `Relay Cloud`

---

## 1. What We Are Building

An **agent-first runtime discovery and execution layer** for the MCP ecosystem — not a generic registry marketplace.

### The Core Insight

> "Agent development will never scale if every new capability still behaves like a 1:1 integration."

The core problem is the practical MCP cap. Long before the ecosystem runs out of servers, developers and agents hit a sanity ceiling: too many servers to configure explicitly, too much auth and transport complexity to manage manually, and too much context pressure when the exposed tool surface keeps growing.

Relay's current implementation solves this with two native MCP tools:
- `search_tools({ intent })` — find servers by what the agent needs to do
- `invoke_tool({ server, tool, args })` — invoke through a security proxy

The two-tool interface is the implementation approach, not the thesis by itself. The thesis is that the agent should do the heavy lifting at runtime instead of depending on ever-expanding explicit pre-configuration.

### The Problem Space

```
AI Agent (Claude / GPT / Gemini / local agent)
    │
    │  "Call the GitHub tool" — but which server? With what credentials?
    │  Is it safe? Has it been scanned for malware / injection?
    │  What if it's a stdio server running as a local process?
    │
    ▼
[ Relay ] ← This gap is what we fill
    │
    ├── Smithery   (5,000+ servers, mostly stdio, container bridge)
    ├── Glama      (14,000+ servers, quality-checked, HTTP-only view)
    ├── PulseMCP   (popularity signals, no proxy)
    └── Official   (registry.modelcontextprotocol.io, metadata only)
```

### Discovery: Explicit Runtime Connection

Agents connect directly to the Relay Cloud proxy without complex custom code. We support three primary connection workflows out of the box:

1. **Option 1: Native MCP Server** — Add the Relay `/api/mcp-server` URL directly into standard clients like Claude Desktop or Cursor for native `search_tools` and `invoke_tool`.
2. **Option 2: System Prompt (AGENTS.md)** — Point an LLM directly to our Markdown skill file to teach it how to search and invoke dynamically over HTTP.
3. **Option 3: REST API** — Standard cURL/fetch integration for custom framework builders.

*(Note: We also implement the experimental `/.well-known/mcp.json` protocol for next-generation fully autonomous agents capable of self-assembling registries, but the 3 methods above are the explicit standards used to connect today.)*

| Dimension | Smithery | Glama | Official Registry | **Relay** |
|---|---|---|---|---|
| Registry / discovery | ✅ | ✅ | ✅ | ✅ |
| Managed auth / connections | ✅ | ✅ | ❌ | ✅ |
| Gateway / control plane | ✅ | ✅ | ❌ | ✅ |
| Tool-level discovery | Partial | ✅ | ❌ | ✅ |
| Agent-centric runtime discovery by intent | Partial | Partial | ❌ | **Core thesis** |
| Constant model-facing surface as a first-class design goal | No public evidence | No public evidence | ❌ | **Core design choice** |
| Search -> invoke -> learn feedback loop | Partial | Partial | ❌ | **Core design choice** |

---

## 2. Current Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                         Next.js 14 App                          │
│                                                                 │
│  ┌─────────────┐   ┌──────────────┐   ┌─────────────────────┐  │
│  │  Dashboard  │   │  Public API  │   │   Cron Jobs         │  │
│  │  (React)    │   │  /api/servers│   │   - Ingest (daily)  │  │
│  │  - Keys     │   │  /api/search │   │   - Uptime (15min)  │  │
│  │  - Secrets  │   │  /api/proxy  │   │   - Schema-drift    │  │
│  │  - Policies │   │  /api/auth   │   │                     │  │
│  └─────────────┘   └──────────────┘   └─────────────────────┘  │
│                                                                 │
│  ┌─────────────────────────────────────────────────────────────┐│
│  │                    Security Layers                          ││
│  │  L1: Static scan   L4: DLP   L9: Sampling   S-12: Shell   ││
│  │  S-13: Indirect    L10: PII  L11: URL        L12: Leak     ││
│  │  S-14: CVE         L5: Trust Score            SSRF guard   ││
│  └─────────────────────────────────────────────────────────────┘│
│                                                                 │
│  │              Agent Integration Points                       ││
│  │  /api/mcp-server        (Option 1) Native MCP Server       ││
│  │  /agents.md             (Option 2) LLM system prompt       ││
│  │  /api/servers           (Option 3) Standard REST API       ││
│  │  /.well-known/mcp.json  (Experimental machine discovery)   ││
│  └─────────────────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────────────────┘
          │                            │
          ▼                            ▼
   ┌─────────────┐            ┌──────────────────┐
   │  Supabase   │            │  External Sources │
   │  - Postgres │            │  - Smithery API  │
   │  - Auth     │            │  - Glama API     │
   │  - Vault    │            │  - Official Reg  │
   │  - RLS      │            │  - PulseMCP      │
   └─────────────┘            │  - GitHub        │
                              └──────────────────┘

### Background Task Executor (GitHub Actions)
To bypass Vercel Hobby tier timeout limits (10s–60s) on background execution tasks, Relay natively utilizes **GitHub Actions (`.github/workflows/cron.yml`)** as an unlimited-minute, massive-scale cron executor.
- Runs purely via `bun run src/scripts/cron-*.ts`
- Bypasses HTTP API gateway timeouts completely.
- Directly manipulates the Supabase connection pools.
- Completely free for public repositories.

> **⚠️ Required Setup:** For the GitHub Actions cron to function properly, your repository must be **Public** (to receive unlimited free Action minutes and avoid the 2000-minute free-tier cap). Additionally, you must explicitly add the following values under **Settings** → (scroll down left sidebar to) **Secrets and variables** → **Actions** → **New repository secret**:
> - `NEXT_PUBLIC_SUPABASE_URL`
> - `SUPABASE_SERVICE_ROLE_KEY`
> - `SMITHERY_API_KEY` (Optional: if Smithery ingestion requires it)
> - `SANDBOX_URL` and `SANDBOX_AUTH_TOKEN` (Optional: required for Render Sandbox)

```

### What Works Well ✅

1. **Auth architecture** — Bearer-token-first with cookie fallback. Handles Next.js 14 chunked cookies.
2. **Security scanning depth** — deep and differentiated for the current MCP ecosystem.
3. **Vault integration** — AES-256-GCM via Supabase pgsodium. Correct approach.
4. **Trust score EWMA** — Exponential moving average prevents gaming by new servers.
5. **Policy system** — Allow/Confirm/Block per tool pattern is the right UX.
6. **Rate limiting** — Per-user vs per-IP tiering (200 req/min authed, 20 anonymous).
7. **Native MCP interface** — `search_tools` + `invoke_tool` eliminates REST integration work for agents.
8. **Three primary integration surfaces** — Native MCP Server (clients), `agents.md` (LLMs), and REST API (frameworks) cover every possible approach.
9. **Protocol compliance** — MCP initialize handshake, all 3 primitives (tools/resources/prompts), JSON-RPC.

---

## 3. Critical Architectural Gaps

### Gap 1: The Stdio Problem — Current Status

**The MCP ecosystem composition:**
- **~90% stdio servers** — run as local subprocesses, not HTTP-accessible
- **~9% SSE servers** — legacy HTTP, stateful
- **~1% Streamable HTTP servers** — the modern approach

**Current state:**
```
Discovery: ✅ ALL transports indexed (proxy_available=false for stdio)
Proxy:     ✅ HTTP + SSE servers proxied
stdio:     ⏳ Safe Invocation Hand-off Implemented
```

When an agent searches for a `stdio` server, the Native MCP `search_tools` function detects `proxy_available: false` and explicitly overrides the standard `usage` instruction. Instead of telling the agent to call the cloud proxy, it returns a structured prompt telling the agent exactly how to spawn the process locally natively: 
`This is a local stdio process. Run locally using: npx -y @relay/cli invoke <server> <tool>`

Additionally, if the agent accidentally attempts to call the Cloud Proxy for a stdio server, the `/api/proxy` endpoint safely blocks the execution and returns a deeply structured `400 Bad Request` containing a `cli_command` and `is_stdio: true` resolution flag, guaranteeing the agent immediately pivots to local execution.

**Relay CLI (planned)** — IS an MCP server. It speaks stdio natively to the agent host, and spawns other stdio servers on demand:
```
AI Agent → stdio → Relay CLI (running as MCP server in host config)
                     │
                     ├── search_tools() → calls Relay web API
                     │
                     └── invoke_tool()
                          ├── HTTP server → routes to web API proxy
                          └── stdio server → spawns local subprocess (e.g., npx -y @pkg)
                                             applies security scanning locally
                                             audits to registry async
```
**The `npx` Analogy:** The CLI doesn't "install" stdio servers permanently. It spawns them on demand, like `npx create-react-app` downloads and runs without a permanent `npm install`. The CLI manages the process lifecycle — spawn, use, recycle.

---

### Gap 2: Session Management (Stateless proxy on a stateful protocol)

Every tool call currently → `initialize` → `tools/call` → done. Extra round trip.

**What world-class looks like:**
```
┌──────────────────────────────────────────────────┐
│              Session Pool (per server)            │
│  Server A: [session-1 ✅] [session-2 ✅] [idle…]  │
│  On tool call: checkout warm session (0ms)        │
│  Send tools/call directly (no re-init)            │
│  Return session to pool                           │
└──────────────────────────────────────────────────┘
```

For Streamable HTTP 2025-03-26 servers: probe for stateless mode (skip init).

---

### Gap 2.5: Zero-Cost Lexical Retrieval + Reranking — ✅ ALREADY IMPLEMENTED

The `search_servers` Postgres function already uses the right zero-cost MVP approach:
1. **Postgres FTS** — `ts_rank(s.search_vector, plainto_tsquery('english', query_text))` with weighted tsvector columns
2. **pg_trgm trigram matching** — `similarity(s.name, query_text) > 0.15` for typo tolerance and fuzzy matching
3. **Tag ILIKE fallback** — catches category-level matches
4. **Ranking boost** — new servers (< 90 days) get a 1.0–1.4x boost to surface fresh additions

This gives strong intent-oriented lexical retrieval purely in SQL, with zero additional API costs or infrastructure.
It is not embedding-based semantic search. The semantic gap is closed later by behavioral reranking, learned routing, and eventually model weights.

### Gap 3: Streaming Response Support

MCP tool results can stream. Current bounded 10MB read blocks the stream.
**Missing:** SSE or chunked transfer encoding pass-through for streaming tool results.

---

### Gap 4: Behavioral Trust Signals

Current trust: `scan + uptime + stars + verified + stability`
**Missing:** Runtime behavioral signals:
- Tool call failure rate (DLP triggers per server / total calls)
- Response anomaly score (schema consistency)
- Latency stability (variance, not just avg)
- Agent-reported issues (feedback loop)

---

## 4. Security — Remaining Vulnerabilities

| Vulnerability | Severity | Status |
|---|---|---|
| tools/list without MCP handshake | 🔴 Critical | ✅ Fixed |
| Proxy used wrong URL format | 🔴 Critical | ✅ Fixed |
| No CORS policy on proxy | 🔴 High | ✅ Fixed |
| IPv4-mapped IPv6 loopback bypass | 🔴 High | ✅ Fixed |
| Redirect SSRF | 🔴 High | ✅ Fixed |
| text/html content-type forwarding | 🟡 Medium | ✅ Fixed |
| tools/list pagination truncation | 🟡 Medium | ✅ Fixed |
| stdio servers silently dropped | 🟡 Medium | ✅ Fixed |
| MCP sampling rate limiting | 🔴 High | 🔜 Sprint 3 |
| OAuth token refresh | 🟡 Medium | 🔜 Sprint 3 |
| Tool desc re-scan at proxy time | 🟡 Medium | 🔜 Sprint 3 |
| No streaming support | 🟡 Medium | 🔜 Sprint 4 |
| No session pooling | 🟢 Low | 🔜 Sprint 4 |
| No behavioral trust signals | 🟢 Low | 🔜 Sprint 6 |

---

## 5. CLI Architecture (Planned)

The CLI is planned, not built. When implemented it fills the stdio gap.

### What the CLI Will Do

```
┌─────────────────────────────────────────────────────────────────┐
│  Relay CLI — Three Roles in One                                  │
│                                                                 │
│  1. Developer Tool                                               │
│     relay publish              # publish server to registry      │
│     relay validate             # run L1-L14 scans locally        │
│     relay login                # auth with registry              │
│                                                                 │
│  2. Consumer Tool                                                │
│     relay search "database"    # find servers                    │
│     relay info postgres        # show schema, trust score        │
│                                                                 │
│  3. Native MCP Server (The exact optimal approach)               │
│     Agent configures: `npx -y @relay/cli serve`                  │
│     Agent gets: search_tools + invoke_tool natively              │
│     - HTTP calls route to Cloud Proxy                            │
│     - Stdio calls spawn local subprocesses dynamically           │
└─────────────────────────────────────────────────────────────────┘
```
*Note on Credentials:* The CLI does NOT need a local secret store. It fetches user credentials securely from the centralized Relay Cloud Vault via the REST API when needed. Centralized control, local execution.

---

## 6. SDKs (Planned)

### TypeScript SDK
```typescript
import { RelayClient } from '@relay/sdk';

const client = new RelayClient({ apiKey: 'sk_mcp_...' });

// Search
const servers = await client.search('send transactional email');

// Invoke
const result = await client.invoke('sendgrid-mail', 'send_email', {
  to: 'user@example.com',
  subject: 'Order confirmed',
  body: 'Thank you!'
});
```

### Python SDK
```python
from relay import RelayClient

client = RelayClient(api_key="sk_mcp_...")

# Search
servers = client.search("send transactional email")

# Invoke
result = client.invoke("sendgrid-mail", "send_email",
    to="user@example.com",
    subject="Order confirmed",
    body="Thank you!"
)
```

Both SDKs wrap the REST API and handle:
- Authentication (Bearer token)
- Retry with exponential backoff
- Response header extraction (trust score, DLP warnings)
- Type-safe tool argument validation against inputSchema

---

## 7. Complete Implementation Roadmap

### ✅ Sprint 1 — Core Protocol Correctness (DONE)
- [x] MCP initialize handshake in probe (`mcp-probe.ts`)
- [x] `tools/call` via JSON-RPC single endpoint (not REST URL)
- [x] Resources + Prompts proxy routes
- [x] tools/list pagination with nextCursor
- [x] All 3 MCP primitives (tools/resources/prompts) fetched and stored
- [x] Stdio servers ingested for discovery (`proxy_available=false`)
- [x] Redirect SSRF guard (`redirect: 'manual'` + location validation)
- [x] Content-type sanitization (`X-Content-Type-Options: nosniff`)

### ✅ Sprint 2 — Discovery & Security Hardening (DONE)
- [x] `GET /.well-known/mcp.json` runtime discovery document
- [x] CORS policy with explicit allowlist (`corsHeaders()`)
- [x] IPv6 SSRF completion (ffff-mapped loopback, link-local, unique-local)
- [x] OPTIONS preflight handler on proxy routes
- [x] `proxy_available` field on all ingested servers
- [x] Bearer-token-first auth across all routes
- [x] Ingest bugs fixed (description fallback, stdio indexed, no_tools not hard-rejected)
- [x] Boot-time Zod environment variable parsing (`src/lib/env.ts` / `instrumentation.ts`)

### 🔜 Sprint 3 — Sampling Security + OAuth Refresh (1-2 weeks)
- [ ] `sampling/createMessage` rate limiting (max 5/min per server)
- [ ] Sampling audit log — record every server-initiated LLM call
- [ ] OAuth token refresh in proxy (detect 401 → refresh → retry once)
- [ ] Schema-drift cron re-scans tool descriptions for injection (not just at ingest)
- [ ] Regenerate Supabase TypeScript types (fix all `never` errors)

### 🔜 Sprint 4 — Streaming + Session Optimization (2-3 weeks)
- [ ] SSE pass-through for streaming tool results (chunked transfer)
- [ ] Stateless probe mode for 2025-03-26 servers (skip initialize if stateless)
- [ ] Session warm cache (Upstash Redis): reuse initialized sessions for 5min
- [ ] `progress` notification handling

### 🔜 Sprint 5 — CLI as Native MCP Server (3-4 weeks)
- [ ] `@relay/cli` npm package
- [ ] `relay search/info/login/publish` commands
- [ ] `relay serve` — starts as native MCP server over stdio
- [ ] Subprocess lifecycle manager (the `npx` style runner)
- [ ] Local DLP + policy enforcement (offline security)
- [ ] Async audit log sync to registry

### 🔜 Sprint 6 — SDKs + Publisher Tooling (4-6 weeks)
- [ ] `@relay/sdk` TypeScript SDK
- [ ] `relay` Python SDK (PyPI)
- [ ] Verified Publisher Program (GitHub OIDC signing)
- [ ] `relay publish` + `relay validate` CLI commands
- [ ] Tool Schema Registry (versioned JSON Schema store)
- [ ] Behavioral trust signals (call failure rate, DLP trigger rate)

### 🔜 Sprint 7 — Cloud stdio Bridge (6-8 weeks)
- [ ] Container-based stdio bridge (Fly.io Machines)
- [ ] Cold start < 3s, warm < 100ms target
- [ ] Container pool per server (scale-to-zero)
- [ ] Usage-based billing

---

## 8. The One Metric That Matters

> **% of the MCP ecosystem reachable via this registry**

| Stage | Reachable | Latency |
|---|---|---|
| Before this session | ~1% (HTTP only, many skipped) | ~1,200ms (re-init every call) |
| After Sprint 2 (now) | ~100% discoverable, ~10% proxiable | ~600ms |
| After Sprint 4 (session cache) | ~10% proxiable, cached warm | ~50ms |
| After Sprint 5 (CLI bridge) | ~100% invocable (stdio via CLI) | ~20ms local |
| After Sprint 7 (cloud bridge) | ~100% invocable without CLI | ~100ms cloud |

The CLI bridge is the fastest path to 100% ecosystem coverage at near-zero infrastructure cost.

---

## 9. Architecture Scaling & Infrastructure Decisions

### High-Performance Proxy Hot Path
Every HTTP request routing through the active MCP proxy is rigorously decoupled from database bottlenecks.
- **Edge LRU Poly-Cache**: High-frequency metadata (server configurations, active policies, vault API keys) are fully cached at the route level via Upstash Redis or memory LRU fallback, achieving $O(1)$ read guarantees and reducing database round-trips from ~8 to 0 per call.
- **Asynchronous Telemetry Decoupling**: Metering, analytical metrics (latency EWMA), and dual-audit inserts are shifted into Next.js background workers via `unstable_after()`, immediately freeing the HTTP response cycle and erasing over 150ms of rigid latency from all LLM workflows.

### Event Loop ReDoS Protection
Node.js regex processing executes synchronously on the main thread, introducing ReDoS and event-loop exhaustion vulnerabilities against large server outputs (bounded to 10MB). In Relay, deep payload inspections (DLP, PII, context isolation, prompt injection) securely evaluate inputs within strict spatial slices (first 100KB and last 50KB limits). This comprehensively covers margins where data tends to cluster while preemptively neutralizing complexity-driven DoS operations without dragging the active loop.

### Pagination Sinkhole Mitigation
When dynamically fetching `tools/list` natively on ingestion or discovery polling, cursor pagination operates definitively under a strict $O(1)$ upper boundary limit (e.g. maximum 20 HTTP request recursions and 500 element bounds). This guarantees robust defense against memory saturation vectors caused by misconfigured or rogue servers offering infinite schemas.

### Three-Tier Skip Algorithm (Ingestion)

The ingestion pipeline uses a three-tier skip strategy to minimize wasted work:

| Tier | Trigger | Cost | What it checks |
|------|---------|------|----------------|
| **T1: Fresh** | `upstream_updated_at ≤ last_scanned_at` | **O(1)** — timestamp comparison | Upstream source hasn't changed since our last scan |
| **T2: Unchanged** | Hash match + scanned < 24h ago | **O(T log T)** — hash computation | Tools, version, endpoint, github_url unchanged |
| **T3: Full** | New or changed server | **O(T + D + P×F)** — full pipeline | MCP probe, security scan, CVE scan, upsert |

Where: T = tools count, D = npm dependencies, P = security patterns, F = fields scanned.

**Space complexity:** O(5E + R) where E = existing servers, R = unique repos.

**Result:** ~80% of servers skip at Tier 1 on re-ingests, eliminating hash computation entirely.

### CVE Scan Deduplication

Multiple servers can share the same GitHub repository. The pipeline deduplicates CVE scans by repo URL, scanning each unique repo only once per ingest run.
