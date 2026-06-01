# Launch & Public Testing Guide

Last updated: 2026-05-22  
Status: Operational checklist to make Relay discoverable and testable by external agents

Prerequisites: `SEARCH_PIPELINE.md`, `TESTING_GUIDE.md`, `cli/README.md`.

---

## What “live” means for Relay

Relay is **two planes**:

| Plane | Host | Agent entry |
|-------|------|-------------|
| **Relay Cloud** | Vercel + Supabase | `search_tools`, `get_server_manifest`, REST search |
| **Relay Local** | User machine | `npx @relay/cli serve`, `relay invoke` |

Third-party tools are **never** executed on Cloud in the MVP. Public testing validates discovery + local invoke, not hosted proxy.

---

## Pre-launch checklist

### 1. Database & search

- [ ] All migrations through `040_tool_level_intent_search.sql` applied
- [ ] `MIGRATION_LEDGER.md` includes `040`
- [ ] `search_servers` RPC exists (`ensureSearchContracts` passes on deploy)
- [ ] Manual ingest: `bun run ingest:local official` (then smithery/glama as needed)
- [ ] `npm run benchmark:eval` — record Server-P@1 in `benchmark/reports/latest.md`

### 2. Cloud app (Vercel)

- [ ] `NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `CRON_SECRET`
- [ ] Optional: `SMITHERY_API_KEY`, sandbox vars for stdio enrichment
- [ ] Deploy production; verify:
  - `GET /agents.md`
  - `GET /llms.txt`
  - `GET /.well-known/mcp.json`
  - `POST /api/mcp-server` (MCP initialize + tools/list)
  - `GET /api/servers/search?q=send+email&limit=5`

### 3. Relay CLI (npm)

- [ ] Publish `@relay/cli` with `relay search`, `info`, `invoke`, `serve`, `bootstrap`
- [ ] Set production default API base URL in CLI config
- [ ] Document `RELAY_API_KEY` for outcome reporting (optional but recommended)

### 4. Documentation & discovery

- [ ] Root `README.md` points to Cloud URL + CLI
- [ ] `agents.md` route matches MCP tool list (no cloud `invoke_tool`)
- [ ] Rate limits documented in `RATE_LIMITS.md`

### 5. Automated tests before tag

```bash
npx tsc --noEmit
npm test -- --runInBand
npm run test:benchmark
```

Optional with live env:

```bash
npm run benchmark:eval
```

---

## Public testing paths

### Path A — MCP-native agent

1. Connect MCP client to `https://<your-domain>/api/mcp-server` with API key if required.
2. Call `search_tools({ intent: "send a transactional email with html body", limit: 5 })`.
3. Call `get_server_manifest({ server: "<top-server-name>" })`.
4. Run locally:

```bash
export RELAY_API_KEY=sk_mcp_...
npx -y @relay/cli serve
```

5. Call local `invoke_tool` with server, tool, and args from search results.

### Path B — CLI agent

```bash
export RELAY_API_URL=https://<your-domain>
export RELAY_API_KEY=sk_mcp_...
npx -y @relay/cli bootstrap
npx -y @relay/cli search "create a github issue"
npx -y @relay/cli info <server-name>
npx -y @relay/cli invoke <server-name> <tool-name> --args '{"title":"test"}'
```

### Path C — REST / integration testing

```bash
curl -s "https://<your-domain>/api/servers/search?q=postgres&limit=3" | jq '.results[0] | {name, confidence, manifest: .manifest.run_mode, tools: [.tools[].name]}'
```

## Measuring public test quality

Track in Supabase (already instrumented):

- `search_events` — volume, cache hit rate, latency
- `invoke_outcomes` — success rate by server/tool (when CLI reports)
- `ecosystem_gaps` view — zero-result action intents

Run weekly:

```bash
npm run benchmark:eval
```

Compare `benchmark/reports/latest.md` to previous commit. Gate ranking changes on no regression on `lexical_easy` stratum.

---

## Known MVP limitations (communicate to testers)

- Stdio servers cold-start per invoke (warm pool planned).
- Conversational intents may miss without Sprint 6 hybrid search.
- Benchmark labels require periodic updates as catalog grows.
- Cloud does not execute third-party MCP tools.
- Full JSON Schema validation not enforced locally yet.

---

## Support & feedback loop

1. Collect failed intents from `ecosystem_gaps` and admin dashboard.
2. Add failing intents to `benchmark/intents.jsonl` with labels.
3. Fix ranking or ingest; re-run eval.
4. Publish sanitized benchmark summary for transparency (optional).

---

## Quick reference URLs to publish

| Resource | Path |
|----------|------|
| Agent skill | `/agents.md` |
| LLM compact | `/llms.txt` |
| MCP registry card | `/.well-known/mcp.json` |
| MCP server | `/api/mcp-server` |
| REST search | `/api/servers/search?q=` |
| CLI | `npx -y @relay/cli` |
