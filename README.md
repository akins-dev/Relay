# ⬡ Relay

**A lightweight runtime discovery layer for MCP servers.**

Canonical technical reference: [`docs/README.md`](docs/README.md)
Architecture flows: [`docs/ARCHITECTURE_FLOWS.md`](docs/ARCHITECTURE_FLOWS.md)

> "Agent development will never scale if we treat every new tool as a hard-coded 1:1 integration."

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Next.js](https://img.shields.io/badge/Next.js-14.2.25-black)](https://nextjs.org)
[![Supabase](https://img.shields.io/badge/Supabase-Postgres-3ECF8E)](https://supabase.com)

---

## The Problem: The Practical MCP Cap

Every AI agent framework today requires **explicit pre-configuration** of MCP servers.
Before an agent can use a tool, a developer has to find it, evaluate it, integrate it, 
and wire it into the agent's configuration. This 1:1 integration model doesn't scale. 
As the MCP ecosystem grows to thousands of servers, the configuration problem 
becomes the bottleneck — not the capabilities themselves.

The core scaling problem in MCP is not raw server count. It is the amount of capability a team can use sanely under **explicit configuration**:

- developers still have to discover, evaluate, configure, and maintain each MCP server
- agents still inherit bloated tool surfaces and context windows full of schemas
- larger tool surfaces increase token cost, routing ambiguity, and failure risk
- credentials, transport differences, and runtime security add even more operational complexity

Even with strong progress in **RAG** and orchestration frameworks like **LangChain** and **LangGraph**, the infrastructure problem remains: agents still need a clean, secure, and scalable way to discover, rank, authorize, and invoke tools at runtime across a fragmented ecosystem without pre-loading everything.

## The Solution: Relay

**Relay removes the practical MCP configuration ceiling.**

Relay is a secure capability access layer that lets agents:

- discover relevant MCP tools by natural-language intent at runtime
- get a local run manifest for the right server/tool
- keep the model-facing surface small with `search_tools` and `get_server_manifest`
- avoid context bloat from preloading every possible MCP server
- run tools locally through your agent host or Relay CLI instead of routing execution through Relay

Instead of forcing humans to preload and maintain dozens of servers, Relay opens the tool landscape at runtime and lets the local agent do the work.
---

## Connect your agent

### Option 1 — Native MCP server (Claude Desktop, Cursor, Antigravity, Claude Code)

```json
{
  "mcpServers": {
    "relay": {
      "url": "https://relay.vercel.app/api/mcp-server"
    }
  }
}
```

Your agent gets two tools: `search_tools(intent)` and `get_server_manifest(server)`.

### Option 2 — System prompt / agents.md

```
You have access to Relay.
If your framework supports MCP, connect to https://relay.vercel.app/api/mcp-server and use search_tools plus get_server_manifest.
Otherwise read https://relay.vercel.app/agents.md once before your first tool call and use the REST fallback below.
Before taking any action that affects an external system, search first.
For knowledge-only questions, answer directly without searching.
Never put credentials, API keys, or tokens in tool arguments.
Search:  GET https://relay.vercel.app/api/servers/search?q={intent}
Run:     relay invoke {serverName} {toolName}
Use the returned inputSchema exactly. Do not guess arguments.
```

### Option 3 — REST API

```bash
# Discover by intent — returns full inputSchema per tool
curl "https://relay.vercel.app/api/servers/search?q=send+transactional+email"

# Run locally with the returned manifest
relay invoke sendgrid-mail send_email
```

---

## Credentials

Relay returns the environment variables a server expects. For the MVP, credentials stay with your local agent host or CLI environment; Relay does not need to hold or inject secrets.

---

## Core Documentation

- [docs/DELIVERY_ROADMAP.md](docs/DELIVERY_ROADMAP.md): canonical sprint-by-sprint delivery plan
- [docs/TECHNICAL_BACKBONE.md](docs/TECHNICAL_BACKBONE.md): canonical technical reference for ingest, runtime, data model, vault, analytics, and roadmap alignment
- [docs/ARCHITECTURE_SYSTEM_MAP.md](docs/ARCHITECTURE_SYSTEM_MAP.md): deep code-grounded end-to-end architecture map
- [docs/ARCHITECTURE_FLOWS.md](docs/ARCHITECTURE_FLOWS.md): high-level Relay flows for presentations, diagrams, and Excalidraw-style visuals
- [docs/diagrams/relay-system-overview.excalidraw](docs/diagrams/relay-system-overview.excalidraw): single-canvas Excalidraw overview for Obsidian or Excalidraw imports
- [docs/RATE_LIMITS.md](docs/RATE_LIMITS.md): exact default limits, keying model, and config behavior
- [docs/SECURITY.md](docs/SECURITY.md): security stack and trust model
- [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md): local setup, migrations, and contributor workflow
- [docs/TESTING_GUIDE.md](docs/TESTING_GUIDE.md): MVP testing and validation paths
- [docs/PROTOTYPE_GUIDE.md](docs/PROTOTYPE_GUIDE.md): deterministic local prototype path
- [docs/articles/RELAY_AGENT_CENTRIC_RUNTIME_DISCOVERY.md](docs/articles/RELAY_AGENT_CENTRIC_RUNTIME_DISCOVERY.md): article-style technical essay

---

## API Reference

```
GET  /agents.md                               Agent skill file — fetch once, understand everything
GET  /api/mcp                                 Registry info, security layer list, agent prompt template
GET  /api/servers/search?q={intent}&limit=5   Semantic search — full inputSchema per tool returned
GET  /api/servers?sort=trust&verified=true&page=2&page_size=24
                                              Browse with filters + pagination
GET  /api/servers/:name                       Server detail, scan history, CVE issues
POST /api/mcp-server                          Native MCP server (StreamableHTTP)
GET  /api/mcp-server                          Native MCP server (SSE — for older clients)
POST /api/ingest                              Trigger ingest (CRON_SECRET required)
POST /api/admin/ingest                        Trigger ingest from the signed-in admin session
```

---

## License

MIT License — Built by [Akinbobola Emmanuel](https://github.com/akins-dev)
