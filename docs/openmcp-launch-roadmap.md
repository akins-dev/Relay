# openMCP Launch Roadmap

Canonical tracker for the remote-first launch, future CLI bridge, and claim-alignment work. Update this file as implementation and positioning evolve so future sessions can resume without re-deriving the plan.

## Current Positioning

- `openMCP` is the public discovery, trust, and secure invocation layer for network-reachable MCP servers.
- `AgentSecrets` remains a separate TheSeventeen product and is the planned credential substrate for `openMCP CLI`.
- Remote HTTP/SSE/StreamableHTTP support is the launch surface today.
- Local `stdio` support is intentionally deferred to `openMCP CLI`.
- Working rebrand direction is documented in [agentrail-brand-identity.md](/home/akins-dev/projects/mcp-registry-next/docs/agentrail-brand-identity.md).

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

### Brand and website

- [x] Create a working brand identity doc for the rename direction.
- [ ] Confirm the final product name after availability/trademark review.
- [ ] Translate the chosen brand system into site-wide design tokens.
- [ ] Decide the website information architecture for the rename launch.
- [ ] Migrate shared UI primitives to Tailwind before page-by-page redesign.
- [ ] Redesign the homepage under the new brand.

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

## Immediate Fix Checklist

These are the highest-priority implementation fixes identified during the pre-manual-testing review. They should be completed before relying on manual testing results as a launch-readiness signal.

### P0: Fix before serious manual testing

- [x] Make native MCP `invoke_tool` use the same credential injection path as the REST proxy.
- [x] Make native MCP `invoke_tool` validate tool existence before forwarding.
- [x] Make native MCP `invoke_tool` validate upstream endpoint safety with `isSafeUrl()`.
- [x] Add structured auth guidance parity to MCP invocation failures where feasible.
- [x] Fix REST proxy rate limiting so authenticated/API-key users can actually receive the higher limit.
- [x] Fix MCP server rate-limit config so authenticated users are not accidentally throttled more than anonymous callers.
- [x] Fix invalid `Retry-After` handling that currently references a missing `resetAt` field from the rate-limit helper.
- [x] Make native MCP `search_tools` return full tool schema data, not just names.

### P1: Fix next

- [x] Fix search-result credential guidance so OAuth-backed servers do not get API-key-only setup instructions.
- [ ] Bring the manual publish flow closer to ingest parity: endpoint safety, transport detection, and schema enrichment.
- [ ] Review SSE compatibility claims and narrow them if actual client compatibility is not verified.
- [x] Patch stale domain references such as `registry.the-17.dev` in registry integration snippets.
- [ ] Tighten SSRF validation patterns, including the IPv6 private-range regex.

### P2: Follow-up hardening

- [x] Consolidate proxy and MCP invocation logic to reduce divergence.
- [ ] Decide whether the MCP server should return structured warning metadata for response scans instead of only embedding text output.
- [ ] Add dedicated tests for authenticated vs anonymous rate limiting behavior.
- [ ] Add dedicated tests for MCP-server invocation of authenticated/private tools.
- [ ] Add dedicated tests for OAuth-backed search-result setup instructions.

## Verification Snapshot

- `npm test -- --runInBand` passed after the implementation fixes.
- `npm run build` still fails on the existing external Google Fonts fetch dependency (`fonts.googleapis.com`) in this environment.
- `npm run build` also still surfaces the pre-existing Next.js config warning for `serverExternalPackages` and Sentry instrumentation/deprecation warnings.

## Manual Test Order

1. Run public search over REST and confirm `tool_schemas` are present.
2. Run `search_tools` through the native MCP server and confirm the same schema richness is returned.
3. Invoke a public remote tool through REST and confirm normal success headers and body shape.
4. Invoke the same public tool through the MCP server and confirm it routes through the proxy path and returns proxy metadata.
5. Invoke a private API-key-backed server through REST with and without stored credentials and verify the structured setup guidance.
6. Invoke the same private API-key-backed server through the MCP server and confirm the result matches the REST auth/setup behavior.
7. Invoke an OAuth-backed server from the registry and verify the search result points to OAuth connect flow rather than vault-only setup.
8. Start the OAuth flow from the registry page and confirm `/api/oauth/start` works for servers that expose OAuth metadata.
9. Exercise rate limits both anonymously and with an `sk_mcp_...` API key to verify the higher limit path.
10. Publish a server manually and compare its invocation/search behavior against an ingested server to identify remaining publish-path gaps.

## Remaining Known Gaps

- Manual publish is still weaker than ingest. It needs endpoint safety checks, transport detection, and schema enrichment parity.
- SSE compatibility is still not validated against real older MCP clients, so marketing copy should avoid overstating that path.
- SSRF validation still needs a targeted review, especially the IPv6 private-range regex.
- The MCP server currently returns warning metadata inside its text payload for scanned responses; it does not yet expose a richer structured warning contract.

## Decisions Made

- Tracker lives in the repo as markdown.
- Brand structure: separate products under TheSeventeen.
- Launch order: `openMCP` remote first, `openMCP CLI` second.
- Credential strategy for CLI: use AgentSecrets rather than building a second credential subsystem inside openMCP.
- Positioning at launch: discovery and secure invocation for remote/network-reachable MCP servers.
- Working rename direction: `Agentrail`.
