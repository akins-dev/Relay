# Relay Architecture Flows

Last updated: 2026-05-05 (Migration 032: Behavioral Trust & Dynamic Diversity)
Status: High-level presentation architecture

Canonical technical reference: [`TECHNICAL_BACKBONE.md`](TECHNICAL_BACKBONE.md)
Deep code-grounded system map: [`ARCHITECTURE_SYSTEM_MAP.md`](ARCHITECTURE_SYSTEM_MAP.md)
Companion scene: [`diagrams/relay-system-overview.excalidraw`](diagrams/relay-system-overview.excalidraw)
Canonical sprint plan: [`DELIVERY_ROADMAP.md`](DELIVERY_ROADMAP.md)

This file is intentionally flow-oriented. It is the version of Relay architecture that can be translated directly into Excalidraw, slides, or other visual system diagrams.

## 1. Relay In One Sentence

Relay is a capability access layer for MCP: discover capability by intent, invoke through one governed path, record outcomes, and improve routing over time.

## 2. The Core Product Flow

```text
User request
  -> Agent decides action is needed
  -> Relay search_tools(intent)
  -> Relay ranks likely server/tool paths
  -> Agent chooses one
  -> Relay invoke_tool(server, tool, args)
  -> Guarded execution runs
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
[Relay invoke_tool]
   |
   v
[Guarded execution]
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

## 6. Guarded Invocation Flow

Purpose: centralize execution safety, auth, and policy.

```text
invoke_tool
  -> authenticate caller
  -> resolve policy
  -> rate limit
  -> inject credentials from vault if needed
  -> run security checks
  -> execute upstream call
  -> return structured result
  -> audit and analytics write
```

Canvas version:

```text
[invoke_tool]
   |
   v
[Auth + identity]
   |
   v
[Policy + rate limit]
   |
   v
[Vault injection]
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
invoke_tool
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
[invoke_tool] ------> [invoke_outcomes] ----/          |
                  |                                    v
                  +--> [intent_server_mappings] --> [trust score behavioral slot]
                                                   [better future routing]
```


## 8. Stdio Reachability Flow

Purpose: handle the large share of MCP capability that is not cloud-invocable.

### Current state

```text
search finds stdio server
  -> Relay marks proxy_available=false
  -> agent gets local-execution guidance
  -> cloud proxy blocks mistaken stdio invocation safely
```

### Planned CLI bridge

```text
Agent host
  -> Relay CLI as native MCP server
  -> search_tools goes to Relay cloud
  -> invoke_tool chooses execution path
       -> HTTP/SSE goes through cloud proxy
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
   Client -> /api/mcp-server -> search_tools / invoke_tool

2. Prompt-driven HTTP usage
   LLM reads /agents.md -> /api/servers/search + /api/proxy

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
