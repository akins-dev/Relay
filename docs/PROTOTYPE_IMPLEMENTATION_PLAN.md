# Relay Prototype Implementation Plan

Last updated: 2026-05-09
Status: Canonical MVP implementation plan

This file defines the current Relay prototype. If another document disagrees with this file, this file wins until the roadmap is deliberately revised.

## Product Thesis

Relay is a lightweight runtime discovery layer for MCP servers.

The prototype should prove one loop:

1. ingest useful MCP server metadata
2. search by natural-language intent
3. return a small set of relevant servers and tool schemas
4. return a local or remote run manifest
5. let the user's agent host or Relay CLI execute outside Relay cloud

Relay should make an AI agent discover and use new capabilities without explicit pre-configuration or context bloat. Relay cloud should not control, proxy, or host arbitrary third-party server execution.

## Why Scheduled Vercel Crons Were Removed

Scheduled Vercel crons were removed from `vercel.json` because they are not part of the prototype's critical path.

The previous scheduled model kept pushing Relay toward a production operations platform:

- background uptime probing
- schema drift policing
- daily metering resets
- async sandbox extraction
- CVE/security processing queues

Those jobs are good production ideas, but they slow the MVP because they create hidden state and failure modes that are not required to validate search, manifests, and local invocation.

There was also a security reason: accepting Vercel's `x-vercel-cron` header in public handlers was unsafe because external callers can spoof request headers. Cron/admin routes now require `Authorization: Bearer $CRON_SECRET` if they remain exposed.

For the prototype, ingest should be explicit and observable:

- run it manually from admin
- run it manually with `CRON_SECRET`
- run it locally while improving source parsing
- avoid background mutations that make search quality hard to reason about

## MVP Product Contract

### In Scope

- Multi-source catalog ingest from stable MCP directories.
- Canonical `servers` rows with names, descriptions, tags, transports, tools, tool schemas, package info, env var schema, endpoints, source metadata, and provenance.
- REST search via `GET /api/servers/search?q=...`.
- Native MCP endpoint with only:
  - `search_tools`
  - `get_server_manifest`
- Relay manifest generation:
  - `local_stdio`
  - `remote_mcp`
  - `discovery_only`
- CLI-first local execution contract:
  - `relay search`
  - `relay info`
  - `relay invoke`
- Clear documentation that credentials stay local for the MVP.
- A small benchmark set for search relevance.
- A migration ledger so numbered migrations remain understandable.

### Out Of Scope

- Hosted Relay cloud invocation of third-party MCP tools.
- `/api/proxy/*` runtime execution.
- Relay-owned control of running MCP servers.
- Vault-backed credential injection as a prototype requirement.
- OAuth connection management as a prototype requirement.
- Sandbox execution or package probing as a default ingest requirement.
- CVE/security checks as MVP blockers.
- Trust scoring as a go/no-go gate.
- Uptime cron, schema drift cron, processing queues, and daily reset cron.
- Cloud stdio bridge.
- DLP/policy/audit runtime stack.
- Learned routing from invoke outcomes.

## Current Cleanup Decisions

### Removed From Runtime

- Hosted proxy execution routes under `/api/proxy/*`.
- `src/lib/proxy-execute.ts`.
- Post-ingest processing job route.
- `src/lib/processing-jobs.ts`.
- `server_processing_jobs` and `processing_job_health` via migration `037`.
- Scheduled Vercel cron definitions.

### Retained For Now

- `search_events`, because search analytics are still useful for improving ranking.
- `intent_server_mappings`, because it may become useful later for CLI-reported outcomes, but it is not an MVP dependency.
- Existing security scan helpers where they are still used by ingest tests or legacy scoring.
- Existing auth/account routes, because they are not on the prototype critical path and deleting them is separate product cleanup.
- Manual ingest routes guarded by `CRON_SECRET`.

### Known Cleanup Gaps

These references still need to be removed or rewritten so the public surface matches the prototype scope:

- `src/app/docs/page.tsx` still describes `/api/proxy/*`, `invoke_tool`, Vault injection, and proxy security as active behavior.
- `src/app/registry/[name]/page.tsx` still generates `/api/proxy/{server}/{tool}` integration snippets.
- `src/app/connect/page.tsx` still shows REST proxy invocation examples.
- `src/app/HomeClient.tsx` still presents the old `search_tools -> invoke_tool -> proxy` flow.
- `src/app/admin/page.tsx` still lists `/api/proxy/[server]/[tool]` and scheduled cron-style endpoints as active operational API surfaces.
- `docs/DEVELOPMENT.md`, `docs/RATE_LIMITS.md`, `docs/ARCHITECTURE_FLOWS.md`, `docs/ARCHITECTURE_SYSTEM_MAP.md`, `docs/ingest/*`, and the Excalidraw diagram still contain legacy `invoke_tool`, `/api/proxy`, or post-ingest processing queue references.

## Required Implementation Work

### Phase 1 - Scope Lock And Deletion

Goal: remove surfaces that contradict the prototype.

Tasks:

- Delete hosted proxy execution code.
- Delete post-ingest processing job code.
- Add DB migration that drops the obsolete processing queue.
- Remove public docs that promise `invoke_tool` or `/api/proxy`.
- Remove admin UI rows that present proxy/cron jobs as active MVP surfaces.
- Replace stale UI examples with `search_tools`, `get_server_manifest`, and local manifest/CLI examples.
- Keep only `search_tools` and `get_server_manifest` in the MCP surface.

Acceptance:

- `tools/list` returns no `invoke_tool`.
- `/api/proxy/*` no longer exists in the Next.js route tree.
- No scheduled jobs exist in `vercel.json`.
- The docs explain local CLI execution as the execution boundary.

### Phase 2 - Search Quality For Prototype

Goal: make discovery feel sharp enough to demo.

Tasks:

- Keep `search_servers(query_text, result_limit, include_stdio)` as the single search RPC.
- Build a fixed intent benchmark file with 20 to 40 realistic intents.
- Track top-3 relevance manually at first.
- Reduce result payload noise around old proxy/trust fields.
- Prefer tool schemas and package manifests over vanity metadata.
- Add tests for cache-hit and cold-path parity.

Acceptance:

- Top result is plausible for common intents.
- Top 3 contains at least one runnable result for most benchmark intents.
- Returned results always include `manifest` and `next`.
- Search errors identify missing RPC contracts clearly.

### Phase 3 - Manifest Completeness

Goal: make each result actionable without context bloat.

Tasks:

- Normalize package manifests from official registry metadata.
- Normalize env vars into `{ name, required, secret, format, placeholder }`.
- Return exact launch commands only when package metadata is concrete.
- Use `discovery_only` when Relay cannot safely infer a command.
- Add unit tests for npm, PyPI, NuGet, OCI, remote endpoint, and discovery-only manifests.

Acceptance:

- `get_server_manifest` can explain how to run a server or why it cannot.
- Relay never guesses a command from a plain GitHub URL.
- Runnable manifests are deterministic.

### Phase 4 - CLI MVP

Goal: make the magic real locally.

This is the planned next execution slice after the scope cleanup: `relay search`, `relay info`, and `relay invoke`.

Commands:

- `relay search "send transactional email"`
- `relay info <server>`
- `relay invoke <server> <tool>`

Minimum behavior:

- Fetch Relay search/manifest data.
- Resolve env vars from the local environment.
- Spawn package-backed stdio servers locally.
- Speak MCP over stdio.
- Call the requested tool with JSON args.
- Kill the subprocess on timeout or parent exit.
- Print structured errors when env vars or schemas are missing.

Do not add yet:

- cloud sandbox
- Vault injection
- remote process control
- audit sync
- DLP/policy stack
- generalized GitHub clone execution

Acceptance:

- A local package-backed stdio MCP server can be discovered and invoked from the CLI.
- Missing secrets produce a clear local error.
- The CLI cleans up child processes reliably.

### Phase 5 - Prototype Review

Goal: confirm the MVP is actually shippable.

Checklist:

- `npm test` passes.
- `npx tsc --noEmit` passes.
- REST search returns manifests.
- MCP `tools/list` exposes only the two prototype tools.
- MCP `search_tools` returns usable results for benchmark intents.
- MCP `get_server_manifest` returns launch data for package-backed servers.
- Docs do not claim hosted proxy execution.
- Migration ledger reflects every migration through the latest number.

## Good Ideas Isolated For Later

These are valuable, but they should not block the prototype.

| Idea | Keep As | Revisit When |
|---|---|---|
| Subprocess lifecycle manager | CLI implementation detail | CLI can already invoke one package-backed server |
| Source-provided launch manifests | Ingest metadata priority | Official/server-card metadata becomes common |
| Sandbox extraction | Optional offline enrichment | Search suffers because too many stdio rows lack tools |
| CVE/security scanning | Registry quality signal | Users ask for production trust signals |
| Trust scoring | Ranking/supporting metadata | There is enough real usage data to calibrate it |
| Outcome learning | Future ranking loop | CLI can report outcomes intentionally |
| Cloud stdio bridge | Separate product | Local CLI adoption proves demand |

## Data Discipline

Rules:

- Do not add a table unless it has an owner, retention story, and MVP consumer.
- Do not add a cron unless the prototype fails without it.
- Do not add a migration without updating `docs/MIGRATION_LEDGER.md`.
- Do not delete an applied migration file; add a later migration that reverses or supersedes it.
- Prefer derived views over durable tables when data can be recomputed.
- Treat Postgres as canonical and Redis/cache state as disposable.

## Decision Summary

The prototype is not a smaller version of the old cloud proxy platform. It is a different product slice:

Relay cloud discovers. Relay manifests. The local agent host executes.
