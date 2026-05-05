# Testing Guide

Last updated: 2026-04-24

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
```

Expected today:

- `4` test suites passed
- Tests passed (run `npm test` to see current count — increased from Sprint 2 baseline of ~90 with behavioral trust suite added in migration 032)

## 2. Know the cron cadence

Current scheduled jobs from `vercel.json`:

- ingest all sources: daily at `02:00 UTC`
- uptime check: every `15 minutes`
- schema drift: every `6 hours`
- daily call reset: `00:00 UTC`

If you were thinking of a 5-hour check, that is not the current schedule. The drift check is `6 hours`.

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

One source at a time:

```bash
curl -X POST http://localhost:3000/api/ingest \
  -H "Authorization: Bearer $CRON_SECRET" \
  -H "Content-Type: application/json" \
  -d '{"source":"official"}'
```

Then repeat with:

- `smithery` (if key configured)
- `glama`
- `mcp_directory`

Full ingest:

```bash
curl -X POST http://localhost:3000/api/ingest \
  -H "Authorization: Bearer $CRON_SECRET" \
  -H "Content-Type: application/json" \
  -d '{"source":"all"}'
```

What to inspect after each source:

- `/admin` ingest runs
- `/admin` operations
- row counts in `servers`
- whether `transport`, `proxy_available`, `tools`, `tool_schemas`, `description_quality`, `scan_status`, and `trust_score` look sane

## 6. Trigger the operational jobs manually

After ingest, run the cron-backed jobs manually once so you are not waiting on the real schedule.

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

After you have ingested at least `official` and `github`, test the MVP in this order.

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
- `invoke_tool`

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

### E. Invoke without credentials

```bash
curl -s http://localhost:3000/api/mcp-server \
  -H 'Content-Type: application/json' \
  -d '{
    "jsonrpc":"2.0",
    "id":4,
    "method":"tools/call",
    "params":{
      "name":"invoke_tool",
      "arguments":{
        "server":"sendgrid-mail",
        "tool":"send_email",
        "args":{"to":"user@example.com"}
      }
    }
  }'
```

Expected:

- structured auth/setup guidance

### F. Invoke with credentials

Use a valid Relay API key and pass `search_event_id` + `intent` from the search step:

```bash
curl -s http://localhost:3000/api/mcp-server \
  -H 'Content-Type: application/json' \
  -H 'Authorization: Bearer sk_mcp_your_key_here' \
  -d '{
    "jsonrpc":"2.0",
    "id":5,
    "method":"tools/call",
    "params":{
      "name":"invoke_tool",
      "arguments":{
        "server":"sendgrid-mail",
        "tool":"send_email",
        "search_event_id":"<paste from search>",
        "intent":"send a transactional email with html body",
        "args":{
          "to":"user@example.com",
          "subject":"Test",
          "body":"Hello"
        }
      }
    }
  }'
```

Expected:

- success, or
- structured upstream credential/setup guidance

## 8. When to test with all sources

Use `source="all"` only when you want one of these:

- final pre-launch population
- performance and runtime observation
- trust/search quality checks across the whole registry
- admin dashboard validation under realistic data volume

For daily development, targeted source ingest is faster and gives clearer failure isolation.

## 9. Recommended MVP testing sequence

Use this exact order:

1. `npx tsc --noEmit`
2. `npm test -- --runInBand`
3. start local app
4. ingest `official`
5. ingest `smithery` if key configured (exercises sandbox path)
6. ingest `glama` (enrichment — depends on step 4/5 rows)
7. run manual uptime check (validates trust recomputation with behavioral ISM data)
8. run manual schema drift
9. test `search_tools`
10. test `invoke_tool`
11. only then run `source="all"` if you want scale validation

That is the fastest path to confidence without paying the full cost of a live full-registry ingest on every iteration.
