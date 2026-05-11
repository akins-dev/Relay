# Relay Delivery Roadmap

Last updated: 2026-05-09
Status: Canonical sprint-by-sprint delivery plan

This roadmap follows the prototype decision recorded in `PROTOTYPE_IMPLEMENTATION_PLAN.md`: Relay Cloud is the control plane, and Relay Local is one agent runtime exposed through CLI and local MCP adapters.

## Current Delivery State

Relay has moved away from the previous hosted proxy platform plan.

Current prototype loop:

1. ingest MCP server metadata
2. search by intent
3. return relevant tools and schemas
4. return a local or remote run manifest
5. execute through Relay Local, either by CLI-capable agent commands or local MCP `invoke_tool`

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
- Relay Local agent-runtime proof
  - `relay search` can query Relay
  - `relay info` can fetch a manifest
  - `relay invoke` can run at least one package-backed stdio MCP server locally
  - `relay serve` can expose the same runtime as a local MCP server for MCP-native agents
  - child processes are cleaned up on timeout or exit
- Scope discipline
  - no hosted proxy execution surface
  - no scheduled Vercel cron dependency
  - no sandbox/CVE/processing queue on the MVP path
  - migration ledger is current

## Completed Prototype Cleanup

- Removed scheduled Vercel crons.
- Kept cron/admin auth on `Authorization: Bearer $CRON_SECRET` only.
- Removed `invoke_tool` from the Cloud MCP server.
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
- Remove or rewrite public references to Cloud `invoke_tool` and `/api/proxy`.
- Mark old security/trust/proxy docs as legacy where they remain.
- Keep old ideas only as explicitly deferred modules.

Exit criteria:

- A new contributor can read the docs and understand that Relay is Cloud control plane + Local agent runtime for MVP.
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

Goal: make `search_tools` feel useful to agents.

Tasks:

- Create a fixed benchmark set of common intents.
- Score top-1 and top-3 results manually at first.
- Add manifest-aware ranking features: run mode, package-backed runnable status, tool schema coverage, and env completeness.
- Add tool-level matching so the best matching tool influences the server rank.
- Trim result payloads around prototype needs.
- Keep manifest and tool schema parity between cache-hit and cold-path responses.
- Add tests for REST/MCP response parity.

Exit criteria:

- Search is good enough for realistic agent tasks and demos.
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

## Sprint 4 - Relay Local MVP

Goal: make local invocation real through one runtime with CLI and MCP agent adapters.

Tasks:

- Scaffold Relay Local runtime shared by CLI and MCP server mode.
- Implement `relay search`.
- Implement `relay info`.
- Implement `relay invoke` for package-backed stdio servers.
- Implement `relay serve` as a local stdio MCP server.
- Expose local MCP tools: `search_tools`, `get_server_manifest`, and local-only `invoke_tool`.
- Add subprocess lifecycle cleanup.
- Validate required env vars locally.
- Speak MCP over stdio for tool calls.

Exit criteria:

- One known package-backed server can be discovered and invoked locally end to end from both `relay invoke` and local MCP `invoke_tool`.

## Sprint 5 - Prototype Review

Goal: ship a small usable prototype.

Tasks:

- Run typecheck and tests.
- Run manual REST and MCP smoke tests.
- Run CLI and local MCP smoke tests.
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
