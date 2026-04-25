# Relay — Overview & Roadmap

> *The agent-centric capability access layer for the practical MCP configuration ceiling.*
> Canonical technical reference: [`docs/TECHNICAL_BACKBONE.md`](docs/TECHNICAL_BACKBONE.md)
> Canonical sprint plan: [`docs/DELIVERY_ROADMAP.md`](docs/DELIVERY_ROADMAP.md)

---

## What Relay Solves

Relay solves the practical MCP configuration ceiling.

MCP standardized the connection layer, but it did not solve open-world capability access across a large and growing server ecosystem.

The problem is that usable capacity collapses once teams have to keep discovering, evaluating, wiring, authenticating, exposing, and maintaining more and more servers by hand. Long before the ecosystem runs out of capability, humans and agents hit a sanity ceiling:

- too many servers to configure explicitly
- too many tools to expose cleanly
- too much auth and transport complexity to manage by hand
- too much model confusion once the surface gets large
- too many 1:1 integration projects for each new capability

Recent advances in RAG and orchestration frameworks do not replace this need. RAG improves knowledge retrieval. LangChain and LangGraph improve coordination, state, and multi-step execution. None of them solve open-world MCP capability discovery, context bloat across large tool surfaces, or centralized security, trust, and credential handling across thousands of possible integrations.

Relay changes the model from explicit preload to runtime capability resolution.

```text
search_tools("send a transactional email with HTML body")
-> returns ranked, verified server/tool options with trimmed schemas

invoke_tool({ server: "sendgrid-mail", tool: "send_email", args: {...} })
-> executes through one guarded runtime path
```

The two-tool interface is the current implementation, not the thesis by itself. The thesis is that the model-facing surface should stay small while capability discovery, ranking, auth, trust, and execution happen at runtime.

The deeper differentiator is the learning loop. Relay is designed to record which server/tool combinations actually worked for which intents so routing gets better over time instead of staying static.

In that sense, Relay complements the rest of the 2026 agent stack:

- RAG helps answer knowledge-heavy questions with better retrieval
- LangChain and LangGraph help orchestrate the agent's reasoning and workflow
- Relay helps the agent discover and use MCP capability at runtime without exploding the model-facing surface

---

## What Exists Today

### Core runtime

- Native MCP server at `/api/mcp-server`
- `search_tools`: FTS + trigram retrieval across 20,000+ indexed servers with confidence scoring
- `invoke_tool`: direct execution through the security proxy
- Lever 3A knowledge classifier to deflect non-action queries before search
- Intent cache for frequent intent -> server mappings
- Schema trimming so each result surfaces the most relevant tools
- Historical confidence boosts from prior invoke outcomes
- SSE transport for legacy clients

### Registry and ingest

- Ingest from active sources including Official Registry, Smithery, Glama, PulseMCP, GitHub, verified organization feeds, ClaudeMCP, MCP.so, MCP.run, and Composio
- Canonical normalized `servers` rows in Postgres
- Three-tier ingest skip pipeline: timestamp -> hash -> full refresh
- Dedup, normalization, trust scoring, scan history, and schema snapshots
- `stdio` rows preserved even when not cloud-invocable yet

### Security and execution control

- security stack across scan, invoke, auth, DLP, SSRF, and confirmation paths
- Schema drift detection with automatic suspension on post-approval mutation
- Re-scan on drift events
- Rate limiting and response-size guards
- Per-user, per-server, per-tool policy controls
- HMAC-signed confirmation flow for destructive actions

### Credentials and vault

- Supabase Vault / pgsodium-backed secret storage
- Automatic credential injection across known key-name variants
- Structured 401 responses that tell the agent what credential is missing
- OAuth connection flow in progress as part of the runtime credential layer

### Analytics and training data

- `search_events`: every search call
- `invoke_outcomes`: every invoke result
- `intent_server_mappings`: aggregated intent -> server -> tool outcomes
- Views for top intents, gaps, search quality, and server reliability

This is the training corpus for later learned routing. The current system already records the loop that future routing depends on.

---

## What Is Good Now Vs Not Yet Optimal

Relay is already a credible MVP because it keeps the agent interface small, centralizes runtime control, and measures the full search -> invoke -> learn loop.

The current gaps are real, and they are already mapped to the roadmap:

| Current gap | What improves it | Sprint |
|---|---|---|
| Search still returns result sets the model must interpret | speculative invocation on obvious single matches; learned routing for common intents | Sprint 4, Sprint 8+ |
| Confidence is heuristic + empirical aggregate, not learned routing | learned Lever 3B classifier and later learned routing | Sprint 6, Sprint 8+ |
| Schema trimming is lexical, not intent-model-aware | stronger reranking first, then adaptive tool surfacing once confidence is high enough | Sprint 6, Sprint 8+ |
| No speculative execution yet | high-confidence speculative invocation | Sprint 4 |
| No ephemeral tool materialization yet | adaptive or ephemeral tool surfacing on stable high-confidence paths | Sprint 8+ |
| No trained fast path for common intents yet | routing model trained on `intent_server_mappings` + `invoke_outcomes` | Sprint 8+ |

The important point is that these are not random feature ideas. They are the next steps on the same problem-solving path.

---

## Roadmap Summary

The canonical sprint-by-sprint plan now lives in [`docs/DELIVERY_ROADMAP.md`](docs/DELIVERY_ROADMAP.md).

The roadmap sequence is:

1. harden ingest and source truth
2. tighten runtime safety and streaming behavior
3. ship the CLI bridge for `stdio` reachability
4. add stronger behavioral intelligence and publisher tooling
5. move common intents onto a learned-routing fast path

That ordering matters. Relay is not a collection of independent features. It is one delivery path from runtime discovery to governed execution to learned routing.

---

## Full Picture

Relay is one system with four tightly coupled layers:

1. Multi-source ingest builds a canonical registry from the fragmented MCP ecosystem.
2. Runtime search keeps the agent-facing interface small while still exposing that larger capability universe by intent.
3. Guarded invocation centralizes trust, security, auth, vault injection, and policy enforcement.
4. Analytics and training data turn real outcomes into better future routing.

That is the whole story. Security, vault, confidence scoring, training, stdio bridging, and future learned routing all matter because they make the same core promise real: agents should be able to discover and use capability at runtime without humans repeatedly rebuilding the integration surface by hand.

---

*Relay — Apache 2.0 licensed — built by Akinbobola Emmanuel*
*https://github.com/akins-dev/Relay*
