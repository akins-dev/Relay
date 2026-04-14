# ⬡ Relay

**The secure, runtime discovery and invocation layer for MCP servers.**

> "Agent development will never scale if we treat every new tool as a hard-coded 1:1 integration."

[![License: Apache 2.0](https://img.shields.io/badge/License-Apache_2.0-e8673a.svg)](LICENSE)
[![Next.js](https://img.shields.io/badge/Next.js-14.2.25-black)](https://nextjs.org)
[![Supabase](https://img.shields.io/badge/Supabase-Postgres-3ECF8E)](https://supabase.com)

---

## The Problem: The Context & Security Bottleneck

Currently, AI agents are strictly bottlenecked by human pre-configuration. To interact with the outside world, a developer must manually discover, configure, and inject entire Model Context Protocol (MCP) tool schemas into an agent's context window **before** it ever runs. 

As an agent's capabilities grow, injecting dozens of massive tool schemas wastes huge portions of the LLM's context window. This constraint drives up token costs, significantly increases latency, and degrades the agent's reasoning focus, which inevitably leads to severe hallucinations. Worse yet, giving an autonomous agent unmitigated access to unverified remote tools presents a massive security vector. The friction of the current static MCP ecosystem fundamentally limits autonomous workflows.

## The Vision: Relay

**Relay completely breaks the 30-tool context ceiling.**

Relay is a secure runtime discovery tool that allows AI agents to query and discover tools purely by intent. Instead of manually selecting and pre-loading static toolsets, agents use Relay to dynamically discover exactly what they need, the moment they need to solve a user's problem. 

This architectural shift grants agents access to thousands of MCPs instantly while permanently keeping their context window light (reducing the cognitive load and resulting hallucinations). The context window cost is forever reduced to exactly two meta-tools: `search` and `invoke`.

Most importantly, Relay acts as the immutable bridging layer—ensuring strict data loss prevention (DLP), payload injection detection, and repository trust-scoring. Relay empowers true autonomous agentic scale without compromising security.

---

## Open source

Apache 2.0 licensed. Fork it, self-host it, contribute back.

The security claims are auditable — read the scanner in `src/lib/security.ts`. Not a promise, not a marketing statement. The code is right there.

Today Relay focuses on remote MCP servers with HTTP endpoints. Local `stdio` support is planned via the upcoming local CLI.

**Not an auth platform.** Not a developer marketplace. The public, open, security-native discovery and proxy layer — the npm registry for MCP.

---

## Connect your agent

### Option 1 — Native MCP server (Claude Desktop, Cursor, Antigravity, Claude Code)

```json
{
  "mcpServers": {
    "relay": {
      "url": "https://relay.agentrail.dev/api/mcp-server"
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

# Invoke through the secure proxy
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
- L4 DLP — 11 credential patterns blocked on requests; response matches surfaced via warning headers and audit logs
- S-12 Shell injection — 18 OS command patterns (43% of MCP CVEs are this class)
- S-13 Indirect injection — instruction language in response data
- L9 Sampling inspection — server-initiated LLM call hijacking
- L10 PII detection — email, phone, SSN, card numbers scanned in responses
- L11 URL elicitation — SSRF, javascript:, file:// blocked
- L12 Context isolation — session tokens leaking in responses

**Infrastructure:**
- L5 Trust score — 0–100 composite: scan quality + uptime + schema stability + community signals
- L6 Supabase RLS — database-level enforcement on all tables
- L7 OAuth connection security — validated redirects, state verification, encrypted token storage

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
supabase/migrations/009_transport_and_stdio_filter.sql ← transport metadata + stdio exclusion in agent search
supabase/migrations/010_auth_transparency_and_audit_public.sql ← auth metadata + public transparency views
supabase/migrations/011_vault_secrets.sql       ← vault-backed secret storage (read header before running)
supabase/migrations/012_oauth_connections.sql   ← per-user OAuth connections stored in vault
supabase/migrations/013_mcp_compliance_fields.sql ← MCP compliance fields
supabase/migrations/014_mcp_primitives_fields.sql ← MCP primitives (resources, prompts)
supabase/migrations/015_final_schema_fixes.sql  ← schema alignment fixes
supabase/migrations/016_fix_global_stats.sql    ← global_stats RPC fix
supabase/migrations/017_dedup_by_github_url.sql ← cross-source dedup by GitHub URL
supabase/migrations/018_operations_tracking.sql ← cron job tracking, upstream timestamps, admin ops views
```

> **Note on 002:** Seed data is for local development only — it gives you 8 demo servers so the UI is not empty while developing. Once ingest runs, seeded servers are replaced by real data. You can skip 002 in production.
>
> **Note on 011:** Read the header first and confirm your Supabase project keeps statement logging at `ddl` or `none`. This is an ongoing operational requirement for any route that stores secrets or OAuth tokens, not just a one-time migration concern.

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
| `NEXT_PUBLIC_ADMIN_UID` | Optional | Supabase Auth user ID allowed to open `/admin` and trigger admin-only ingest |

**Startup Validation:** The application uses Zod to automatically validate `.env` files upon boot. If any required variables are missing (e.g. `SUPABASE_SERVICE_ROLE_KEY` or `CRON_SECRET`), the Next.js process will instantly gracefully crash with a detailed error log indicating exactly which fields you forgot to set!

### 4. Run

```bash
bun dev
# → http://localhost:3000

# Sign up at /login, then re-run 002_seed_data.sql in Supabase SQL Editor
```

---

## Admin Panel

The admin dashboard lives at `/admin`.

- If you are not signed in, `/admin` redirects to `/login`.
- If you are signed in with the wrong account (UID doesn't match), it will redirect you away from the admin dashboard back to the landing page or a protected area.

**How to configure admin access:**
1. Navigate to **Supabase Dashboard** → **Authentication** → **Users**.
2. Find your personal administrative user account.
3. Copy the **User UID** string.
4. Set it exactly as `NEXT_PUBLIC_ADMIN_UID` in your environment (`.env`).

Admin-triggered ingests use `POST /api/admin/ingest`, which validates the signed-in user server-side before running.

---

## Sandbox Service

To support `stdio`-based servers properly via isolated Docker execution, Relay utilizes a lightweight Node.js Express microservice located in the `/sandbox` folder.

If a repository is ingested without a configured Sandbox, Relay will safely fall back to parsing its `README.md` for tool hints. However, it will not natively extract active JSON schemas until you set up the sandbox.

**Deployment & Usage:**
1. See `sandbox/README.md` for a complete step-by-step guide to deploying this microservice to Render.com natively using Docker.
2. Once deployed, update your primary Relay frontend `.env`:
   - `SANDBOX_URL=https://your-sandbox-deployment.onrender.com`
   - `SANDBOX_AUTH_TOKEN=your-randomly-generated-secret`
3. **Important:** If you configure the sandbox *after* you have already ingested servers, you **must flush your active servers** from the database before re-triggering ingestion! Since the Three-Tier Ingestion Skip algorithm perfectly tracks upstream hash mutations, it will instantly `[SKIP:fresh]` unchanged servers without pinging the Sandbox if you do not delete them first.

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
  "message": "Ingest completed for all configured sources. 33548 fetched 26182 added 3 updated 6417 skipped 917 rejected 2 errors",
  "run": {
    "id": "run_123",
    "source": "all",
    "started_at": "2026-04-13T09:00:00.000Z",
    "finished_at": "2026-04-13T09:04:12.000Z",
    "duration_ms": 252000
  },
  "results": {
    "official": {
      "fetched": 87,
      "added": 82,
      "updated": 3,
      "skipped": 0,
      "rejected": 2,
      "error_count": 0
    },
    "github": {
      "fetched": 87,
      "added": 80,
      "updated": 0,
      "skipped": 2,
      "rejected": 5,
      "error_count": 0
    }
  },
  "total": {
    "sources_processed": 2,
    "servers_found": 174,
    "servers_added": 162,
    "servers_updated": 3,
    "servers_skipped": 2,
    "servers_rejected": 7,
    "errors": 0
  }
}
```

The response is pretty-printed JSON and only includes per-source totals, not individual server names.

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

Set all environment variables in Vercel dashboard.

**Cron Job Notice (Vercel Hobby vs Pro):**
By default, Vercel Hobby has a 10s-60s max execution limit. This means heavy cron jobs like Ingestion, Schema Drift checking (which polls thousands of active endpoints), and Uptime checks *will* fail if running strictly on Hobby via API routes.
To bypass this, openMCP runs perfectly on **GitHub Actions CLI scripts** to effortlessly hit the Supabase database and bypass any serverless wall-clocks infinitely for zero cost! (Check `.github/workflows`).

- Schema drift check: every 6h
- Uptime check: every 15min
- Daily call reset: midnight UTC
- Ingest all sources: 2am UTC

---

## ⚠️ Pre-Production Checklist

**MUST DO before going live.** This checklist ensures the registry starts clean with real data.

### 1. Delete all development/test servers

```sql
-- Run in Supabase SQL Editor:
DELETE FROM public.scan_results;
DELETE FROM public.schema_snapshots;
DELETE FROM public.cron_job_runs;
DELETE FROM public.ingest_runs;
DELETE FROM public.servers;
```

### 2. Re-ingest from all sources (fresh)

```bash
# Ingest one source at a time to monitor each:
curl -X POST http://localhost:3000/api/ingest \
  -H "Authorization: Bearer $CRON_SECRET" \
  -H "Content-Type: application/json" \
  -d '{"source": "official"}'

# Then: smithery, glama, pulsemcp, github (one at a time)
```

### 3. Deploy the Render Sandbox (Optional but highly recommended)

If you are scraping sources with `stdio` servers (like Smithery or GitHub official), you need the Sandbox to run the underlying code securely.
1. Deploy the `/sandbox` folder to Render natively (See `sandbox/README.md`)
2. Add `SANDBOX_URL` and `SANDBOX_AUTH_TOKEN` to your `.env`
3. If you previously ingested without the sandbox, run `DELETE FROM public.servers;` again to wipe the database cleanly so the Three-Tier optimization algorithm doesn't aggressively skip them. 
4. Trigger Ingestion. Your logs will now read: `Sandbox extracted X tools for server-name`.

### 4. Verify admin dashboard

- Go to `/admin` → Operations tab
- Confirm all cron jobs show "no data" (they'll populate over time)
- Trigger a test ingest from the Ingest tab
- Verify the Operations tab updates

### 5. Environment variables audit

Ensure all required env vars are set in Vercel:
- `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`
- `CRON_SECRET` (random, strong)
- `NEXT_PUBLIC_ADMIN_UID` (your Supabase Auth user ID)
- `SMITHERY_API_KEY` (get free at smithery.ai)
- `UPSTASH_REDIS_REST_URL` + `UPSTASH_REDIS_REST_TOKEN` (production rate limiting)

---

## API Reference

```
GET  /openmcp.md                              Agent skill file — fetch once, understand everything
GET  /api/mcp                                 Registry info, security layer list, agent prompt template
GET  /api/servers/search?q={intent}&limit=5   Semantic search — full inputSchema per tool returned
GET  /api/servers?sort=trust&verified=true&page=2&page_size=24
                                              Browse with filters + pagination
GET  /api/servers/:name                       Server detail, scan history, CVE issues
POST /api/proxy/:serverName/:toolName         15-layer security proxy — every call inspected
POST /api/mcp-server                          Native MCP server (StreamableHTTP)
GET  /api/mcp-server                          Native MCP server (SSE — for older clients)
POST /api/ingest                              Trigger ingest (CRON_SECRET required)
POST /api/admin/ingest                        Trigger ingest from the signed-in admin session
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

## Architecture Decisions

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

### Security Layers

| When | Layers | Catches mid-cycle changes? |
|------|--------|---------------------------|
| **Ingest** | L1 static scan, S-14 CVE scan | ❌ Only at ingest time |
| **Cron (6h)** | L3 schema drift | ✅ Detects tool rug-pulls |
| **Cron (15m)** | Uptime + trust recomputation | ✅ Detects server outages |
| **Proxy (every call)** | L4 DLP, S-12 shell injection, S-13 indirect injection, L9 sampling, L10 PII, L11 URL, L12 context | ✅ Runtime defense |

### Server Status Lifecycle

| Status | Set By | Visible? | Callable? |
|--------|--------|----------|----------|
| `active` | Ingest (scan ok) | ✅ | ✅ |
| `pending_review` | Ingest (high severity) | ❌ | ❌ |
| `rejected` | Ingest (critical) | ❌ | ❌ |
| `suspended` | Schema drift cron | ❌ | ❌ |
| `pending` | Manual publish | ❌ | ❌ |

Only `active` servers are visible to any user (human or AI) and callable through the proxy.

### CVE Scan Deduplication

Multiple servers can share the same GitHub repository. The pipeline deduplicates CVE scans by repo URL, scanning each unique repo only once per ingest run.

### Documentation Sync

To keep docs in sync when making changes from any computer:
1. All architectural decisions are in this README (single source of truth)
2. The admin Operations tab has a live API catalog and status reference
3. Migration files are self-documenting with inline comments
4. Run `npm run build` after any change — TypeScript catches interface drift

---

## License

Apache 2.0 License — Built by [The-17](https://github.com/the-17) & [Akins](https://github.com/akins-dev)
