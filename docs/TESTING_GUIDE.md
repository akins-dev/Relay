# Testing Guide

Last updated: 2026-05-22

This guide is the fastest path to testing the MVP without waiting on a huge live ingest before you learn anything.

## 1. Local baseline

Set up:

- Supabase env vars
- `SUPABASE_SERVICE_ROLE_KEY`
- `CRON_SECRET`
- optional: `SMITHERY_API_KEY`
- optional but recommended for stdio extraction: `SANDBOX_URL` and `SANDBOX_AUTH_TOKEN`

Start the app:

```bash
bun dev
```

Run the baseline checks first:

```bash
npx tsc --noEmit
npm test -- --runInBand
npm run test:benchmark
```

Expected today:

- All `__tests__` suites pass (including `search-quality` and `benchmark-score`)
- `test:benchmark` runs without Supabase (pure scoring, trim, classifier, manifest)

## 2. Know the cron state

Automatic cron is paused for the MVP.

Current state:

- `vercel.json` has no `crons` block.
- `.github/workflows/cron.yml` has no `schedule` block.
- Cron API routes and CLI scripts still exist for manual testing.
- Cron route auth requires `Authorization: Bearer <CRON_SECRET>`.

Use GitHub Actions `workflow_dispatch` or the local scripts when you intentionally want ingest, uptime, schema drift, or counter reset work to run.

## 3. Understand when you need a force reprocess

Normal re-ingest is enough when upstream data changed.

Force reprocess is needed when Relay logic changed but upstream rows did not, for example:

- new sandbox setup
- new README extraction logic
- new transport detection logic
- trust / scan persistence fixes

Least-destructive force reprocess:

```sql
UPDATE public.servers
SET schema_hash = NULL,
    last_scanned_at = NULL;
```

Full clean rebuild:

```sql
DELETE FROM public.scan_results;
DELETE FROM public.schema_snapshots;
DELETE FROM public.cron_job_runs;
DELETE FROM public.ingest_runs;
DELETE FROM public.servers;
```

## 4. Fastest MVP testing path

Do not start with `all` unless your goal is specifically a full-scale soak test.

Active sources in `runIngest()` (the only valid values):

| Source | Tier | Needs key? | Best for |
|---|---|---|---|
| `official` | Primary | No | Clean source, highest data quality |
| `smithery` | Primary | Yes (`SMITHERY_API_KEY`) | Volume + `verified` flag |
| `glama` | Enrichment | No | Enriches existing rows via github_url |
| `mcp_directory` | Enrichment | No | Enriches existing rows via github_url |

Recommended order:

1. `official` — cleanest source, validates normalization
2. `smithery` — if your key is configured, exercises the sandbox path
3. `glama` — enrichment layer, requires rows from step 1/2
4. `mcp_directory` — enrichment layer, requires rows from step 1/2

Why this order:

- `official` is the cleanest source, no API key needed
- `smithery` exercises the Smithery SDK and sandbox path if configured
- enrichment sources (`glama`, `mcp_directory`) need primary rows to exist first to match against

## 5. Trigger ingest locally

Preferred local/GitHub Actions path:

```bash
LOCAL_INGEST_CONCURRENCY=20 \
LOCAL_INGEST_PROGRESS_EVERY=25 \
OFFICIAL_REGISTRY_TIMEOUT_MS=60000 \
npm run ingest:local -- all --full
```

For a smaller first run:

```bash
LOCAL_INGEST_CONCURRENCY=5 npm run ingest:local -- official --full
```

This path does not use a Postgres queue. It fetches sources and calls `upsertServers()` directly with local concurrency. Sandbox extraction is separately capped at 3 concurrent requests inside the ingest pipeline.

Use `--full` for primary-source population. Under the no-tool guard, `catalog` mode will skip Official rows unless another source already provided tool names or schemas.

Use source-specific local runs when isolating failures:

```bash
LOCAL_INGEST_CONCURRENCY=5 npm run ingest:local -- official --full
LOCAL_INGEST_CONCURRENCY=5 npm run ingest:local -- smithery --full
LOCAL_INGEST_CONCURRENCY=5 npm run ingest:local -- enrich
LOCAL_INGEST_CONCURRENCY=5 npm run ingest:local -- glama
LOCAL_INGEST_CONCURRENCY=5 npm run ingest:local -- mcp_directory
```

The safe default for full local/GitHub Actions runs is `40`. The runner caps `LOCAL_INGEST_CONCURRENCY` at `100`; `1000` concurrent requests is not supported because it can overwhelm Supabase, upstream APIs, and the Node process before it improves throughput. The `enrich` source runs `glama` and `mcp_directory` only.

What to inspect after each source:

- `/admin` ingest runs
- `/admin` operations
- row counts in `servers`
- whether `transport`, `proxy_available`, `tools`, `tool_schemas`, `description_quality`, `scan_status`, and `trust_score` look sane
- confirm new primary-source rows have at least one tool name or tool schema

## 6. Trigger the operational jobs manually

After ingest, run the cron-backed jobs manually once only when you want to validate them. There is no automatic schedule right now.

```bash
curl http://localhost:3000/api/cron/uptime-check \
  -H "Authorization: Bearer $CRON_SECRET"
```

```bash
curl http://localhost:3000/api/cron/schema-drift \
  -H "Authorization: Bearer $CRON_SECRET"
```

```bash
curl http://localhost:3000/api/cron/reset-daily-calls \
  -H "Authorization: Bearer $CRON_SECRET"
```

This validates:

- health probing
- trust recomputation (now uses behavioral ISM data from `intent_server_mappings`)
- schema drift handling
- cron auth and admin visibility

## 7. MVP manual product test

After you have ingested at least `official` and `smithery` if your key is configured, test the MVP in this order.

### A. MCP initialize

```bash
curl -s http://localhost:3000/api/mcp-server \
  -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}'
```

Expected:

- valid JSON-RPC response
- `protocolVersion`
- instructions present

### B. MCP tools/list

```bash
curl -s http://localhost:3000/api/mcp-server \
  -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/list"}'
```

Expected:

- `search_tools`
- `get_server_manifest`

### C. Search

```bash
curl -s http://localhost:3000/api/mcp-server \
  -H 'Content-Type: application/json' \
  -d '{
    "jsonrpc":"2.0",
    "id":3,
    "method":"tools/call",
    "params":{
      "name":"search_tools",
      "arguments":{
        "intent":"send a transactional email with html body",
        "limit":5
      }
    }
  }'
```

Keep:

- `search_event_id`
- `intent`

### D. REST search sanity check

```bash
curl -s 'http://localhost:3000/api/servers/search?q=email&limit=5'
```

Expected:

- no RPC/signature crash
- usable results

### E. Manifest lookup

```bash
curl -s http://localhost:3000/api/mcp-server \
  -H 'Content-Type: application/json' \
  -d '{
    "jsonrpc":"2.0",
    "id":4,
    "method":"tools/call",
    "params":{
      "name":"get_server_manifest",
      "arguments":{
        "server":"sendgrid-mail"
      }
    }
  }'
```

Expected:

- manifest with `run_mode`
- env requirements if available
- tool schemas or tool names

### F. Relay Local invocation

Cloud MCP does not expose `invoke_tool` in the MVP. Local invocation belongs to Relay Local:

```bash
relay info sendgrid-mail
relay invoke sendgrid-mail send_email --json '{"to":"user@example.com","subject":"Test","body":"Hello"}'
```

Expected:

- clear manifest output from `relay info`
- success or structured env/setup guidance from `relay invoke`
- child processes cleaned up on timeout or exit

## 8. When to test with all sources

Use `source="all"` only when you want one of these:

- final pre-launch population
- performance and runtime observation
- trust/search quality checks across the whole registry
- admin dashboard validation under realistic data volume

For daily development, targeted source ingest is faster and gives clearer failure isolation.

## 9. Search benchmark (precision)

Offline (CI-safe):

```bash
npm run test:benchmark
```

Live catalog (requires Supabase env + ingest):

```bash
npm run benchmark:eval
# writes benchmark/reports/latest.md
```

Metrics: Server-P@1, Server-P@3, Tool-P@1, Runnable-P@1, knowledge deflection. See `docs/SEARCH_PIPELINE.md`.

Optional CI gate:

```bash
BENCHMARK_MIN_SERVER_P1=0.5 npm run benchmark:eval
```

## 10. Recommended MVP testing sequence

Use this exact order:

1. `npx tsc --noEmit`
2. `npm test -- --runInBand`
3. `npm run test:benchmark`
4. start local app
5. ingest `official`
6. ingest `smithery` if key configured (exercises sandbox path)
7. ingest `glama` (enrichment — depends on step 5/6 rows)
8. `npm run benchmark:eval` — record Server-P@1 in report
9. run manual uptime check only if you want to validate trust recomputation with behavioral ISM data
10. run manual schema drift only if you want to validate suspension behavior
11. test `search_tools`
12. test `get_server_manifest`
13. test Relay Local `relay info` / `relay invoke`
14. only then run `source="all"` if you want scale validation

That is the fastest path to confidence without paying the full cost of a live full-registry ingest on every iteration.
