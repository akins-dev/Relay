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
5. execute through Relay-owned local runtime code, outside Relay cloud hosting

Relay should make an AI agent discover and use new capabilities without explicit pre-configuration or context bloat. Relay remains the control plane and runtime interface. Relay cloud should not host arbitrary third-party server processes for the prototype.

## Core Architecture Decision

Relay is still in the path. The product is one local runtime with two interfaces, backed by a cloud control plane.

The split is:

- **Relay Cloud control plane:** catalog ingest, search, server manifests, policy metadata, provenance, account/API key auth, and later cloud-stored vault/policy/audit data.
- **Relay Local runtime:** installed in the agent environment. It receives requests through CLI commands or MCP tools, fetches manifests from Relay Cloud, starts or connects to the target MCP server, enforces local checks, resolves credentials, and reports outcomes.
- **Relay CLI adapter:** an agent-facing command interface for coding agents, terminal agents, scripts, CI, and developer debugging.
- **Relay local MCP adapter:** an agent-facing MCP interface to the same Relay Local runtime, usually started as `relay serve` through a stdio MCP config.
- **Third-party MCP server:** the actual capability provider. For `stdio`, it runs as a child process of Relay Local. For remote MCP, Relay Local connects to its endpoint using the manifest.

This keeps the product through Relay without requiring Relay Cloud to execute untrusted packages. The user-facing invocation boundary should be Relay:

```text
Agent
  -> Relay CLI adapter / Relay local MCP adapter
  -> Relay Cloud manifest and policy APIs
  -> Third-party MCP server
  -> Relay Local scans/normalizes response
  -> Agent
```

Future security, Vault, OAuth, policies, audit, and learned routing should attach to this boundary:

- before invocation: manifest lookup, policy decision, required-secret validation
- during invocation: argument validation, DLP/shell-injection checks, subprocess limits, timeout handling
- after invocation: response scanning, audit/event sync, outcome reporting

Hosted cloud proxy can still be added later for remote-only or enterprise use cases, but it is no longer the default MVP runtime.

## Agent And Configuration Model

Relay should fit how agents already operate. Humans configure, approve, and debug Relay; agents are the primary runtime users.

The product should support one discovery/configuration story with multiple agent-facing entry points.

### Primary Agent Operating Modes

- **MCP-native agent:** configured once with Relay Local as its only required MCP server. The agent calls Relay MCP tools, and Relay discovers and invokes downstream MCP servers on demand.
- **CLI-capable agent:** uses `relay search`, `relay info`, and `relay invoke` as shell commands. This fits coding agents, terminal agents, scripts, CI, and agent frameworks that expose command execution.
- **Remote-only agent:** connects to Relay Cloud MCP for discovery and manifest lookup when the host cannot run local commands. It can discover capabilities, but local invocation requires a Relay Local runtime somewhere in the environment.
- **Human operator or developer:** installs Relay, configures the agent host, manages env/secrets, debugs with the CLI, and reviews/audits behavior. Humans are operators; agents are the main consumers.

### Configuration Paths

#### Local MCP Setup

Use this when the agent host supports stdio MCP servers.

```json
{
  "mcpServers": {
    "relay": {
      "command": "relay",
      "args": ["serve"]
    }
  }
}
```

The agent sees one MCP server: Relay. Relay Local then discovers and invokes downstream MCP servers as needed.

Local Relay MCP should expose:

- `search_tools`
- `get_server_manifest`
- `invoke_tool`

`invoke_tool` belongs here because execution happens locally through Relay-owned runtime code.

#### CLI Setup

Use this for CLI-capable agents, scripts, CI, and developer debugging.

```bash
relay search "send transactional email"
relay info sendgrid-mail
relay invoke sendgrid-mail send_email --json '{"to":"user@example.com"}'
```

The CLI and `relay serve` must share the same runtime implementation. They are two adapters, not two separate execution stacks.

#### Relay Cloud MCP Setup

Use this when an agent can connect to remote MCP but cannot run local commands.

Relay Cloud MCP exposes only:

- `search_tools`
- `get_server_manifest`

It can help the agent discover the right server and manifest, but it should not claim to invoke tools unless a separate hosted execution product is deliberately added later.

### Is CLI Plus MCP Overkill?

No, as long as they share one runtime.

It would be overkill to build a CLI execution path and a separate MCP execution path. It is not overkill to expose the same runtime through both adapters, because agent environments expose different capabilities:

- MCP-native agents expect tools
- CLI-capable agents expect commands
- scripts and CI expect commands
- human operators need commands for setup and debugging
- minimal users need one MCP config entry, not many downstream server configs

The implementation rule is:

```text
relay invoke(...) and local MCP invoke_tool(...) both call the same invokeTool(...) runtime function.
```

## End-To-End Runtime Flows

### Ingest Flow

```text
MCP directories and submissions
  -> Relay Cloud ingest
  -> normalize, dedupe, classify transport, preserve provenance
  -> store canonical server rows
  -> expose through search and manifests
```

For the prototype, ingest should prefer source-provided package metadata and tool schemas. It should not depend on background queues to make search useful.

### Search Flow

```text
Agent
  -> Relay Local CLI / Relay Local MCP / Relay Cloud MCP
  -> search_tools or relay search
  -> Relay Cloud search API
  -> search_servers RPC
  -> ranked servers with tools, schemas, run manifests, and next action
```

Search should prefer useful, runnable results without hiding discovery-only results when those are the best known matches.

### Info Flow

```text
relay info <server>
or local MCP get_server_manifest({ server })
  -> Relay Cloud manifest lookup
  -> return server metadata, tools, schemas, env requirements, run mode, and launch plan
```

This is the "inspect before running" step.

### Invoke Flow

```text
relay invoke <server> <tool> --json '{...}'
or local MCP invoke_tool({ server, tool, args })
  -> fetch latest manifest from Relay Cloud
  -> validate server/tool/arguments
  -> check required env vars or local secrets
  -> apply local policy and request scans
  -> start stdio child process or connect to remote MCP endpoint
  -> MCP initialize
  -> MCP tools/call
  -> bound and scan response
  -> return normalized result
  -> report outcome metadata to Relay Cloud
```

The MVP should report outcome metadata only, not raw tool arguments or raw responses by default.

## Manifest Contract Direction

The manifest is the contract between Relay Cloud and Relay Local. It is not just display metadata.

It should answer:

- can this server be run by Relay Local?
- is it local stdio, remote MCP, or discovery-only?
- what exact command or endpoint should Relay use?
- what env vars or secrets are required?
- what tools and input schemas are available?
- what provenance and confidence should Relay Local show?
- what local policy and runtime limits apply?

The current manifest is a useful start, but it should evolve into a versioned contract:

```ts
{
  version: "relay.manifest.v1",
  server: {
    name: string,
    display_name?: string,
    source: string,
    verified: boolean,
    provenance?: unknown,
    trust_state?: string
  },
  run: {
    mode: "local_stdio" | "remote_mcp" | "discovery_only",
    transport: "stdio" | "streamable_http" | "sse" | "unknown",
    command?: string[],
    endpoint?: string,
    timeout_ms: number
  },
  env: Array<{
    name: string,
    required: boolean,
    secret: boolean,
    format: string,
    source: "local_env" | "local_vault" | "cloud_vault_later"
  }>,
  tools: Array<{
    name: string,
    description?: string,
    inputSchema?: Record<string, unknown>
  }>,
  policy: {
    validate_args: boolean,
    scan_request: boolean,
    scan_response: boolean,
    max_response_bytes: number,
    confirmation_required: boolean
  },
  audit: {
    report_outcome: boolean
  }
}
```

Rules:

- never create a runnable command from a plain GitHub URL
- execute command arrays directly, never shell strings
- prefer package metadata from trusted source registries
- return `discovery_only` with a clear reason when Relay cannot safely run the server
- keep the manifest stable and versioned so CLI, local MCP, and Cloud stay compatible

## Search Quality Direction

The current search path is a good MVP baseline, not the final ranking system.

Current strengths:

- one shared `runSearch` path for REST and MCP
- DB-backed `search_servers` RPC
- intent hash and cache hooks
- confidence scoring
- tool schema trimming
- manifest attached to each result
- knowledge-only deflection in the MCP route

Current gaps:

- no fixed benchmark set yet
- ranking is not explicitly manifest-aware enough
- `proxy_available` terminology is stale for the local-runtime model
- tool-level matching should become stronger than server-level matching
- package-backed runnable stdio results should get a clear boost for action intents
- discovery-only results need a controlled penalty, not total exclusion
- cache-hit and cold-path result shapes need strict parity tests
- behavioral success data must be reported by Relay Local before it can meaningfully improve ranking

Search improvement plan:

1. create a benchmark file of realistic agent intents
2. measure top-1 and top-3 relevance manually first
3. add manifest-aware ranking features: `run_mode`, runnable package metadata, tool schema coverage, env completeness
4. add tool-level scoring so the best tool on a server affects rank
5. reduce old proxy/trust fields in public result payloads
6. add tests for REST/MCP parity and cache/cold parity
7. later use local outcome reports to improve ranking by intent

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
- Relay Cloud MCP endpoint with only:
  - `search_tools`
  - `get_server_manifest`
- Relay manifest generation:
  - `local_stdio`
  - `remote_mcp`
  - `discovery_only`
- Relay Local CLI adapter for CLI-capable agents:
  - `relay search`
  - `relay info`
  - `relay invoke`
- Relay Local MCP adapter for MCP-native agents:
  - `relay serve`
  - local MCP `search_tools`
  - local MCP `get_server_manifest`
  - local MCP `invoke_tool`
- Clear documentation that credentials stay local for the MVP.
- A small benchmark set for search relevance.
- A migration ledger so numbered migrations remain understandable.

### Out Of Scope

- Hosted Relay cloud invocation of third-party MCP tools.
- `/api/proxy/*` runtime execution.
- Relay Cloud-owned control of running MCP server processes.
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
- Existing auth/account routes, because they can support Relay Cloud account/API key control and deleting them is separate product cleanup.
- Manual ingest routes guarded by `CRON_SECRET`.

### Known Legacy References

The public UI has been realigned around Relay Cloud control plane plus Relay Local runtime. Some historical architecture docs and diagrams still preserve the old hosted proxy model. They should be treated as legacy unless they explicitly refer to future Relay Local `invoke_tool`.

Remaining cleanup areas:

- Some sections of `docs/ARCHITECTURE_FLOWS.md`, `docs/ARCHITECTURE_SYSTEM_MAP.md`, and the Excalidraw diagram still preserve older hosted-proxy history and should be rewritten fully when the Relay Local runtime is implemented.
- Database objects such as `intent_server_mappings` and `invoke_outcomes` remain useful later if Relay Local reports outcomes, but they are not current MVP blockers.

## Required Implementation Work

### Phase 1 - Scope Lock And Deletion

Goal: remove surfaces that contradict the prototype.

Tasks:

- Delete hosted proxy execution code.
- Delete post-ingest processing job code.
- Add DB migration that drops the obsolete processing queue.
- Remove public docs that promise Cloud `invoke_tool` or `/api/proxy`.
- Remove admin UI rows that present proxy/cron jobs as active MVP surfaces.
- Replace stale UI examples with `search_tools`, `get_server_manifest`, `relay serve`, and Relay Local CLI examples.
- Keep only `search_tools` and `get_server_manifest` in the MCP surface.

Acceptance:

- `tools/list` returns no `invoke_tool`.
- `/api/proxy/*` no longer exists in the Next.js route tree.
- No scheduled jobs exist in `vercel.json`.
- The docs explain Relay Local execution as the agent runtime boundary.

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

### Phase 4 - Relay Local MVP — IMPLEMENTED

Goal: make the magic real locally through one runtime with two agent-facing adapters.

Status: Implemented 2026-05-11 as `cli/` package (`@relay/cli`). Zero framework dependencies — pure Node.js with `commander` for CLI parsing.

CLI adapter:

- `relay search "send transactional email"`
- `relay info <server>`
- `relay invoke <server> <tool> --json '{}'`
- `relay bootstrap` — outputs compact agent instruction block (~80 tokens for CLI agents)
- `relay bootstrap --mcp` — outputs MCP config JSON snippet

Local MCP adapter:

- `relay serve` starts a local stdio MCP server
- `search_tools` — search Relay Cloud, return results with next action
- `get_server_manifest` — return full manifest
- `invoke_tool` — execute via shared `invokeTool()` runtime

Agent bootstrap (how agents know to call Relay):

- MCP-native: `instructions` field in initialize response (~650 chars), zero extra config
- CLI-capable: `relay bootstrap` outputs compact system prompt injection (~80 tokens)
- Both teach one pattern: "before taking action in an external service, search first"

Architecture:

```
cli/
  src/
    cli.ts                    # Commander entry
    commands/{search,info,invoke,serve,bootstrap}.ts
    runtime/
      relay-client.ts         # HTTP client for Relay Cloud
      mcp-stdio-client.ts     # MCP-over-stdio for child servers
      subprocess.ts           # Spawn, timeout, kill lifecycle
      invoke-tool.ts          # THE shared invokeTool() function
    serve/
      mcp-server.ts           # Local stdio MCP server
      tools.ts                # Tool definitions + handlers
    util/{config,output,errors}.ts
```

Build verified:

- `npx tsc` — zero errors
- `relay --help` — all commands listed
- `relay bootstrap` / `relay bootstrap --mcp` — correct output
- `relay serve` — passes MCP smoke test (initialize, tools/list, ping)

Acceptance (updated):

- ✅ CLI adapter and MCP adapter share one `invokeTool()` runtime function.
- ✅ Local MCP exposes `search_tools`, `get_server_manifest`, `invoke_tool`.
- ✅ Missing env vars produce clear structured errors.
- ✅ Subprocess cleanup: SIGTERM → 3s → SIGKILL, parent exit kills all children.
- ⏳ End-to-end invocation of a package-backed server (needs live Relay Cloud).

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
| Outcome learning | Future ranking loop | Relay Local can report outcomes intentionally |
| Cloud stdio bridge | Separate product | Relay Local adoption proves demand |

## Data Discipline

Rules:

- Do not add a table unless it has an owner, retention story, and MVP consumer.
- Do not add a cron unless the prototype fails without it.
- Do not add a migration without updating `docs/MIGRATION_LEDGER.md`.
- Do not delete an applied migration file; add a later migration that reverses or supersedes it.
- Prefer derived views over durable tables when data can be recomputed.
- Treat Postgres as canonical and Redis/cache state as disposable.

## Decision Summary

The prototype is not a smaller version of the old cloud proxy platform. It is a different agent-centric product slice:

Relay Cloud discovers and governs. Relay manifests. Relay Local executes for agents through CLI and MCP adapters.
