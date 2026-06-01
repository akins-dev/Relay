# Relay Invoke Architecture

Relay invocation is local-first. Relay Cloud discovers servers and returns manifests; Relay Local performs execution in the user's environment.

## Current Flow

1. Agent calls `search_tools(intent)` or `relay search "<intent>"`.
2. Relay Cloud returns ranked servers, relevant tools, input schemas, and a run manifest.
3. Agent calls `invoke_tool` through `relay serve`, or runs `relay invoke <server> <tool>`.
4. Relay Local fetches the manifest, validates the tool and basic input schema, checks required env vars, and routes by `run_mode`.
5. For `local_stdio`, Relay spawns the package command, initializes MCP over stdio, calls `tools/call`, returns structured content, and kills the process.
6. For `remote_mcp`, Relay initializes the remote endpoint and calls `tools/call` over Streamable HTTP or legacy SSE.
7. If an API key is configured, Relay reports a best-effort invoke outcome so future search ranking can learn from real success/failure.

## Discovery Surfaces

Agents can discover Relay through:

- `/api/mcp-server` for native MCP discovery.
- `/agents.md` for full agent instructions.
- `/llms.txt` for compact agent/LLM discovery.
- `/.well-known/mcp.json` and `/.well-known/mcp/server.json` for machine-readable metadata.
- `npx -y @relay/cli serve` for local stdio MCP hosts.
- `npx -y @relay/cli search|info|invoke` for CLI-capable agents.

## Current Protections

- Required env vars are checked before launch.
- Only declared downstream env vars plus a small runtime allowlist are passed to child processes.
- Tool names are validated against the manifest.
- Basic JSON Schema checks catch missing required fields and obvious type mismatches before invoking.
- Subprocesses are killed after each call.
- Stderr buffers are capped.
- Manifest responses are cached briefly to reduce cloud round trips.
- Outcome reporting is authenticated and best-effort.

## Known MVP Gaps

- Stdio servers are cold-started for every invocation, which adds latency for package-backed servers.
- Input validation is intentionally lightweight; full JSON Schema support would need a validator dependency.
- No per-tool allow/deny policy is enforced locally yet.
- No response-size cap or content redaction is enforced before returning tool output to the agent.
- No process sandbox is applied around local stdio execution.
- Remote MCP session handling is basic and should become a reusable transport client.
- No idempotency key is attached to write operations.

## Target Architecture

The practical target is a local invoke gateway:

- `Discovery`: search and manifest fetch stay cloud-backed.
- `Planner`: choose run mode, validate schema, classify risk, and require approval for high-risk writes.
- `Policy`: enforce allowlists, blocked tools, max timeout, max response size, and env scope.
- `Executor`: run stdio/HTTP/SSE through shared MCP transport clients.
- `Pool`: keep selected stdio servers warm with TTL and LRU eviction.
- `Guard`: cap output, redact secrets, normalize errors, and attach idempotency keys where possible.
- `Telemetry`: report latency, success, error type, and intent mapping without sending secrets.

This can be built with existing Node technology. The next highest-impact step is a warm local process pool keyed by manifest command plus env fingerprint. It removes repeated `npx` startup latency while keeping memory bounded with TTL, max-process, and idle cleanup.

## Recommended Defaults

- Keep cold one-shot invoke as the safe default.
- Add `relay serve --warm --max-processes 3 --idle-ttl 300000` for agent hosts.
- Use per-server process reuse only after successful initialize and `tools/list`.
- Restart a process after crash, timeout, protocol error, or manifest/env change.
- Require explicit approval before passing undeclared env vars.
- Add response caps before showing output to the model.
