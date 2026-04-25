# Relay And The Practical MCP Cap

Subtitle: Why agent-centric runtime discovery is the right abstraction for a large MCP ecosystem

Status: Draft article / technical essay
Last updated: 2026-04-25

## Abstract

Model Context Protocol standardized the client-server connection layer for tools, resources, and prompts. It did not solve open-world capability access across a growing MCP ecosystem.

The bottleneck is explicit pre-configuration. A human still has to discover servers, decide which ones belong in the environment, manage credentials, handle transport differences, evaluate trust, and expose a bounded tool surface to the model. That works for small setups. It becomes brittle as the ecosystem grows.

Relay is built around a simple claim: the next major MCP problem is not basic protocol compatibility, but making a large capability universe discoverable, governable, and usable at runtime without turning every new server into another manual integration project. The response is an agent-centric runtime layer that lets the agent discover capability by intent, invoke through one guarded path, and improve future routing from real outcomes.

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

Relay is also adjacent to several strands of tool and agent research, but the most relevant frame in 2026 is not generic "tool use." It is open-world capability access.

### Early Tool-Use Precursors

The classic 2023 papers still matter, but mainly as precursors:

- Toolformer established that models can learn when to call external tools instead of treating tool use as a purely hand-written wrapper.
- Chameleon showed that heterogeneous tools can be composed inside a reasoning pipeline.
- ToolLLM and ToolBench pushed the field toward large real API collections rather than toy calculators and search demos.
- APIBank helped establish runnable tool-use evaluation instead of anecdotal agent demos.

These papers are historically important. They are not the best direct framing for Relay's thesis.

### Open-World Tool Retrieval And Function Calling

More recent work is closer to Relay's actual problem.

- Tool retrieval benchmarks such as ToolRet show that once the candidate tool universe becomes large, retrieval quality itself becomes the bottleneck. End-to-end tool use degrades when the system cannot first identify the right capability from a broad catalog.
- Open-world function-calling work such as Meta-Tool and Meta-Bench makes the same point from a different angle: success depends on discovering, selecting, and grounding the right capability under realistic tool-set scale, not merely formatting a valid function call.
- ToolHop extends this into multi-hop settings and shows that multi-step tool use remains far from solved even for strong frontier models.

This is the research lane Relay fits most naturally: not "can a model emit a tool call at all?" but "how does an agent runtime make a large external capability universe operationally usable?"

### Stateful And Agentic Evaluation

The newer evaluation trend also supports Relay's framing.

- ToolSandbox moves beyond stateless API invocation and measures tool use under stateful conversational interaction.
- Tau-bench and Tau-Knowledge show that realistic agent tasks remain difficult when tools must be discovered, documentation must be read, and actions must be taken under interactive constraints.
- BFCL has expanded from narrow function-calling format checks into broader agentic evaluation including web search, memory, and format sensitivity.

These benchmarks matter because Relay is not optimizing for a toy "single JSON function call" setting. It is trying to make live capability access work under retrieval, state, auth, and execution constraints.

### MCP-Specific Security And Governance

Relay is also adjacent to the emerging MCP-specific security literature.

Recent MCP work emphasizes that standardizing protocol shape does not remove trust-boundary problems. Malicious servers, schema drift, prompt injection, weak auditability, and ambiguous permission boundaries all remain open issues in real deployments.

That strengthens one of Relay's core claims: guarded execution, policy enforcement, trust scoring, and credential isolation are not optional operational details around MCP. They are part of what makes large-scale runtime capability access viable.

### The Right Layer To Compare Relay Against

Relay sits below orchestration frameworks and beside model-training recipes.

It is not mainly:

- a benchmark
- a model fine-tuning method
- a workflow graph framework
- a static registry page

It is a capability access plane for MCP systems:

- discover capability by intent
- rank and trim what the model sees
- invoke through one governed path
- record real outcomes
- improve future routing

That is why Relay should be framed less as "another tool-using agent system" and more as runtime infrastructure for open-world MCP capability access.

## 11. Conclusion

MCP standardized the connection layer. It did not remove the operational ceiling created by explicit configuration, open-world discovery, trust boundaries, and governed execution.

Relay's answer is to move capability resolution into the runtime loop: discover by intent, invoke through one guarded path, record outcomes, and improve over time. The current two-tool model is the bootstrap form of that architecture. The later roadmap turns that same loop into speculative execution, adaptive tool surfacing, and learned routing.

The story only works when it stays simple. The problem is the practical MCP cap. The solution is runtime discovery plus guarded execution plus learning from real outcomes. Everything else in Relay exists to make that core loop reliable enough to trust.

## References

- Toolformer: https://arxiv.org/abs/2302.04761
- Chameleon: https://arxiv.org/abs/2304.09842
- ToolLLM: https://arxiv.org/abs/2307.16789
- APIBank benchmark reference: https://aclanthology.org/2023.emnlp-main.187/
- ToolRet: https://aclanthology.org/2025.findings-acl.1258/
- ToolHop: https://aclanthology.org/2025.acl-long.150/
- Meta-Tool / Meta-Bench: https://aclanthology.org/2025.acl-long.1481/
- ToolSandbox: https://machinelearning.apple.com/research/toolsandbox-stateful-conversational-llm-benchmark
- Tau-bench: https://github.com/sierra-research/tau2-bench
- Tau-Knowledge: https://taubench.com/blog/tau-knowledge.html
- BFCL leaderboard: https://gorilla.cs.berkeley.edu/leaderboard
- BFCL V4 web search note: https://gorilla.cs.berkeley.edu/blogs/15_bfcl_v4_web_search.html
- MCP specification: https://modelcontextprotocol.io/specification/
- MCP 2026 roadmap: https://blog.modelcontextprotocol.io/posts/2026-mcp-roadmap/
- MCP landscape and security threats: https://arxiv.org/abs/2503.23278
- Beyond the Protocol: https://arxiv.org/abs/2506.02040
