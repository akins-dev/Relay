# Relay And The Practical MCP Cap

Subtitle: Why agent-centric runtime discovery is the right abstraction for a large MCP ecosystem

Status: Draft article / technical essay
Last updated: 2026-04-24

## Abstract

Model Context Protocol solved interoperability. It did not solve the practical configuration ceiling teams hit when they try to use a growing number of MCP servers in real agent systems.

The bottleneck is explicit pre-configuration. A human still has to discover servers, decide which ones belong in the environment, manage credentials, handle transport differences, and expose a bounded tool surface to the model. That works for small setups. It becomes brittle as the ecosystem grows.

Relay is built around a simple claim: the next major MCP problem is not protocol compatibility, but making a large capability universe usable without turning every new server into another manual integration project. The response is an agent-centric runtime layer that lets the agent discover capability by intent, invoke through one guarded path, and improve future routing from real outcomes.

## 1. The Practical MCP Cap

The limiting factor in MCP is not raw server count. It is the amount of MCP capacity a team can use sanely under explicit configuration.

In practice, the ceiling appears early:

- a human still decides which servers get connected
- a human still manages auth, OAuth, and transport setup
- a human still chooses what the model should see ahead of time
- the model still has to reason over a growing and noisier tool surface
- each new capability still behaves like another 1:1 integration project

This is the practical MCP cap.

It is not a flaw in the protocol. It is an architecture problem created by preload-oriented usage.

## 2. Why Preload-Oriented MCP Stops Scaling

Normal MCP usage is usually:

1. choose a set of servers
2. connect them explicitly
3. expose their tool surface
4. let the model choose from that bounded set

That works well when the environment is small and stable. It weakens as the desirable server set grows.

The main failure modes are straightforward:

- accessible capability stays human-curated
- context pressure rises with every added server
- auth and transport complexity rise with every added server
- the model can only choose from what has already been connected
- the surrounding system still does not know what actually worked for which intent

## 3. Relay's Thesis

Relay shifts capability resolution into the runtime loop.

The current interface is deliberately minimal:

- `search_tools(intent)`
- `invoke_tool(server, tool, args)`

That interface is not the whole thesis. It is the current implementation of a broader product idea:

- capability discovery should happen at runtime
- the model-facing surface should stay small
- auth, policy, trust, and execution controls should stay behind one path
- the system should record outcomes so routing gets better over time

In other words, Relay treats MCP as an agent-runtime problem, not just a registry or connection problem.

## 4. What Relay Already Does Today

Relay already has the main MVP loop in place.

### Runtime loop

- agents connect once through the native MCP server
- `search_tools` resolves capability by intent over a large normalized registry
- `invoke_tool` executes through one guarded runtime path
- every search and invoke is recorded
- aggregated mappings improve future ranking

### Registry layer

- ingest from multiple upstream sources into canonical `servers` rows
- normalize metadata, schemas, provenance, trust, scan history, and drift state
- preserve `stdio` rows even when they are not yet cloud-invocable

### Security and credential layer

- security stack around search, invoke, auth, and policy
- vault-backed secret storage and injection
- structured auth/setup responses when credentials are missing
- drift detection and re-scan behavior for changed servers

### Analytics layer

- `search_events`
- `invoke_outcomes`
- `intent_server_mappings`

These tables matter because they create the bridge from runtime discovery to learned routing.

## 5. Why The Two-Tool Model Is Good For The MVP

The current design is strong for the MVP for four reasons:

- it keeps the model-facing surface small
- it creates one clean search -> invoke -> learn loop
- it centralizes auth, trust, policy, and vault injection
- it avoids needing a trained routing model before the system has usage data

This is not presented as the final perfect form. It is the most credible bootstrap path toward that form.

## 6. What Is Not Yet Fully Optimal

The current system is effective, but not yet the theoretical best possible version.

The main limitations are:

- search still returns ranked result sets that the model must interpret
- confidence is still heuristic + empirical aggregate, not learned routing
- schema trimming is still lexical, not intent-model-aware
- there is no speculative execution yet
- there is no adaptive or ephemeral tool surfacing yet
- there is no trained fast path for common intents yet

Those are real gaps. They are also already mapped to the roadmap.

## 7. How The Current Gaps Map To The Roadmap

### Sprint 4

- speculative invocation for obvious high-confidence single matches
- session pooling and lower-latency invoke path
- streaming support and `progress` handling
- prompt caching for warm knowledge on the most-used servers

This is the first step toward collapsing the distance between search and invoke.

### Sprint 5

- CLI as a native MCP server for local stdio execution
- local DLP and policy enforcement
- async audit sync back into the registry

This is the step that makes the large `stdio` portion of the ecosystem operationally usable, not just discoverable.

### Sprint 6

- a learned Lever 3B classifier replacing the current heuristic gate
- stronger behavioral trust signals from invoke outcomes
- smarter reranking only where the lexical layer proves insufficient

This improves the decision quality of the current MVP without changing the core interface.

### Sprint 8+

- learned routing on `search_events`, `invoke_outcomes`, and `intent_server_mappings`
- direct `(server, tool, confidence)` resolution for common intents
- adaptive or ephemeral tool surfacing once confidence is strong enough

This is the first real trained fast path. `search_tools` remains necessary for novel or ambiguous cases, but it stops being the common path for well-learned intents.

## 8. Why Ingest Matters More Than It Looks

If Relay resolves capability at runtime, registry quality is not cosmetic. It directly affects whether the system can make a correct decision.

Bad ingest quality leads to:

- wrong servers being suggested
- duplicate servers crowding results
- missing or low-quality schemas
- bad transport assumptions
- weak auth/setup guidance
- broken trust calculations

That is why the ingest pipeline, provenance rules, drift handling, and schema quality all matter to the product story. They are not side systems. They determine whether runtime discovery is trustworthy enough to use.

## 9. Why The Learning Loop Matters

The long-term value of Relay is not only that it exposes the ecosystem at runtime. It is that it learns from usage.

The loop is:

1. the agent searches by intent
2. Relay returns likely server/tool options
3. the agent invokes one
4. Relay records the result
5. future routing improves

This produces something static registries do not have: an empirical record of which server/tool paths actually work for real intents under live usage.

That is what later enables:

- stronger reranking
- confidence calibration from outcomes
- adaptive tool surfacing
- learned routing for common intents

## 10. Relation To Research

Relay is also adjacent to the current agent stack that people actually deploy in 2026.

### RAG

RAG improves retrieval over documents, databases, and other knowledge sources. It does not solve open-ecosystem tool discovery, MCP transport fragmentation, or guarded runtime invocation across many possible servers.

### LangChain / LangGraph

LangChain and LangGraph improve orchestration, state management, and multi-step workflows. They can consume MCP tools and expose agents as MCP surfaces, but they still depend on the underlying MCP capability layer being discoverable, governable, and efficient to present to the model.

In that sense, Relay sits underneath them as runtime infrastructure: RAG helps the agent know, orchestration helps the agent plan, and Relay helps the agent safely discover and do.

Relay is also adjacent to several strands of tool-use research.

### Toolformer

Toolformer supports the general idea that tool use can become part of model behavior rather than a purely external scripting layer.

### Chameleon

Chameleon is relevant because it treats tool use as compositional reasoning over heterogeneous capabilities.

### ToolLLM / ToolBench

These are especially relevant because they show that retrieval and ranking across large API collections matter, and that tool-use performance can improve with better training and selection.

### APIBank

APIBank and similar benchmarks are useful because they force precision around what tool-augmented systems can actually do.

Relay sits one layer lower than these papers. It is not mainly a benchmark or a model-training recipe. It is runtime infrastructure for making large-scale MCP capability resolution workable in live agent systems.

## 11. Conclusion

MCP removed protocol fragmentation. It did not remove the operational ceiling created by explicit configuration.

Relay's answer is to move capability resolution into the runtime loop: discover by intent, invoke through one guarded path, record outcomes, and improve over time. The current two-tool model is the bootstrap form of that architecture. The later roadmap turns that same loop into speculative execution, adaptive tool surfacing, and learned routing.

The story only works when it stays simple. The problem is the practical MCP cap. The solution is runtime discovery plus guarded execution plus learning from real outcomes. Everything else in Relay exists to make that core loop reliable enough to trust.

## References

- Toolformer: https://arxiv.org/abs/2302.04761
- Chameleon: https://arxiv.org/abs/2304.09842
- ToolLLM: https://arxiv.org/abs/2307.16789
- APIBank benchmark reference: https://aclanthology.org/2023.emnlp-main.187/
