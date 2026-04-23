# Relay And The Practical MCP Cap

Subtitle: Why agent-centric runtime discovery matters, what existing MCP platforms already solve well, and where Relay is trying to be different

Status: Draft article / technical essay
Last updated: 2026-04-23

## Abstract

Model Context Protocol has made tool interoperability dramatically better, but it has not removed the practical ceiling that teams hit when they try to scale tool access in real agent systems. The bottleneck is no longer just protocol compatibility. It is the cost of explicit configuration: discovering servers, connecting them, managing credentials, choosing which tools the model should see, and maintaining all of that as the ecosystem grows.

Relay is based on a simple claim: the next limiting factor in agent capability is not the number of MCP servers that exist, but the number that can be used sanely under explicit pre-configuration. The project therefore treats MCP as an agent-runtime problem first. The goal is to let the agent discover capability by intent at runtime, rather than forcing the human to explicitly wire the capability universe in advance.

This article argues that the practical MCP cap is real, that current registries and gateways solve only parts of the problem, and that an agent-centric runtime discovery layer is a coherent response. It also explains why Relay currently uses a minimal two-tool interface, why security and credential injection are support systems rather than the main thesis, and why the ingest and analytics layers matter for making the architecture real.

## 1. The Problem Is Not Just Tool Count

There is a common way to talk about tool use in LLM systems: context gets crowded when too many tool definitions are exposed to the model. That observation is true, but it is incomplete.

The deeper issue is operational. In real systems, teams hit a practical ceiling long before they run out of available tools or servers. Once the number of MCP servers grows past a modest range, several things start to break at once:

- a human still has to decide which servers are worth connecting
- a human still has to configure credentials, OAuth, and transport details
- a human still has to decide what the model should see ahead of time
- the model is asked to reason over an increasingly noisy and unstable tool surface
- every new capability still behaves like another 1:1 integration project

This is the practical MCP cap.

It is not a spec limit. It is a usability and architecture limit.

In plain terms: the ecosystem may contain thousands of MCP servers, but usable capacity is capped by what a team can explicitly configure and what an agent can sanely operate with.

## 2. Why The Current Approach Stops Scaling

The default pattern in many agent systems is still preload-oriented:

1. pick a set of tools or servers
2. configure them explicitly
3. expose them to the model
4. hope the chosen set is enough

This works for bounded systems. It fails structurally as the accessible capability universe grows.

Even retrieval-based approaches often inherit the same limitation. They may retrieve a smaller subset at runtime, but they usually start from a bounded or pre-selected tool universe. That still leaves the surrounding infrastructure problem unsolved:

- who discovered the tool universe
- who evaluated trust
- who manages credentials
- who handles transport
- who records what actually worked

The result is that the ecosystem can grow faster than any single application's ability to use it cleanly.

## 3. Relay's Thesis

Relay starts from a different premise:

agents should do more of the heavy lifting at runtime.

That means:

- the agent expresses intent
- Relay resolves likely server/tool options
- invocation flows through one controlled execution path
- auth, policy, trust, and safety stay below that path
- outcomes are recorded so routing gets better over time

This is why Relay is best described as an agent-centric runtime discovery and execution layer.

The project is not mainly trying to be:

- another MCP directory
- another generic gateway
- another security product with MCP attached

Those things matter, but they are secondary to the central idea: remove the practical MCP configuration ceiling by shifting capability resolution into the runtime loop.

## 4. Why Relay Uses Two Meta-Tools

Relay's current implementation exposes two meta-tools:

- `search_tools(intent)`
- `invoke_tool(server, tool, args)`

This is an implementation choice, not the entire product thesis.

The reason for the design is straightforward. If the problem is that explicit configuration and large tool surfaces do not scale, then a small model-facing interface is a strong way to keep the runtime legible while still allowing access to a much larger capability universe.

The two-tool model has several advantages:

- it keeps the model-facing surface stable even as the ecosystem grows
- it gives the system one place to apply trust, auth, and policy controls
- it makes search and invoke outcomes measurable
- it creates a clean path toward learned routing later

The important point is not the number two by itself. The important point is that the interface stays deliberately small while capability resolution happens dynamically.

## 5. What Existing Platforms Already Solve Well

Relay is not entering an empty market. Several platforms already solve important parts of the problem well.

### Glama

Glama currently appears strongest on:

- registry and discovery UX
- tool-level search
- gateway/control-plane capabilities
- managed credentials
- observability, logging, and tool access control

Its UI is fast, detailed, and operationally serious. It has strong server pages, connector pages, hosted gateway ideas, and a browser-based inspector. That makes it one of the strongest MCP ecosystem products today.

But Glama's public framing is broader than Relay's specific thesis. It clearly helps with discovery and gatewaying, but it does not obviously present itself as a system built primarily to remove the practical MCP configuration ceiling through agent-centric runtime routing.

### Smithery

Smithery is strong on:

- registry/distribution
- publishing
- managed auth and connection lifecycle
- simplifying MCP integration through a managed service

Its Connect model is especially important because it removes a great deal of OAuth and session-management pain.

But Smithery's current docs still describe a connection-first workflow: create or retrieve per-user connections, create clients for those connections, and aggregate tools from the connected integrations. That reduces operational pain dramatically, but it still implies an explicit connection model and a growing tool surface built from the user's connected set.

### mcp.run

mcp.run is highly relevant because it attacks a related problem: making tool access portable, secure, and centrally managed. Its servlet/profile model and `mcpx` abstraction are serious infrastructure work.

It is not the same product shape as Relay, but it is an important adjacent response to the same ecosystem pressure.

## 6. What Relay Is Claiming Differently

The honest Relay claim is not:

"nobody else has discovery, auth, or a gateway."

That would be false.

The stronger and more defensible claim is:

Relay is explicitly organized around the agent-runtime problem.

In other words:

- the bottleneck is the practical MCP cap
- the cap is created by explicit pre-configuration
- the response is runtime capability resolution by intent
- a small model-facing interface is a deliberate design consequence of that choice

Security, trust, credential injection, and policy enforcement are critical because runtime discovery without runtime control would be irresponsible. But they are support systems for the main architectural move.

## 7. Relation To Prior Research

Relay is also adjacent to a growing body of tool-use research.

### Toolformer

Toolformer showed that language models can learn to call tools as part of the generation process. This matters because it supports the broader idea that tool use should be integrated into model behavior rather than treated as a purely external scripting problem.

### Chameleon

Chameleon framed tool use as compositional reasoning with plug-and-play modules. This is relevant because it pushes toward planner-mediated use of heterogeneous capabilities, not just static prompting.

### ToolLLM / ToolBench

ToolLLM and ToolBench are especially relevant because they attack large-scale API retrieval and tool-use training. They show that retrieval and ranking over large API collections matter and that tool-use competence can be improved significantly.

But these systems still operate mainly at the model/retrieval layer. They do not solve the MCP-specific infrastructure problem of:

- live ecosystem discovery
- gatewayed invocation
- credential injection
- transport differences
- policy enforcement
- empirical routing from real invoke outcomes

### APIBank

Benchmarks such as APIBank matter because they force precision around what tool-augmented systems are actually good at. They help evaluate whether a model can use tools. They do not provide a runtime platform for a live, evolving MCP ecosystem.

Relay sits one layer lower than these papers. It is not primarily a tool-use benchmark or a model-training recipe. It is infrastructure for making large-scale MCP use tractable in real agent systems.

## 8. Why Ingest Matters More Than It Looks

If Relay is an agent-runtime layer, then registry quality is not cosmetic. It is foundational.

Bad registry state leads to:

- the wrong server being suggested
- duplicate servers crowding results
- incorrect transport assumptions
- failed auth/setup guidance
- missing schemas
- broken trust calculations

That is why ingest is the current MVP priority.

The MVP does not need every future feature. It needs:

- canonical server rows
- a clean search contract
- a clean invoke contract
- a working search -> invoke -> learn loop

Without those, the agent-centric runtime thesis remains only a narrative.

## 9. Why The Feedback Loop Is The Long-Term Moat

The strategic asset in Relay is not just the server index.

Directories can be copied.
Gateway ideas can be copied.
Even good UI can be copied.

What is harder to copy is the empirical record of what actually worked for which intent under real usage.

That is what the `search_events`, `invoke_outcomes`, and `intent_server_mappings` tables are for.

They answer a question that is much more valuable than "what MCP servers exist?":

Given this intent, which server and tool actually worked, how reliably, and how fast?

That is the bridge from runtime discovery to learned routing.

## 10. What A Fair Comparison With Competitors Looks Like

A fair comparison should separate these dimensions:

- discovery
- gateway/control plane
- managed auth/connections
- agent-centric runtime capability resolution

On the first three, Relay is entering a market where serious work already exists.

On the fourth, the field is still comparatively open.

That is why Relay should not market itself as "the only MCP platform with X." It should market itself as a system designed around a specific unsolved pressure point:

the practical MCP configuration ceiling.

## 11. MVP Implications

This framing has a useful side effect: it keeps the MVP honest.

If the main goal is to remove the practical cap, then the MVP does not need to win on everything at once. It needs to prove four things:

1. agents can discover useful capability by intent at runtime
2. the returned registry state is trustworthy enough to use
3. invocation works through one guarded path
4. outcomes can improve future routing

That is enough to validate the product thesis.

## 12. Conclusion

MCP solved protocol fragmentation. It did not solve the usability limit created by explicit configuration.

Relay's wager is that the next step is not simply better directories or better gateways, although both matter. The next step is to make MCP usage agent-centric: let the agent discover and use capabilities at runtime, while the surrounding platform handles trust, auth, policy, and measurement.

The two-tool interface is one implementation of that idea. It may prove to be the right one, or it may evolve. But the underlying problem is real regardless of interface details: explicit pre-configuration does not scale with ecosystem growth.

If Relay succeeds, it will not be because it indexed more servers than everyone else. It will be because it made a much larger capability universe usable without requiring humans to keep wiring it in by hand.

## References

- Glama homepage: https://glama.ai/
- Glama servers: https://glama.ai/mcp/servers
- Glama connectors: https://glama.ai/mcp/connectors
- Glama tools: https://glama.ai/mcp/tools
- Glama inspector: https://glama.ai/mcp/inspector
- Glama clients: https://glama.ai/mcp/clients
- Smithery docs: https://smithery.ai/docs
- Smithery Connect overview: https://smithery.ai/docs/use
- Smithery Connect guide: https://smithery.ai/docs/use/connect
- Smithery Connect API: https://smithery.ai/docs/use/connect-api
- Smithery quickstart connect: https://smithery.ai/docs/getting_started/quickstart_connect
- mcp.run client intro: https://docs.mcp.run/mcp-clients/intro/
- Toolformer: https://arxiv.org/abs/2302.04761
- Chameleon: https://arxiv.org/abs/2304.09842
- ToolLLM: https://arxiv.org/abs/2307.16789
- APIBank benchmark reference: https://aclanthology.org/2023.emnlp-main.187/
