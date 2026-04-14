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

Expected response includes a JSON breakdown of successful indexing and rejections per source.

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
To bypass this, Relay runs perfectly on **GitHub Actions CLI scripts** to effortlessly hit the Supabase database and bypass any serverless wall-clocks infinitely for zero cost! (Check `.github/workflows`).

- Schema drift check: every 6h
- Uptime check: every 15min
- Daily call reset: midnight UTC
- Ingest all sources: 2am UTC

> **⚠️ GitHub Actions Setup Required:** Your repository must be **Public** (to unlock unlimited free execution minutes and avoid the 2000-min cap). In your GitHub repository, under **Settings** → (scroll down left sidebar to) **Secrets and variables** → **Actions** → **New repository secret**, explicitly set:
> - `NEXT_PUBLIC_SUPABASE_URL`
> - `SUPABASE_SERVICE_ROLE_KEY`
> - `SMITHERY_API_KEY` (if ingestion requires it)

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
