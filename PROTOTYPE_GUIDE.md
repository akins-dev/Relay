# Prototype Guide

Last updated: 2026-04-23

This bypasses ingest entirely.

The goal is a deterministic local world:

- 50 fixed `servers` rows
- fixed local fake MCP endpoints
- fixed API key
- repeatable search and invoke behavior

## What This Gives You

The fixture world includes:

- 20 healthy `streamable_http` servers
- 8 healthy `sse` servers
- 6 auth-required HTTP servers
- 4 flaky HTTP servers
- 4 malformed metadata fixtures
- 4 near-duplicate email providers
- 4 `stdio` servers

The strongest matches for:

```text
send a transactional email with html body
```

should be:

- `fx-transactional-mail-sandbox`
- `fx-html-mailer`
- `fx-order-confirmation-mail`
- `fx-email-dispatch-us`
- `fx-email-dispatch-eu`

## Prerequisites

You need:

- `NEXT_PUBLIC_SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- a running local app environment
- at least one row in `public.profiles`

If `public.profiles` is empty, create a user first.

## 1. Start Fake MCP Upstreams

Run:

```bash
PROTOTYPE_MCP_PORT=4010 npm run prototype:server
```

Health check:

```bash
curl -s http://127.0.0.1:4010/health
```

Expected:

- JSON with `status: "ok"`
- `fixtures: 50`

## 2. Seed the Fixture World

Run:

```bash
PROTOTYPE_MCP_PORT=4010 npm run prototype:seed
```

Expected output:

- `Seeded 50 prototype fixtures ...`
- fake base URL
- prototype API key

Deterministic API key:

```text
sk_mcp_prototype_local_dev_key
```

## 3. Start the App in Prototype Mode

Run:

```bash
ALLOW_LOCAL_PROTOTYPE_ENDPOINTS=1 PROTOTYPE_MCP_PORT=4010 npm run dev
```

This enables a narrow localhost exception in SSRF validation:

- only when `ALLOW_LOCAL_PROTOTYPE_ENDPOINTS=1`
- only `localhost` / `127.0.0.1`
- only the configured prototype port

## 4. Automated Baseline

Run:

```bash
npx tsc --noEmit
npm test -- --runInBand
```

Do not use:

```bash
bun test
```

The suite is Jest-based.

## 5. Search Through the Real MCP Route

Run:

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

- non-empty `results`
- `search_event_id`
- top results dominated by the email fixtures above

## 6. Invoke the Public Sandbox Fixture

Use the returned `search_event_id`:

```bash
curl -s http://localhost:3000/api/mcp-server \
  -H 'Content-Type: application/json' \
  -H 'Authorization: Bearer sk_mcp_prototype_local_dev_key' \
  -d '{
    "jsonrpc":"2.0",
    "id":4,
    "method":"tools/call",
    "params":{
      "name":"invoke_tool",
      "arguments":{
        "server":"fx-transactional-mail-sandbox",
        "tool":"send_email",
        "search_event_id":"PASTE_SEARCH_EVENT_ID",
        "intent":"send a transactional email with html body",
        "args":{
          "to":"user@example.com",
          "subject":"Prototype test",
          "html":"<p>Hello prototype</p>"
        }
      }
    }
  }'
```

Expected:

- success response
- echo payload from the fake upstream
- analytics linkage can now be checked

## 7. Invoke an Auth-Protected Fixture

Run:

```bash
curl -s http://localhost:3000/api/mcp-server \
  -H 'Content-Type: application/json' \
  -H 'Authorization: Bearer sk_mcp_prototype_local_dev_key' \
  -d '{
    "jsonrpc":"2.0",
    "id":5,
    "method":"tools/call",
    "params":{
      "name":"invoke_tool",
      "arguments":{
        "server":"fx-sendgrid-mail",
        "tool":"send_email",
        "args":{
          "to":"user@example.com",
          "subject":"Blocked by auth",
          "html":"<p>Needs auth</p>"
        }
      }
    }
  }'
```

Expected:

- structured `authentication_required`
- `setup_url` or connect guidance

## 8. Exercise Failure Cases

Use these servers:

- `fx-flaky-timeout`
- `fx-flaky-500`
- `fx-flaky-redirect`
- `fx-flaky-malformed-response`

This validates:

- timeout handling
- upstream 500 handling
- redirect handling
- malformed JSON behavior

## 9. Verify Analytics Linkage

After a successful search followed by invoke, inspect:

- `search_events`
- `invoke_outcomes`
- `intent_server_mappings`

You want to see:

- the `search_event_id` row in `search_events`
- a matching `invoke_outcomes.search_event_id`
- an updated mapping row for the intent/server pair

## 10. Optional Smoke Script

Run:

```bash
npm run prototype:smoke
```

This calls:

- `search_tools`
- `invoke_tool`

against the local app and prints both responses.

