# Relay — Development & Builder's Guide

## Setup

### 1. Clone and install

```bash
git clone https://github.com/akins-dev/Relay
cd Relay
bun install   # or: npm install
```

### 2. Supabase

Create a project at [supabase.com](https://supabase.com). Run migrations in order in the SQL Editor:

```
supabase/migrations/001_initial_schema.sql      ← full schema, RLS, FTS, RPCs
supabase/migrations/002_seed_data.sql           ← retired no-op placeholder (demo seed rows removed)
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
supabase/migrations/019_add_vendor_source.sql   ← legacy source expansion
supabase/migrations/020_add_github_url_to_search.sql ← legacy search RPC variant
supabase/migrations/021_add_new_sources.sql     ← legacy source expansion
supabase/migrations/022_analytics_intelligence_layer.sql ← search/invoke learning layer
supabase/migrations/023_security_hardening.sql  ← rate limit config + official name conflict checks
supabase/migrations/024_new_sources_and_partner_rename.sql ← vendor→partner rename + new sources
supabase/migrations/025_ingest_mvp_contract_fixes.sql ← current ingest/search contract alignment
supabase/migrations/026_new_schema_fields.sql          ← icon_url, env_var_schema, package_info
supabase/migrations/027_tool_extraction_source.sql     ← extraction provenance per server
supabase/migrations/028_ingest_quality_views.sql       ← weak stdio + missing metadata views
supabase/migrations/029_metadata_grade_fields.sql      ← A–F metadata grading fields
supabase/migrations/030_search_rpc_update.sql          ← updated search_servers RPC with new fields
supabase/migrations/031_auth_type_derive.sql           ← auth_type derivation from env_var_schema
supabase/migrations/032_behavioral_trust_and_dynamic_diversity.sql ← Bayesian trust + dynamic search diversity (REQUIRED)

> **Note on 002:** This migration is now intentionally a no-op. Historical demo rows were removed so fresh environments start clean and ingest remains the only source of server truth.
>
> **Note on 011:** Read the header first and confirm your Supabase project keeps statement logging at `ddl` or `none`. This is an ongoing operational requirement for any route that stores secrets or OAuth tokens, not just a one-time migration concern.
>
> **Note on 032:** This migration replaces `search_servers()` and `compute_trust_score_v2()` entirely. The old `trust_score >= 85` hardcoded diversity gate is replaced with a dynamic result-set median approach. The Smithery `use_count` slot is replaced by Bayesian behavioral reliability from `intent_server_mappings`. Run this migration before triggering any ingest or uptime cron job.

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
| `SANDBOX_URL` | Optional | Required if you want stdio schema extraction through the sandbox |
| `SANDBOX_AUTH_TOKEN` | Optional | Auth token shared with the sandbox service |
| `UPSTASH_REDIS_REST_URL` | Optional | Production rate limiting (console.upstash.com) |
| `UPSTASH_REDIS_REST_TOKEN` | Optional | Required with above |
| `NEXT_PUBLIC_ADMIN_UID` | Optional | Supabase Auth user ID allowed to open `/admin` and trigger admin-only ingest |

**Startup Validation:** The application uses Zod to automatically validate `.env` files upon boot. If any required variables are missing (e.g. `SUPABASE_SERVICE_ROLE_KEY` or `CRON_SECRET`), the Next.js process will instantly gracefully crash with a detailed error log indicating exactly which fields you forgot to set!

### 4. Run

```bash
bun dev
# → http://localhost:3000
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

Ingest has two modes:

- `catalog` — fast MVP path. Fetches upstream registries, normalizes/dedupes rows, stores source metadata, derives auth, writes preliminary trust, and queues expensive post-ingest work.
- `full` — legacy/deep path. Runs the heavier probe/sandbox/README/CVE work inline.

Production cron uses `catalog` mode and then processes queued verification jobs in small batches. This keeps source ingestion consumable even when individual servers are slow, unreachable, rate limited, or require sandbox extraction.

```bash
# Fast catalog ingest (recommended for MVP)
curl -X POST http://localhost:3000/api/ingest \
  -H "Authorization: Bearer your-cron-secret" \
  -H "Content-Type: application/json" \
  -d '{"source": "official", "mode": "catalog"}'

# Or trigger individual sources:
# "official"      — MCP official registry
# "smithery"      — Smithery registry (SMITHERY_API_KEY required)
# "glama"         — Glama directory (enrichment source, requires existing rows with github_url)
# "mcp_directory" — mcp.directory (enrichment source, requires existing rows with github_url)
  -d '{"source": "official"}'

# Deep inline ingest, useful for local debugging but not recommended as the scheduled MVP path
curl -X POST http://localhost:3000/api/ingest \
  -H "Authorization: Bearer your-cron-secret" \
  -H "Content-Type: application/json" \
  -d '{"source": "official", "mode": "full"}'
```

Expected response includes a JSON breakdown of successful indexing and rejections per source.

Important current behavior:

- Vercel cron calls source-specific catalog routes:
  - `/api/cron/ingest/official`
  - `/api/cron/ingest/smithery`
  - `/api/cron/ingest/glama`
  - `/api/cron/ingest/mcp-directory`
- Post-ingest verification runs through `/api/cron/process-jobs`.
- `catalog` rows can appear in search before deep checks finish. Invoke remains strict: only `active`, `proxy_available` rows with a safe endpoint and known tool can be called.
- Search responses include quality labels:
  - `discovery_only`
  - `proxy_ready`
  - `schema_ready`
  - `verified`
  - `suspended`
- `stdio` rows are stored even when they are not cloud-invocable.
- If a `stdio` server has a `smithery_id`, catalog ingest queues sandbox extraction; full ingest tries it inline.
- Relay does not guess an execution command from a plain GitHub repo URL; repo-backed stdio rows fall back to README parsing unless a concrete launcher is known.
- If a `stdio` server is a GitHub subdirectory/monorepo URL, ingest does not guess an execution command; it falls back to README parsing and description enrichment.
- In `full` mode, if sandbox extraction is unavailable or fails, ingest falls back to README parsing for descriptions and tool hints.
- If neither sandbox nor README yields useful metadata, the server can still be stored if provenance is strong enough, but quality will be limited.
- **Trust score cold start:** all newly ingested servers start with `invokeCount: 0, successCount: 0`. The Bayesian prior in `computeTrustScore()` gives a floor of ~8 pts in the behavioral reliability slot rather than 0. Scores grow automatically as agents invoke servers through the proxy.

### Post-ingest processing queue

Migration `036_processing_jobs_and_mvp_ingest.sql` adds `server_processing_jobs`.

Catalog ingest queues these jobs when useful:

- `probe` — HTTP/SSE servers with endpoints
- `sandbox` — stdio servers with enough launch metadata
- `readme_enrich` — GitHub-backed rows with weak descriptions
- `cve_scan` — GitHub-backed rows

Run a batch manually:

```bash
curl -X GET http://localhost:3000/api/cron/process-jobs?limit=10 \
  -H "Authorization: Bearer your-cron-secret"
```

The admin Operations tab shows queue health from `processing_job_health`.

### Change detection and reprocessing

Ingest uses three layers before doing expensive work:

1. Tier 1: skip when `upstream_updated_at <= last_scanned_at`
2. Tier 2: skip when `schema_hash` matches and the row was scanned in the last 24 hours
3. Tier 3: full extraction, CVE scan, trust recompute, and upsert

This matters operationally:

- Use a normal re-ingest when upstream data changed.
- Force a reprocess when Relay's own ingest logic changed but upstream data did not.
- If you newly add the sandbox, or change extraction logic, a normal re-ingest may skip too aggressively.

Least-destructive force reprocess for all current rows:

```sql
UPDATE public.servers
SET schema_hash = NULL,
    last_scanned_at = NULL;
```

Clean rebuild from scratch (registry + ingest only):

```sql
DELETE FROM public.scan_results;
DELETE FROM public.schema_snapshots;
DELETE FROM public.cron_job_runs;
DELETE FROM public.ingest_runs;
DELETE FROM public.servers;
```

Full wipe (including analytics, audit, and metering):

> **⚠️ Destructive:** run in Supabase SQL Editor. Consider taking a backup/snapshot first.
> Order matters (avoid FK issues).

```sql
-- Intelligence / search analytics (022)
DELETE FROM public.invoke_outcomes;
DELETE FROM public.search_events;
DELETE FROM public.intent_server_mappings;

-- Audit + metering + connection logs
DELETE FROM public.audit_log;
DELETE FROM public.metering_events;
DELETE FROM public.mcp_connections;

-- Ops history
DELETE FROM public.cron_job_runs;
DELETE FROM public.ingest_runs;

-- Registry
DELETE FROM public.scan_results;
DELETE FROM public.schema_snapshots;
DELETE FROM public.server_connection_profiles;
DELETE FROM public.server_stars;
DELETE FROM public.tool_policies;
DELETE FROM public.api_keys;
DELETE FROM public.servers;
```

Notes:

- **Views** like `audit_summary` and `server_tool_usage_30d` are derived; they clear when underlying tables are empty.
- **Users (Auth)**: if you want to remove *all* user accounts (and log everyone out), delete users in **Supabase Dashboard → Authentication → Users** (or `DELETE FROM auth.users;` if your SQL role allows it).
- **Vault-backed secrets (011)**: secrets live in `vault.secrets` (encrypted). Clearing `public.user_secrets` / deleting users may still leave vault rows depending on your setup. If you need a true vault wipe, follow Supabase Vault docs and remove the relevant `vault.secrets` rows carefully.
- **Redis (Upstash)**: analytics are not stored in Redis, but rate-limit/cache state is. Flush the Upstash DB if you want *zero* residual limiter/cached state.
- **Sentry** (or other telemetry): stored outside Postgres; purge there separately if needed.

### Manual cron routes

These are the cron-backed routes exposed by the app:

```bash
# ingest
curl -X POST http://localhost:3000/api/ingest \
  -H "Authorization: Bearer $CRON_SECRET" \
  -H "Content-Type: application/json" \
  -d '{"source":"all"}'

# uptime
curl http://localhost:3000/api/cron/uptime-check \
  -H "Authorization: Bearer $CRON_SECRET"

# schema drift
curl http://localhost:3000/api/cron/schema-drift \
  -H "Authorization: Bearer $CRON_SECRET"

# daily call reset
curl http://localhost:3000/api/cron/reset-daily-calls \
  -H "Authorization: Bearer $CRON_SECRET"
```

The corresponding script entrypoints live in `src/scripts/cron-*.ts` and are what GitHub Actions should run for long jobs.

Actual scheduled cadence from `vercel.json`:

- Ingest all sources: daily at `02:00 UTC`
- Uptime check: every `15 minutes`
- Schema drift: every `6 hours`
- Daily call reset: `00:00 UTC`

---

## Tests

```bash
npm test
# unit tests covering the security stack with real attack payloads
```

---

## Deploy

```bash
vercel --prod
```

Set all environment variables in Vercel dashboard.

**Cron Job Notice (Vercel Hobby vs Pro):**
By default, Vercel Hobby has a 10s-60s max execution limit. This means heavy cron jobs like Ingestion, Schema Drift checking (which polls thousands of active endpoints), and Uptime checks *will* fail if running strictly on Hobby via API routes.
To bypass this, Relay runs perfectly on **GitHub Actions CLI scripts** to effortlessly hit the Supabase database and bypass any serverless wall-clocks infinitely for zero cost! (Check `.github/workflows`).

- Schema drift check: every 6h
- Uptime check: every 15min
- Daily call reset: midnight UTC
- Ingest all sources: 2am UTC

> **⚠️ GitHub Actions Setup Required:** Your repository must be **Public** (to unlock unlimited free execution minutes and avoid the 2000-min cap). In your GitHub repository, under **Settings** → (scroll down left sidebar to) **Secrets and variables** → **Actions** → **New repository secret**, explicitly set:
> - `NEXT_PUBLIC_SUPABASE_URL`
> - `SUPABASE_SERVICE_ROLE_KEY`
> - `SMITHERY_API_KEY` (if ingestion requires it)
> - `SANDBOX_URL` and `SANDBOX_AUTH_TOKEN` (required for Render Sandbox parsing)

---

## ⚠️ Pre-Production Checklist

**MUST DO before going live.** This checklist ensures the registry starts clean with real data.

### 1. Delete all development/test servers

```sql
-- Run in Supabase SQL Editor (registry + ingest only):
DELETE FROM public.scan_results;
DELETE FROM public.schema_snapshots;
DELETE FROM public.cron_job_runs;
DELETE FROM public.ingest_runs;
DELETE FROM public.servers;
```

If you also want to wipe **analytics + audit + metering**, run this first:

```sql
DELETE FROM public.invoke_outcomes;
DELETE FROM public.search_events;
DELETE FROM public.intent_server_mappings;
DELETE FROM public.audit_log;
DELETE FROM public.metering_events;
DELETE FROM public.mcp_connections;
```

### 2. Re-ingest from all sources (fresh)

```bash
# Ingest one source at a time to monitor each:
curl -X POST http://localhost:3000/api/ingest \
  -H "Authorization: Bearer $CRON_SECRET" \
  -H "Content-Type: application/json" \
  -d '{"source": "official"}'

# Then run remaining sources one at a time:
# smithery, glama, mcp_directory
```

### 3. Deploy the Render Sandbox (Optional but highly recommended)

If you are scraping sources with `stdio` servers (like Smithery or GitHub official), you need the Sandbox to run the underlying code securely.
1. Deploy the `/sandbox` folder to Render natively (See `sandbox/README.md`)
2. Add `SANDBOX_URL` and `SANDBOX_AUTH_TOKEN` to your `.env`
3. If you previously ingested without the sandbox, run `DELETE FROM public.servers;` again to wipe the database cleanly so the Three-Tier optimization algorithm doesn't aggressively skip them. 
4. Trigger Ingestion. Your logs will now read: `Sandbox extracted X tools for server-name`.

### 4. Pre-Ingest Health Check

Before running the ingest batch, verify that all external systems (Supabase, Sandbox, external APIs, Redis) are healthy and reachable. If the sandbox is down, stdio servers will silently fall back to degraded README parsing.

```bash
npm run check:connections
```
This script will test all dependent APIs and perform a live MCP protocol handshake against a sample server. If any system is down, it will exit with code `1`. Do not proceed with ingestion until all critical systems report `✅`.

### 5. Verify admin dashboard

- Go to `/admin` → Operations tab
- Confirm all cron jobs show "no data" (they'll populate over time)
- Trigger a test ingest from the Ingest tab
- Verify the Operations tab updates

### 6. Environment variables audit

Ensure all required env vars are set in Vercel:
- `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`
- `CRON_SECRET` (random, strong)
- `NEXT_PUBLIC_ADMIN_UID` (your Supabase Auth user ID)
- `SMITHERY_API_KEY` (get free at smithery.ai)
- `SANDBOX_URL` + `SANDBOX_AUTH_TOKEN` (if you want stdio extraction)
- `UPSTASH_REDIS_REST_URL` + `UPSTASH_REDIS_REST_TOKEN` (production rate limiting)
