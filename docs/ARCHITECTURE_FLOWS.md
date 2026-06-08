# Relay Architecture Flows

Last updated: 2026-05-11 (Agent-centric Relay Local clarification)
Status: Historical high-level architecture. Current MVP scope lives in `DELIVERY_ROADMAP.md` and `RUNTIME_INVOKE_ARCHITECTURE.md`.

Canonical MVP references: [`DELIVERY_ROADMAP.md`](DELIVERY_ROADMAP.md), [`RUNTIME_INVOKE_ARCHITECTURE.md`](RUNTIME_INVOKE_ARCHITECTURE.md)
Canonical technical reference: [`TECHNICAL_BACKBONE.md`](TECHNICAL_BACKBONE.md)
Deep code-grounded system map: [`ARCHITECTURE_SYSTEM_MAP.md`](ARCHITECTURE_SYSTEM_MAP.md)
Companion scene: [`diagrams/relay-system-overview.excalidraw`](diagrams/relay-system-overview.excalidraw)
Canonical sprint plan: [`DELIVERY_ROADMAP.md`](DELIVERY_ROADMAP.md)

This file is intentionally flow-oriented. It is the version of Relay architecture that can be translated directly into Excalidraw, slides, or other visual system diagrams.

## 1. Relay In One Sentence

Relay is an agent-centric capability access layer for MCP: discover capability by intent, return a run manifest, invoke through Relay Local, record outcomes, and improve routing over time.

## 2. The Core Product Flow

```text
User request
  -> Agent decides action is needed
  -> Relay search_tools(intent)
  -> Relay ranks likely server/tool paths
  -> Agent chooses one
  -> Relay Local invoke_tool(server, tool, args) or relay invoke
  -> Relay Local guarded execution runs
  -> Outcome is recorded
  -> Future ranking improves
```

Canvas version:

```text
[User]
   |
   v
[Agent]
   |
   v
[Relay search_tools]
   |
   v
[Ranked capability options]
   |
   v
[Relay Local invoke_tool / relay invoke]
   |
   v
[Relay Local guarded execution]
   |
   +--> [External MCP server / API]
   |
   v
[Outcome + analytics]
   |
   v
[Better future routing]
```

## 3. The System Boundary Flow

```text
                 +----------------------+
                 |    External Sources  |
                 | registry directories |
                 | GitHub repos         |
                 | publisher metadata   |
                 +----------+-----------+
                            |
                            v
+--------------------+   +----------------------+   +----------------------+
| Agent / Client     |-->| Relay runtime layer  |-->| MCP servers / APIs   |
| MCP / REST / prompt|   | search + invoke      |   | HTTP / SSE / stdio   |
+--------------------+   +----------------------+   +----------------------+
                            |
                            v
                   +----------------------+
                   | Relay data plane     |
                   | registry             |
                   | vault                |
                   | policies             |
                   | analytics            |
                   +----------------------+
```

## 4. Ingest And Registry Flow

Purpose: build a canonical capability index from a noisy ecosystem.

```text
Upstream sources
  -> source adapters
  -> normalization and dedup
  -> transport and auth inference
  -> scan and trust enrichment
  -> canonical servers rows
  -> search-ready registry
```

Canvas version:

```text
[Official registry] --\
[Smithery] ----------- \
[Glama] -------------- +-> [Ingest pipeline]
[mcp.directory] ------/         |
                           [Normalize + dedup]
                                   |
                                   v
                           [Scan + trust enrich]
                           (behavioral floor ~8pts)
                                   |
                                   v
                           [Canonical registry]
```


## 5. Runtime Discovery Flow

Purpose: keep the model-facing surface small while resolving from a large capability universe.

```text
Agent intent
  -> knowledge vs action gate
  -> lexical retrieval over registry
  -> historical success boosts
  -> confidence scoring
  -> schema trimming
  -> ranked result set
```

Canvas version:

```text
[Intent]
   |
   v
[Need tool?]
   |
   +--> no  -> [Answer directly]
   |
   v
[Registry retrieval]
   |
   v
[History + confidence]
   |
   v
[Trimmed schemas]
   |
   v
[Ranked options]
```

## 6. Relay Local Invocation Flow

Purpose: centralize execution safety, auth, and policy in Relay Local.

```text
local MCP invoke_tool or relay invoke
  -> fetch manifest
  -> validate tool and arguments
  -> resolve local env/secrets
  -> run local security checks
  -> start stdio process or connect to remote MCP endpoint
  -> return structured result
  -> report outcome metadata
```

Canvas version:

```text
[Relay Local invoke]
   |
   v
[Manifest + tool validation]
   |
   v
[Policy + local checks]
   |
   v
[Env / secrets]
   |
   v
[Security checks]
   |
   v
[Upstream execution]
   |
   v
[Result + audit]
```

## 7. Learning Loop Flow

Purpose: make Relay improve from live usage rather than stay a static registry.

```text
search_tools
  -> search_event recorded
Relay Local invoke_tool / relay invoke
  -> invoke_outcome recorded
aggregations update
  -> intent_server_mappings
future searches use
  -> better ranking and routing
```

Canvas version:

```text
[search_tools] ----> [search_events] --------\
                                             +--> [intent/server learning]
[Relay Local invoke] -> [invoke_outcomes] ----/        |
                  |                                    v
                  +--> [intent_server_mappings] --> [trust score behavioral slot]
                                                   [better future routing]
```


## 8. Stdio Reachability Flow

Purpose: handle the large share of MCP capability that should run in the agent environment.

### Current state

```text
search finds stdio server
  -> Relay returns local_stdio or discovery_only manifest
  -> agent gets Relay Local execution guidance
  -> Cloud MCP does not expose hosted invoke
```

### Planned Relay Local runtime

```text
Agent host
  -> Relay Local as CLI or local MCP server
  -> search_tools goes to Relay Cloud
  -> Relay Local invoke chooses execution path
       -> remote MCP connects from local runtime
       -> stdio spawns local subprocess
  -> local security and policy apply
  -> audit sync returns to registry
```

Canvas version:

```text
[Agent]
   |
   v
[Relay CLI]
   |
   +--> [Relay cloud search/invoke for HTTP]
   |
   +--> [Local stdio subprocess]
             |
             v
        [Local policy + DLP]
             |
             v
        [Async audit sync]
```

## 9. Supported Entry Flows

Relay currently supports three main entry patterns.

```text
1. Native MCP server
   Client -> /api/mcp-server -> search_tools / get_server_manifest

2. Prompt-driven HTTP usage
   Agent reads /agents.md -> /api/servers/search + Relay Local command guidance

3. REST integration
   Framework -> Relay HTTP APIs directly
```

## 10. Flow Layers For A Presentation Slide

If you want one clean Excalidraw slide, use these four boxes:

1. Discovery layer
   Intent search, ranking, schema trimming.
2. Control layer
   Auth, policy, rate limits, vault, security checks.
3. Execution layer
   HTTP, SSE, and later stdio execution paths.
4. Learning layer
   Search events, invoke outcomes, intent-server mappings, learned routing.

That gives a clearer visual than mixing product narrative, infrastructure, and sprint detail in one diagram.
