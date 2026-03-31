# Agentrail Brand Identity

Working brand identity for the openMCP rename. This document is the source of truth for naming, positioning, voice, visual direction, and the first website/Tailwind pass.

Status:
- Working recommendation: `Agentrail`
- Company: `TheSeventeen`
- Credential product stays separate: `AgentSecrets`
- Product rename is not yet applied in code/UI copy everywhere

## Brand Decision

### Recommended Name

`Agentrail`

Why this works:
- Feels infrastructural, not generic or novelty-driven.
- Suggests routing, control, trust, and safe execution.
- Gives the product room to grow beyond MCP without sounding detached from agents.
- Is more ownable than a protocol-generic name like `openMCP`.

### Brand Architecture

- `TheSeventeen`
  - parent organization
- `Agentrail`
  - core platform brand
- `Agentrail Cloud`
  - hosted discovery, trust, and remote invocation layer
- `Agentrail CLI`
  - future local bridge for `stdio` and hybrid flows
- `AgentSecrets`
  - separate credential infrastructure product from TheSeventeen

### Product Relationship

- `Agentrail` owns discovery, trust, routing, policy, and invocation.
- `AgentSecrets` owns zero-knowledge local/runtime credential handling where needed.
- Hosted remote credentials remain in the server-side vault architecture.

## Positioning

### One-Line Positioning

`Agentrail is the trust and invocation layer for agent tools.`

### Clear Product Description

`Agentrail helps AI agents discover the tools they need at runtime and invoke them through a secure trust, policy, and credential layer.`

### Launch Description

`Agentrail is a discovery and secure invocation layer for remote, network-reachable MCP servers.`

### Expanded Description

`Instead of hardcoding tool connections into every agent workflow, Agentrail lets agents search for the right capability by intent at runtime, evaluate trust and compatibility, and invoke tools through a hosted proxy that handles policy, credentials, and auditability.`

## Messaging

### Core Thesis

- Agents should not rely on a small, preloaded tool list.
- Tool discovery should happen at runtime by intent.
- Tool use should pass through trust, credential, and policy controls.
- Hosted remote invocation is the launch wedge.

### Taglines

Primary:
- `Find the right tool. Invoke it safely.`

Secondary options:
- `Runtime tool discovery for AI agents`
- `Secure invocation for autonomous agents`
- `The trust layer for agent tools`

### Messaging Pillars

- `Discover by intent`
  - Agents search for the tool they need at runtime instead of relying on hardcoded integrations.
- `Invoke through trust`
  - Calls route through a security and policy layer rather than going direct to unknown endpoints.
- `Handle credentials safely`
  - Credentials are injected outside agent arguments and memory wherever possible.
- `Audit every call`
  - Tool usage is observable, reviewable, and governable.

### What We Should Avoid Saying

- Avoid `universal MCP registry` until local `stdio` story exists.
- Avoid implying all security scans are blocking when some are warning/audit layers.
- Avoid making `AgentSecrets` sound like the same product as `Agentrail`.

## Audience

Primary:
- builders of agent platforms
- developers shipping AI workflows with real tool usage
- teams that need centralized control over tool discovery and invocation

Secondary:
- infra/security-minded early adopters in the MCP ecosystem
- teams evaluating remote MCP governance

## Voice And Tone

### Personality

- precise
- calm
- credible
- technical without being cold
- ambitious without hype

### Writing Rules

- Lead with the problem and system behavior, not slogans.
- Prefer concrete language over visionary abstraction.
- Use `agents`, `tools`, `runtime`, `policy`, `credentials`, `trust`, `invocation`.
- Do not overuse `AI-native`, `revolutionary`, `magic`, or similar startup filler.

### Example Copy

Good:
- `Agents search for tools by intent and invoke them through a trust layer.`
- `Credentials stay out of tool arguments and are injected by the platform.`

Bad:
- `The future of agentic orchestration starts here.`
- `One platform to rule all MCP forever.`

## Visual Identity

### Brand Feel

- control plane
- infrastructure-grade
- high trust
- modern and intentional

### Color System

Primary palette:
- `Ink`: `#0F172A`
- `Rail`: `#2563EB`
- `Signal`: `#06B6D4`
- `Mist`: `#E2E8F0`
- `Steel`: `#64748B`
- `White`: `#F8FAFC`

Semantic accents:
- `Trust`: `#16A34A`
- `Warn`: `#D97706`
- `Danger`: `#DC2626`

Suggested CSS tokens:

```css
:root {
  --brand-ink: #0f172a;
  --brand-rail: #2563eb;
  --brand-signal: #06b6d4;
  --brand-mist: #e2e8f0;
  --brand-steel: #64748b;
  --brand-white: #f8fafc;
  --brand-trust: #16a34a;
  --brand-warn: #d97706;
  --brand-danger: #dc2626;
}
```

### Typography

- Headlines: `Space Grotesk`
- Body: `Inter`
- Mono: `IBM Plex Mono`

Typography guidance:
- Use strong, compact headlines.
- Keep body copy highly readable and neutral.
- Use mono for technical data, snippets, labels, and metrics.

### Logo Direction

Use a wordmark-first approach.

Concept directions:
- a rail/track motif suggesting guided routing
- a linear path with nodes suggesting selection and invocation
- a subtle switch/relay concept rather than a literal robot/brain icon

Avoid:
- generic sparkles
- brain logos
- chatbot bubbles
- orbit gradients with no structural meaning

## Website Direction

### Homepage Narrative

1. Hero
   - problem: hardcoded tools and context overload
   - promise: runtime discovery + secure invocation
2. How it works
   - search
   - trust/policy layer
   - credential injection
   - audited result
3. Why it matters
   - better agent adaptability
   - safer tool execution
   - simpler integration surface
4. Launch scope
   - remote/network-reachable MCP support today
   - CLI/local support coming next
5. Product trust section
   - scan, warn, policy, audit, vault

### Homepage Headline Options

- `Runtime tool discovery for AI agents`
- `Secure tool invocation for autonomous agents`
- `The trust layer for agent tools`

Recommended pairing:

- Headline: `Runtime tool discovery for AI agents`
- Subhead: `Agentrail helps agents find the right remote tool at runtime and invoke it through a secure trust, policy, and credential layer.`

## Tailwind Migration Direction

Tailwind is a good move for the rebrand because it will help unify spacing, states, and responsive behavior while you redesign the site.

### Recommended Approach

- Do not do a blind utility rewrite first.
- Start by defining design tokens from this brand system.
- Move shared primitives first:
  - buttons
  - badges
  - cards
  - layout containers
  - typography helpers
- Then migrate the top-level marketing pages:
  - homepage
  - docs landing
  - connect page
- Then migrate app surfaces:
  - registry detail
  - dashboard

### Tailwind Token Mapping

Add brand colors and fonts to Tailwind config before page migration.

Suggested semantic keys:
- `brand.ink`
- `brand.rail`
- `brand.signal`
- `brand.mist`
- `brand.steel`
- `brand.trust`
- `brand.warn`
- `brand.danger`

## Rollout Plan

### Phase 1

- keep the product logic as-is
- adopt `Agentrail` as the working brand in docs and planning
- redesign homepage and marketing surfaces
- preserve current remote-first positioning

### Phase 2

- rename visible user-facing copy across product surfaces
- keep `openMCP` references only where backward compatibility matters
- launch `Agentrail CLI` when local `stdio` story is ready

## Decision Notes

- `Agentrail` is the current recommended rename, not yet a final legal/trademark confirmation.
- `AgentSecrets` remains separate and should not be collapsed into the `Agentrail` brand.
- Tailwind migration should happen as part of the redesign, not as an isolated refactor.
