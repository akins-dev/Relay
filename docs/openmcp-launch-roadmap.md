# openMCP Launch Roadmap

Canonical tracker for the remote-first launch, future CLI bridge, and claim-alignment work. Update this file as implementation and positioning evolve so future sessions can resume without re-deriving the plan.

## Current Positioning

- `openMCP` is the public discovery, trust, and secure invocation layer for network-reachable MCP servers.
- `AgentSecrets` remains a separate TheSeventeen product and is the planned credential substrate for `openMCP CLI`.
- Remote HTTP/SSE/StreamableHTTP support is the launch surface today.
- Local `stdio` support is intentionally deferred to `openMCP CLI`.

## Launch Phases

### Phase 1: Remote-first openMCP

Goal:
- Launch openMCP as the agent-first way to discover and securely invoke remote MCP servers at runtime.

Public story:
- The hardcoded-tool problem.
- The context-window problem.
- Runtime discovery by intent.
- Secure remote invocation through trust, policy, and proxy controls.

Must be true at launch:
- Public copy clearly says remote/network-reachable MCP today.
- CLI/stdIO is framed as next, not as already shipped.
- Security claims match implementation behavior.

### Phase 2: openMCP CLI

Goal:
- Extend the same discovery layer to local `stdio` MCP servers.

Public story:
- Why remote came first.
- Why `stdio` matters.
- How the local bridge works.
- Why AgentSecrets is the right credential layer for local execution.

Must be true before announcement:
- CLI architecture is decision-complete.
- Local credential flow is defined and secure.
- Remote-vs-local routing rules are explicit.

## Implementation Backlog

### Remote launch checklist

- [x] Reframe homepage, docs, README, and API copy around remote-first positioning.
- [x] Add a repo tracker for launch sequencing and future CLI work.
- [ ] Review remaining marketing surfaces for universal/all-MCP wording.
- [ ] Add a small “CLI coming next” teaser section on the marketing site if needed.
- [ ] Create launch assets: homepage screenshots, demo script, announcement outline.

### Claim alignment

- [x] Replace response-side “blocked” language with “scanned / warned / audited” where that matches implementation.
- [x] Remove or defer PKCE claims in public copy until implemented.
- [x] Clarify that openMCP currently focuses on network-reachable MCP servers.
- [ ] Audit free-plan / rate-limit copy for exact accuracy across all surfaces.
- [ ] Decide whether the public “15-layer” framing should remain aggregate marketing language or be split more explicitly by publish/runtime/infra.

### CLI roadmap

- [ ] Define the `openMCP CLI` architecture.
- [ ] Define how the local bridge exposes `search_tools` and `invoke_tool` to host apps.
- [ ] Define local install/run manifests for `stdio` servers.
- [ ] Define remote-vs-local routing rules after search results are returned.
- [ ] Define CLI UX for install, trust prompts, updates, and uninstalls.
- [ ] Define what telemetry/audit data stays local vs syncs to openMCP cloud.

### AgentSecrets integration

- [ ] Define where AgentSecrets is required vs optional in CLI workflows.
- [ ] Define the credential handoff between `openMCP CLI` and AgentSecrets.
- [ ] Decide whether the CLI shells out to AgentSecrets or uses an SDK/API.
- [ ] Define local secret resolution at process spawn for `stdio` MCP servers.
- [ ] Define fallback UX when AgentSecrets is not installed.

### Registry model updates

- [ ] Surface transport metadata clearly in API and UI.
- [ ] Distinguish `discoverable` from `invokable_now`.
- [ ] Add future support for indexing `stdio` servers without pretending they are remotely invokable.
- [ ] Define whether `stdio` listings should appear in search before the CLI ships.
- [ ] Define trust signals specific to local/package-based MCP servers.

### Launch execution

- [ ] Write the remote-launch announcement.
- [ ] Write the CLI follow-up announcement.
- [ ] Build a remote-first demo: search -> trust selection -> secure invoke.
- [ ] Build a CLI demo: search -> local spawn -> AgentSecrets-backed auth -> tool result.

## Risks / Claim Gaps

- Response DLP/PII/indirect-injection checks currently warn and audit; they do not block the response body by default.
- OAuth copy previously implied PKCE. Current implementation uses validated redirects, CSRF state, encrypted token storage, and route-level rate limits; broader OAuth hardening remains open.
- The product currently skips `stdio` servers during ingest for proxy invocation, so “universal MCP registry” wording is misleading until the CLI bridge exists.
- Build output currently shows config drift in a few areas (`next.config.js` warnings, Sentry deprecations, font-fetch dependency in build).
- Some marketing copy may still overstate “free forever / no rate limits” relative to actual rate limiting behavior.

## Next Recommended Work

1. Finish copy review across any remaining marketing surfaces and social launch drafts.
2. Decide how much of the CLI roadmap should be public before implementation starts.
3. Write the `openMCP CLI` technical spec:
   - local bridge lifecycle
   - process spawning
   - manifest shape
   - AgentSecrets credential path
   - audit and warning boundaries
4. Decide whether `stdio` servers should be indexed before the CLI exists.
5. Clean up build/config drift so launch confidence matches launch messaging.

## Decisions Made

- Tracker lives in the repo as markdown.
- Brand structure: separate products under TheSeventeen.
- Launch order: `openMCP` remote first, `openMCP CLI` second.
- Credential strategy for CLI: use AgentSecrets rather than building a second credential subsystem inside openMCP.
- Positioning at launch: discovery and secure invocation for remote/network-reachable MCP servers.
