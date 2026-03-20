# ⬡ openMCP

**The autonomous MCP discovery & security platform.**

> "Agent development will never scale treating every tool integration as a 1:1 integration."

One line in your system prompt. Any AI agent discovers and invokes 7,000+ verified MCP servers at runtime — by intent, through a 15-layer security proxy, zero pre-configuration.

[![License: MIT](https://img.shields.io/badge/License-MIT-e8673a.svg)](LICENSE)
[![Next.js 14](https://img.shields.io/badge/Next.js-14-black)](https://nextjs.org)
[![Supabase](https://img.shields.io/badge/Supabase-Postgres-3ECF8E)](https://supabase.com)

---

## Three ways to connect

### 1. As a native MCP server (recommended for agents)

One config line. Every tool.

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

### 2. Via system prompt / AGENTS.md

```
You have access to openMCP at https://openmcp.dev.
Read https://openmcp.dev/openmcp.md before your first tool call.
```

### 3. REST API directly

```bash
# Discover by intent
curl "https://openmcp.dev/api/servers/search?q=send+transactional+email"

# Invoke through security proxy
curl -X POST "https://openmcp.dev/api/proxy/sendgrid-mail/send_email" \
  -H "Content-Type: application/json" \
  -d '{"to": "user@example.com", "subject": "Hello", "body": "..."}'
```

---

## Why this exists

Smithery, Arcade, Composio — all require a human to configure connections before an agent can use them. That model doesn't scale.

openMCP is the layer between those platforms and your agents:

```
Official Registry + Smithery + Glama + GitHub
              ↓  (nightly ingest + scan)
         openMCP
         - 15-layer security scan on every server
         - Schema pinning (rug-pull protection)
         - DLP proxy on every call
         - Trust scores 0–100
         - Full audit trail
              ↓
         Your agents (one connection)
```

---

## Security Stack

**Publish-time (every ingested server):**
- L1 Static scan — prompt injection, exfiltration, deceptive language
- L3 Schema pinning — SHA-256 hash, auto-suspend on any mutation
- S-14 npm CVE scan — package.json checked against npm advisory database
- L8 Typosquatting — pg_trgm blocks impersonation names

**Runtime proxy (every call):**
- L4 DLP — 11 credential patterns on request + response
- S-12 Shell injection — 18 OS command patterns (the 43% CVE class)
- S-13 Indirect injection — 12 instruction patterns in response data
- L9 Sampling inspection — server-initiated LLM call inspection
- L10 PII detection — email, phone, SSN, card numbers
- L11 URL elicitation — SSRF, javascript:, file:// blocked
- L12 Context isolation — session tokens in responses

**Infrastructure:**
- L5 Trust score — 0–100 composite, returned on every search result
- L6 Supabase RLS — database-level enforcement on all tables
- L7 OAuth 2.1 + PKCE — Supabase Auth, PKCE on every flow

Current OWASP MCP Top 10 coverage: **~70%**. Target: 90%+ with L2 WASM sandbox.

---

## Stack

| Layer | Technology |
|-------|-----------|
| Framework | Next.js 14 App Router |
| Database | Supabase (Postgres + RLS + pg_trgm + FTS) |
| Auth | Supabase Auth (cookie-based, PKCE) |
| Deployment | Vercel |
| Package manager | Bun |

---

## Setup

### 1. Clone and install

```bash
git clone https://github.com/akins-dev/openmcp
cd openmcp
bun install
```

### 2. Supabase

Create a project at [supabase.com](https://supabase.com). In the SQL Editor, run migrations in order:

```
supabase/migrations/001_initial_schema.sql
supabase/migrations/002_seed_data.sql
supabase/migrations/003_source_and_cve.sql
supabase/migrations/004_mcp_server_and_schemas.sql
supabase/migrations/005_metering.sql
```

### 3. Environment

```bash
cp .env.example .env.local
```

```env
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your_anon_key
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key
CRON_SECRET=your_random_cron_secret
SMITHERY_API_KEY=your_smithery_key   # free at smithery.ai
```

### 4. Run

```bash
bun dev
# → http://localhost:3000
```

Sign up at `/login`, then re-run `002_seed_data.sql` to seed demo servers.

---

## Ingest

```bash
# Trigger manually (or wait for nightly cron at 2am UTC)
curl -X POST http://localhost:3000/api/ingest \
  -H "Authorization: Bearer your-cron-secret" \
  -H "Content-Type: application/json" \
  -d '{"source": "official"}'

# Sources: "official" | "smithery" | "glama" | "pulsemcp" | "github" | "all"
```

---

## Tests

```bash
bun test
# Runs 40+ unit tests across all 15 security layers
```

---

## Deployment

```bash
vercel --prod
```

Set the same env vars in Vercel dashboard. Crons run automatically:
- Schema drift: every 6h
- Uptime check: every 15min
- Daily reset: midnight UTC
- Ingest: 2am UTC

---

## API Reference

```
GET  /openmcp.md                          Agent skill file (fetch once)
GET  /api/mcp                             Registry info + agent prompt template
GET  /api/servers/search?q={intent}       Semantic search with tool schemas
GET  /api/servers?sort=trust&verified=true Browse with filters
GET  /api/servers/:name                   Server detail + scan history
POST /api/proxy/:serverName/:toolName     Invoke through security proxy
POST /api/mcp-server                      Native MCP server (StreamableHTTP)
GET  /api/mcp-server                      Native MCP server (SSE)
POST /api/ingest                          Trigger ingest (CRON_SECRET required)
GET  /connect                             Connection snippets for all frameworks
```

---

## License

MIT — Built by [Akinbobola Emmanuel](https://github.com/akins-dev)
