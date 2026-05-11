# Relay Delivery Roadmap

Last updated: 2026-05-09
Status: Canonical sprint-by-sprint delivery plan

This roadmap follows the prototype decision recorded in `PROTOTYPE_IMPLEMENTATION_PLAN.md`: Relay cloud discovers and returns run manifests; the user's local agent host or Relay CLI executes.

## Current Delivery State

Relay has moved away from the previous hosted proxy platform plan.

Current prototype loop:

1. ingest MCP server metadata
2. search by intent
3. return relevant tools and schemas
4. return a local or remote run manifest
5. execute through local CLI/agent host

The previous `search -> invoke -> learn` cloud loop is no longer the MVP path.

## MVP Gate

The MVP is launchable when these P0 gates are green.

### P0 Gates

- Catalog quality
  - official ingest succeeds
  - at least one community source succeeds
  - active rows have stable names, descriptions, tools or tool hints, transport, source, and provenance
  - package-backed stdio rows preserve package metadata when available
- Search quality
  - one canonical `search_servers(query_text, result_limit, include_stdio)` contract works in all environments
  - REST and MCP search responses both include `manifest` and `next`
  - top-3 relevance is acceptable on the fixed prototype benchmark set
  - knowledge-only MCP intents return `no_tool_needed`
- Manifest quality
  - `local_stdio`, `remote_mcp`, and `discovery_only` modes are deterministic
  - Relay never guesses runnable commands from a plain GitHub URL
  - env vars are normalized and marked as required/secret where source metadata supports it
- CLI proof
  - `relay search` can query Relay
  - `relay info` can fetch a manifest
  - `relay invoke` can run at least one package-backed stdio MCP server locally
  - child processes are cleaned up on timeout or exit
- Scope discipline
  - no hosted proxy execution surface
  - no scheduled Vercel cron dependency
  - no sandbox/CVE/processing queue on the MVP path
  - migration ledger is current

## Completed Prototype Cleanup

- Removed scheduled Vercel crons.
- Kept cron/admin auth on `Authorization: Bearer $CRON_SECRET` only.
- Removed `invoke_tool` from the native MCP server.
- Added `get_server_manifest`.
- Added Relay manifest generation.
- Simplified REST search around `runSearch`.
- Removed post-ingest processing job runtime.
- Added migration `037` to retire the processing queue table/view.
- Removed hosted proxy route files and proxy execution core.

## Sprint 0 - Scope Lock

Goal: stop the repo from pulling the product back into production-platform mode.

Tasks:

- Align README, agents docs, MCP metadata, roadmap, decision log, changelog, and migration ledger.
- Remove or rewrite public references to `invoke_tool` and `/api/proxy`.
- Mark old security/trust/proxy docs as legacy where they remain.
- Keep old ideas only as explicitly deferred modules.

Exit criteria:

- A new contributor can read the docs and understand that Relay is discovery + manifest + local CLI for MVP.
- No active docs promise hosted cloud invocation.

## Sprint 1 - Catalog Ingest

Goal: build enough reliable data for useful search.

Tasks:

- Treat `catalog` mode as the default prototype path.
- Keep source fetchers small and predictable.
- Prefer official/package metadata over README guesses.
- Preserve existing failure/security fields without letting catalog ingest erase them.
- Remove async post-ingest queue assumptions from docs and UI.

Exit criteria:

- A manual ingest run produces searchable rows.
- Ingest output explains added/updated/skipped/rejected rows.
- Package-backed stdio servers can become `local_stdio` manifests.

## Sprint 2 - Search Relevance

Goal: make `search_tools` feel useful.

Tasks:

- Create a fixed benchmark set of common intents.
- Score top-1 and top-3 results manually at first.
- Trim result payloads around prototype needs.
- Keep manifest and tool schema parity between cache-hit and cold-path responses.
- Add tests for REST/MCP response parity.

Exit criteria:

- Search is good enough for demos and early users.
- Search failures are contract errors, not silent bad responses.

## Sprint 3 - Manifest Hardening

Goal: make `get_server_manifest` the bridge between discovery and execution.

Tasks:

- Add focused manifest unit tests.
- Improve package command normalization.
- Normalize env var schema from all sources.
- Make `discovery_only` explanations clearer.
- Add source/provenance hints so agents understand confidence.

Exit criteria:

- Agents can reliably tell whether a result is locally runnable, remotely connectable, or discovery-only.

## Sprint 4 - CLI MVP

Goal: make local invocation real.

Tasks:

- Scaffold Relay CLI.
- Implement `relay search`.
- Implement `relay info`.
- Implement `relay invoke` for package-backed stdio servers.
- Add subprocess lifecycle cleanup.
- Validate required env vars locally.
- Speak MCP over stdio for tool calls.

Exit criteria:

- One known package-backed server can be discovered and invoked locally end to end.

## Sprint 5 - Prototype Review

Goal: ship a small usable prototype.

Tasks:

- Run typecheck and tests.
- Run manual REST and MCP smoke tests.
- Run CLI smoke tests.
- Review docs for stale production-platform claims.
- Document known limitations.

Exit criteria:

- The prototype demonstrates the core Relay magic without hiding behind future features.

## Deferred Ideas

These ideas remain valuable but are explicitly outside the prototype:

- hosted proxy invocation
- Vault credential injection
- OAuth connection management
- DLP/policy/audit runtime stack
- sandbox extraction
- CVE scanning as a gate
- production trust scoring
- cloud stdio bridge
- learned routing from invoke outcomes

They should only return after the prototype proves that discovery + manifests + local invocation are useful.

