# Relay — Overview & Roadmap

> *The agent-centric layer that removes the practical MCP configuration ceiling.*
> *Built in public. MIT licensed. For the agent development community.*
> Canonical technical reference: [`docs/TECHNICAL_BACKBONE.md`](docs/TECHNICAL_BACKBONE.md)

---

## What We're Building

Relay solves the problem every agent developer hits when they scale past a handful of MCP servers.

**The problem:** MCP has a practical ceiling. Long before the ecosystem runs out of servers, developers and agents hit a sanity cap: too many servers to explicitly configure, too many tools to expose cleanly, too much auth and transport complexity to manage by hand, and too much model confusion when the available surface gets large. The result is a brittle 1:1 integration model where each new capability still behaves like another manual integration project.

**The solution:** shift MCP from explicit pre-configuration to runtime agent-driven discovery and execution.

```
search_tools("send a transactional email with HTML body")
→ returns verified servers with schemas

invoke_tool({ server: "sendgrid-mail", tool: "send_email", args: {...} })
→ executes through a 14-layer security proxy
```

An agent connecting to Relay gets a minimal runtime interface and uses Relay to do the heavy lifting at runtime. The current implementation keeps the model-facing surface flat at two tool definitions, but the core idea is larger than that interface choice: remove the practical cap by letting the agent discover and use capabilities by intent instead of forcing the human to wire everything in ahead of time.

---

## Why This Is the Right Architecture

### The mathematical case

Every approach that keeps capability selection primarily outside the runtime loop — static configuration, bounded tool preload, or retrieval over a pre-selected tool universe — eventually runs into the same scaling pressure:

**Recall ≤ k/N**

Where k is the pre-selected tool count and N is the total ecosystem size. As N grows, recall approaches zero. You can tune k upward, but that consumes context proportionally and degrades reasoning quality.

Relay attacks that ceiling by moving capability resolution into the runtime path:

η = N / (c + r)

Where N = ecosystem size, c ≈ 100 (two tool definitions), r ≈ 500 (search results). The important point is not the exact constant. The important point is that the model-facing interface stays small while the accessible capability universe can keep growing.

### The trajectory case

The MCP ecosystem is growing fast. Every new server makes explicit configuration harder. Relay is designed so that ecosystem growth increases available capability without forcing the developer to keep manually expanding the model-facing tool surface.

That is the structural bet behind Relay.

---

## What's Built Today

### Core capabilities (Sprint 2 — complete)

**Agent interface:**
- Native MCP server at `/api/mcp-server` — agents connect once, get everything
- `search_tools`: FTS + trigram intent retrieval across 20,000+ servers with confidence scoring
- `invoke_tool`: direct execution through the security proxy (no internal HTTP hop)
- Lever 3A knowledge classifier: deflects non-action queries before DB touch
- Intent cache: O(1) lookup for frequent intent→server mappings
- Schema trimming: max 3 most-relevant tools per result
- Historical confidence: prior success rates boost search ranking
- SSE transport for legacy clients (2024-11-05 spec)

**Discovery:**
- `/.well-known/mcp.json`: machine-readable registry manifest
- `/agents.md`: LLM skill file with activation rules and full API docs
- Ingest from 7 sources: Official Registry, Smithery, Glama, GitHub, Vendor, ClaudeMCP, MCP.so

**Security:**
- 14-layer security stack (L1–L14, S-12, S-13, S-14)
- SSRF protection: full IPv4 + IPv6 coverage including edge cases
- Schema drift detection: auto-suspends servers that mutate tools post-approval
- Injection re-scan on every drift event (ATK-1 fix)
- HMAC-signed confirmation tokens (timing-safe, 5-minute expiry)
- Nested JSON injection bypass via recursive string flattening

**Credentials:**
- Supabase pgsodium vault (AES-256-GCM)
- Auto-injection via all credential name variants
- OAuth connection flow (Sprint 3)
- Credential name suggestions in structured 401 responses

**Policies:**
- Per-user, per-server, per-tool access rules
- Glob pattern matching (delete_*, drop_*, etc.)
- Default destructive-action blocks on signup
- Confirmation flow with HMAC tokens

**Analytics (Migration 022):**
- `search_events`: every search_tools call, full context
- `invoke_outcomes`: every invoke result, linked to search
- `intent_server_mappings`: aggregated feedback loop (the ML training corpus)
- Confidence scoring, schema trimming, intent caching
- Analytics views: top_intents, ecosystem_gaps, search_quality_daily, server_reliability

**Infrastructure:**
- EWMA trust scoring (uptime + stability + community + scan + runtime)
- Three-tier skip algorithm in ingest (O(1) timestamp → hash → full pipeline)
- Rate limiting: Upstash Redis sliding window, in-memory fallback
- Response size guard: 10MB hard limit
- Batch pre-fetch in ingest (eliminates N+1 DB lookups)
- Race condition recovery on concurrent ingest runs

---

## Roadmap

### Sprint 3 — Sampling Security + OAuth (2 weeks)

- [ ] `sampling/createMessage` rate limit: 5/min per server
- [ ] Sampling audit log: every server-initiated LLM call recorded
- [ ] OAuth token refresh: detect 401 → refresh → retry once
- [ ] Bearer-only auth hardening (OAuth deferred to Sprint 4)
- [ ] Supabase TypeScript type regeneration (20+ migrations applied)

### Sprint 4 — Performance + Streaming (3 weeks)

- [ ] Upstash Redis session pool: cache MCP handshake for 5 min per server
- [ ] Stateless probe mode: skip initialize for 2025-03-26 compliant servers
- [ ] SSE streaming pass-through: pipe upstream SSE directly to client
- [ ] `progress` notification handling
- [ ] Speculative invocation: on high-confidence (trust > 90) single match, pre-execute and return result with search results in one call
- [ ] Prompt caching: compressed registry snapshot of top-200 servers for warm knowledge (Gap 1)

### Sprint 5 — CLI as Native MCP Server (4 weeks)

- [ ] `@Relay/cli` npm package
- [ ] `Relay search/info/login` commands
- [ ] `Relay serve` — starts as native MCP server over stdio
- [ ] Subprocess lifecycle manager (npx-style on-demand spawning)
- [ ] Local DLP + policy enforcement (offline security)
- [ ] Async audit sync to registry
- [ ] Closes the stdio gap: 100% of ecosystem becomes invocable

### Sprint 6 — Intelligence + Publisher Program (5 weeks)

- [ ] **Lever 3B:** Train logistic regression classifier on accumulated search_events + invoke_outcomes data. Replaces heuristic Lever 3A with a learned model. Zero ongoing cost.
- [ ] **Hybrid retrieval reranker:** keep FTS + trigram as the baseline recall layer, and add embedding recall only if analytics shows repeated lexical misses. Behavioral signals remain the ranking authority.
- [ ] **Behavioral trust signals:** DLP trigger rate and failure rate from metering feed trust score in real time
- [ ] **GitHub OIDC verified publisher:** Publishers sign with GitHub Actions tokens. Registry verifies cryptographically. No human review bottleneck.
- [ ] `@Relay/sdk` TypeScript SDK
- [ ] `Relay` Python SDK (PyPI)
- [ ] `Relay publish` + `Relay validate` CLI commands
- [ ] Tool schema registry: versioned JSON Schema store

### Sprint 7 — Cloud stdio Bridge (7 weeks)

- [ ] Container-based stdio invocation (Fly.io Machines)
- [ ] Cold start < 3s, warm < 100ms
- [ ] Per-request ephemeral containers (process isolation, network isolation)
- [ ] Scale-to-zero billing
- [ ] Closes the stdio gap for agents without CLI

### Sprint 8+ — Gap 3: Learned Intent Routing

This is where the data asset becomes a product.

After sufficient usage data accumulates in `intent_server_mappings` and `invoke_outcomes`, train a routing model on the corpus and, if justified by quality and cost, distill or fine-tune a small model (7B class) on the highest-value intent paths:
- Input: intent string
- Output: (server_name, tool_name, confidence) without any search call

For the most common intents (~80% of traffic based on the power law distribution that will emerge), the model answers directly from learned routing. `search_tools` becomes a fallback for novel intents and low-confidence cases.

This is the practically optimal solution. The two visible tools become nearly zero-latency for trained intents. The registry is still needed for discovery, security, and tail intents — but the common path becomes sub-millisecond.

**This is the business.** The learned routing layer + its training corpus + ongoing improvement pipeline is the competitive moat that no competitor can replicate without the same data.

---

## The Business Case

### Why the data is the moat

The `intent_server_mappings` table answers a question no one else can:

*"Given this specific intent, which MCP server actually worked, how reliably, and how fast?"*

Not what servers exist — Glama and Smithery already cover a lot of that. Not merely what tools they expose. But which server/tool combinations actually work for specific real-world intents, measured across real agent invocations, inside an agent-centric runtime layer that is explicitly designed to remove the practical MCP configuration ceiling.

That signal has three commercial applications:

**Application 1 — Intelligence product**
Companies building agent pipelines want to know: "Which tools should my agent use?" Today they figure this out by trial and error. Relay's data makes it deterministic. A query like "what's the most reliable way to send transactional email" becomes answerable with empirical evidence: success_rate, latency, dlp_trigger_rate, across 10,000+ invocations.

**Application 2 — Gap analysis product**
The `ecosystem_gaps` view shows intents that agents search for but can't find. This is a roadmap for the MCP ecosystem. Companies building tools want to know where demand exists before there's supply. That data is uniquely Relay's.

**Application 3 — Gap 3 learned routing model**
The training corpus (intent → server → tool → outcome) enables a learned routing layer that eliminates search latency for common intents. Whether that is delivered as a classifier, distillation pipeline, or fine-tuned model depends on the observed quality/cost tradeoff. The product value is the routing accuracy, not the specific model class.

### Community first, business second

Everything above is built on a foundation of genuine community value. The registry is MIT licensed. The API is free for community use. The security scanning is a public good — no other registry does 14-layer scanning.

The commercial layer (intelligence products, fine-tuned model) is built on top of that foundation after the community establishes the data asset. You don't build the business first and hope the community follows. You build something genuinely useful, accumulate the data that emerges from real use, and then build the business around what the data reveals.

Clarke's Third Law applies in reverse too: sufficiently well-understood data becomes technology. The intent→outcome mappings you're collecting today are magic to everyone who doesn't have them.

---

## Closest Achievable Solution to Perfect

The theoretically perfect MCP tool system has no discovery step, no invocation boundary, and no authentication concept — tool capability is intrinsic to model weights, intent maps directly to execution, and security is structural rather than computational.

Relay is currently at ~70% of that limit. The path to ~85%:

**Gap 1 (Sprint 4, 2 days):** Prompt caching of top-200 server summaries. For 80% of queries, the model "already knows" without a search call. Context-embedded warm knowledge at zero recurring cost.

**Gap 2 (Sprint 4, 3 days):** Speculative invocation. High-confidence single matches pre-execute, collapsing search+invoke to one call. The theoretical minimum for a non-weight-embedded system.

**Gap 3 (Sprint 8+):** Learned routing on accumulated corpus. Common intents answered directly for trained paths. The point where the search-then-invoke pattern becomes invisible for known intents. The architecture is still there — it just operates at near-zero cost for known intents.

Each gap closes as the system matures. The architecture is already on the right trajectory. The data being collected now is what makes Gap 3 possible. The current lexical retrieval layer is the bootstrap, not the endpoint.

---

*Relay — MIT licensed — built by TheSeventeen*
*https://github.com/the-17/Relay*
