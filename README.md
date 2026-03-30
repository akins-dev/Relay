# ⬡ openMCP

**The secure, open-source MCP registry. Free forever.**

> "Agent development will never scale treating every tool integration as a 1:1 integration."

Break the 30-tool limit. Any agent discovers thousands of scanned MCP servers at runtime — by intent, through a 15-layer security proxy, zero pre-configuration.

[![License: MIT](https://img.shields.io/badge/License-MIT-e8673a.svg)](LICENSE)
[![Next.js](https://img.shields.io/badge/Next.js-14.2.25-black)](https://nextjs.org)
[![Supabase](https://img.shields.io/badge/Supabase-Postgres-3ECF8E)](https://supabase.com)

---

## Core vision

Today's agents are bottlenecked at 30 tools, pre-loaded by a human before the agent ever runs, competing for context window space with every tool that gets added. Nobody solved this — universal MCP servers still pre-load a fixed catalog. openMCP removes the constraint entirely: agents describe what they need at runtime, get exactly those tools with full schemas, invoke through a 15-layer security proxy, and never pre-load anything. The context window cost is always exactly two tools — search and invoke.

openMCP is the registry layer: one endpoint, semantic discovery, full tool schemas returned, every server scanned across 15 security layers before listing, every call proxied through DLP and injection detection.

**Not an auth platform.** Not a developer marketplace. The public, open, security-native discovery and proxy layer — the npm registry for MCP.

---

## Connect your agent

### Option 1 — Native MCP server (Claude Desktop, Cursor, Antigravity, Claude Code)

```json
{
  "mcpServers": {
    "openmcp": {
      "url": "https://openmcp.dev/api/mcp-server"
    }
  }
}
```

Your agent gets two tools: `search_tools(intent)` and `invoke_tool(server, tool, args)`.

### Option 2 — System prompt / AGENTS.md

```
You have access to openMCP at https://openmcp.dev.
Read https://openmcp.dev/openmcp.md before your first tool call.
Search:  GET https://openmcp.dev/api/servers/search?q={intent}
Invoke:  POST https://openmcp.dev/api/proxy/{serverName}/{toolName}
```

### Option 3 — REST API

```bash
# Discover by intent — returns full inputSchema per tool
curl "https://openmcp.dev/api/servers/search?q=send+transactional+email"

# Invoke through the 15-layer security proxy
curl -X POST "https://openmcp.dev/api/proxy/sendgrid-mail/send_email" \
  -H "Content-Type: application/json" \
  -d '{"to": "user@example.com", "subject": "Hello", "body": "..."}'
```

---

## Credentials — openMCP Vault

Most MCP servers require API keys. Store them once in the openMCP Vault. The proxy decrypts and injects at call time — your agent never sees the raw value. You can view the secret name but not the value after saving.

**One-time setup per service:**

1. Get your API key from the service dashboard
2. Go to [openmcp.dev/dashboard/secrets](https://openmcp.dev/dashboard/secrets)
3. Enter the server name, the suggested variable name (shown in any 401 response), and your key
4. Done — every future call through openMCP injects it automatically

**What happens on every call:**

```
Agent: POST /api/proxy/stripe-payments/charge_card {"amount": 4900}
  ↓
openMCP Proxy: decrypts STRIPE_PAYMENTS_API_KEY from vault (AES-256-GCM)
  ↓
Upstream server: receives Authorization: Bearer sk_live_...
  ↓
Agent: gets {"charge_id": "ch_..."} — key never in context, logs, or arguments
```

If a call returns 401, the response includes the exact secret name and a direct dashboard link.

---

## Security

Every server scanned before listing. Every proxy call inspected.

**Publish-time (per ingested server):**
- L1 Static scan — prompt injection, exfiltration patterns, deceptive tool descriptions
- L3 Schema pinning — SHA-256 hash; any mutation auto-suspends the server
- L8 Typosquatting — pg_trgm similarity blocks impersonation at publish time
- S-14 npm CVE scan — package.json checked against npm advisory database

**Runtime proxy (per call):**
- L4 DLP — 11 credential patterns on request and response
- S-12 Shell injection — 18 OS command patterns (43% of MCP CVEs are this class)
- S-13 Indirect injection — instruction language in response data
- L9 Sampling inspection — server-initiated LLM call hijacking
- L10 PII detection — email, phone, SSN, card numbers in responses
- L11 URL elicitation — SSRF, javascript:, file:// blocked
- L12 Context isolation — session tokens leaking in responses

**Infrastructure:**
- L5 Trust score — 0–100 composite: scan quality + uptime + schema stability + community signals
- L6 Supabase RLS — database-level enforcement on all tables
- L7 OAuth 2.1 + PKCE — Supabase Auth, no localStorage tokens

Current OWASP MCP Top 10 coverage: **~70%**. Target: 90%+ with WASM sandbox (L2).

**What happens to threatening servers:**
- Critical scan issue or critical CVE → `rejected` — never listed
- High severity issues → listed with lower trust score + visible scan warning
- Schema mutation detected by drift cron → auto-suspended, re-queued for scan
- Runtime anomaly (DLP triggers, injection attempts) → flagged for human review

---

## Setup

### 1. Clone and install

```bash
git clone https://github.com/the-17/openmcp
cd openmcp
bun install   # or: npm install
```

### 2. Supabase

Create a project at [supabase.com](https://supabase.com). Run migrations in order in the SQL Editor:

```
supabase/migrations/001_initial_schema.sql      ← full schema, RLS, FTS, RPCs
supabase/migrations/002_seed_data.sql           ← 8 demo servers for local dev (sign up first)
supabase/migrations/003_source_and_cve.sql      ← source provenance + CVE fields
supabase/migrations/004_mcp_server_and_schemas.sql ← tool schemas + mcp_connections
supabase/migrations/005_metering.sql            ← per-call metering + revenue views
supabase/migrations/006_analytics.sql           ← analytics views (server health, platform KPIs)
supabase/migrations/007_tool_policies.sql       ← user-controlled CRUD permission layer
supabase/migrations/008_anomaly_detection.sql   ← suspicious traffic views
```

> **Note on 002:** Seed data is for local development only — it gives you 8 demo servers so the UI is not empty while developing. Once ingest runs, seeded servers are replaced by real data. You can skip 002 in production.

### 3. Environment

```bash
cp .env.example .env.local
```

| Variable | Required | Description |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Yes | Your Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Yes | Supabase anon key (safe to expose) |
| `SUPABASE_SERVICE_ROLE_KEY` | Yes | Service role key (never expose) |
| `CRON_SECRET` | Yes | Any random string — protects cron routes |
| `SMITHERY_API_KEY` | Optional | Free at smithery.ai — needed for Smithery ingest |
| `UPSTASH_REDIS_REST_URL` | Optional | Production rate limiting (console.upstash.com) |
| `UPSTASH_REDIS_REST_TOKEN` | Optional | Required with above |

### 4. Run

```bash
bun dev
# → http://localhost:3000

# Sign up at /login, then re-run 002_seed_data.sql in Supabase SQL Editor
```

---

## Ingest

Ingest pulls from five sources, scans everything, and upserts into Supabase.

```bash
# Ingest all sources at once (recommended)
curl -X POST http://localhost:3000/api/ingest \
  -H "Authorization: Bearer your-cron-secret" \
  -H "Content-Type: application/json" \
  -d '{"source": "all"}'

# Or trigger individual sources:
# "official"  — MCP official registry (~87 servers, highest trust, no key needed)
# "smithery"  — 7,300+ servers (SMITHERY_API_KEY required)
# "glama"     — 14,274 servers (no key needed)
# "pulsemcp"  — 11,800+ servers (no key needed)
# "github"    — curated github.com/modelcontextprotocol/servers
  -d '{"source": "official"}'
```

> **Production:** ingest runs automatically every night at 2am UTC via Vercel cron — you do not need to trigger it manually after deploy.

Expected response:
```json
{
  "success": true,
  "results": {
    "official":  { "fetched": 87,    "added": 82,    "updated": 3, "rejected": 2 },
    "smithery":  { "fetched": 7300,  "added": 6100,  "rejected": 180 },
    "glama":     { "fetched": 14274, "added": 11000, "rejected": 420 },
    "pulsemcp":  { "fetched": 11800, "added": 9000,  "rejected": 310 },
    "github":    { "fetched": 87,    "added": 80,    "rejected": 5 }
  }
}
```

---

## Tests

```bash
bun test
# 40+ unit tests across all 15 security layers with real attack payloads
```

---

## Deploy

```bash
vercel --prod
```

Set all environment variables in Vercel dashboard. Crons run automatically on Vercel Pro:
- Schema drift check: every 6h
- Uptime check: every 15min
- Daily call reset: midnight UTC
- Ingest all sources: 2am UTC

---

## API Reference

```
GET  /openmcp.md                              Agent skill file — fetch once, understand everything
GET  /api/mcp                                 Registry info, security layer list, agent prompt template
GET  /api/servers/search?q={intent}&limit=5   Semantic search — full inputSchema per tool returned
GET  /api/servers?sort=trust&verified=true    Browse with filters
GET  /api/servers/:name                       Server detail, scan history, CVE issues
POST /api/proxy/:serverName/:toolName         15-layer security proxy — every call inspected
POST /api/mcp-server                          Native MCP server (StreamableHTTP)
GET  /api/mcp-server                          Native MCP server (SSE — for older clients)
POST /api/ingest                              Trigger ingest (CRON_SECRET required)
```

---

## Trust scores

Every server has a 0–100 trust score returned with every search result.

| Component | Weight | What it measures |
|---|---|---|
| Scan quality | 30 | Static scan + CVE scan result quality |
| Verified publisher | 25 | Publisher completed identity verification |
| Uptime | 20 | 30-day uptime measured every 15 minutes |
| Schema stability | 15 | Days since last schema change |
| Community | 10 | Stars, call volume |

**New servers:** get a discovery boost for 90 days — surfaced alongside top servers in their category with a "New" badge. Trust score stays honest; ranking gives them visibility.

**Category balance:** if a category has 5+ servers above trust score 85, lower-scored servers in that niche are surfaced in search results. High-trust monopolies do not crowd out legitimate alternatives.

---

## Open source

MIT licensed. Fork it, self-host it, contribute back.

The security claims are auditable — read the scanner in `src/lib/security.ts`. Not a promise, not a marketing statement. The code is right there.

The moat is not the code. It is the accumulated trust scores, scan history, uptime records, and publisher relationships — none of which live in any repository.

---

## License

MIT — Built by [The-17](https://github.com/the-17)
