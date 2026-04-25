# ⬡ Relay

**The agent-centric runtime discovery and invocation layer for MCP servers.**

Canonical technical reference: [`docs/README.md`](docs/README.md)
Project narrative and roadmap: [`OVERVIEW_AND_ROADMAP.md`](OVERVIEW_AND_ROADMAP.md)

> "Agent development will never scale if we treat every new tool as a hard-coded 1:1 integration."

[![License: Apache 2.0](https://img.shields.io/badge/License-Apache_2.0-e8673a.svg)](LICENSE)
[![Next.js](https://img.shields.io/badge/Next.js-14.2.25-black)](https://nextjs.org)
[![Supabase](https://img.shields.io/badge/Supabase-Postgres-3ECF8E)](https://supabase.com)

---

## The Problem: The Practical MCP Cap

MCP solved interoperability beautifully. It did not solve the practical ceiling teams hit when they try to use a large and growing number of MCP servers in real agent systems.

The real bottleneck is **explicit pre-configuration**:

- developers still have to discover, evaluate, configure, and maintain each MCP server
- agents still inherit bloated tool surfaces and context windows full of schemas
- larger tool surfaces increase token cost, routing ambiguity, and failure risk
- credentials, transport differences, and runtime security add even more operational complexity

Even with strong progress in **RAG** and orchestration frameworks like **LangChain** and **LangGraph**, the infrastructure problem remains: agents still need a clean, secure, and scalable way to discover and invoke tools at runtime across a fragmented ecosystem without pre-loading everything.

## The Vision: Relay

**Relay removes the practical MCP configuration ceiling.**

Relay is a secure runtime discovery layer that lets agents:

- discover relevant MCP tools by natural-language intent at runtime
- invoke them through one controlled and guarded path
- keep the model-facing surface small with just `search_tools` and `invoke_tool`
- benefit from centralized security, trust scoring, policy enforcement, and credential injection

Instead of forcing humans to preload and maintain dozens of servers, Relay moves capability resolution into the runtime loop and records outcomes so future routing improves from real usage.

That is why Relay complements, rather than competes with, modern RAG and agent orchestration stacks:

- **RAG** answers "what do I know?"
- **LangChain / LangGraph** help coordinate reasoning and multi-step workflows
- **Relay** answers "what can I do safely right now across the MCP ecosystem?"

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

Your agent gets two tools: `search_tools(intent)` and `invoke_tool(server, tool, args)`.

### Option 2 — System prompt / agents.md

```
You have access to Relay.
If your framework supports MCP, connect to https://relay.vercel.app/api/mcp-server and use search_tools plus invoke_tool.
Otherwise read https://relay.vercel.app/agents.md once before your first tool call and use the REST fallback below.
Before taking any action that affects an external system, search first.
For knowledge-only questions, answer directly without searching.
Never put credentials, API keys, or tokens in tool arguments.
Search:  GET https://relay.vercel.app/api/servers/search?q={intent}
Invoke:  POST https://relay.vercel.app/api/proxy/{serverName}/{toolName}
Prefer servers with trust_score > 80 for production use.
Use the returned inputSchema exactly. Do not guess arguments.
```

### Option 3 — REST API

```bash
# Discover by intent — returns full inputSchema per tool
curl "https://relay.vercel.app/api/servers/search?q=send+transactional+email"

# Invoke through the secure proxy
curl -X POST "https://relay.vercel.app/api/proxy/sendgrid-mail/send_email" \
  -H "Content-Type: application/json" \
  -d '{"to": "user@example.com", "subject": "Hello", "body": "..."}'
```

---

## Credentials — Relay Vault

Most MCP servers require API keys. Store them once in the Relay Vault. The proxy decrypts and injects at call time — your agent never sees the raw value. You can view the secret name but not the value after saving.

**One-time setup per service:**

1. Get your API key from the service dashboard
2. Go to `https://relay.vercel.app/dashboard/secrets`
3. Enter the server name, the suggested variable name (shown in any 401 response), and your key
4. Done — every future call through Relay injects it automatically

---

## Core Documentation

- [OVERVIEW_AND_ROADMAP.md](OVERVIEW_AND_ROADMAP.md): problem, current solution, full-system picture, and upcoming sprint work
- [docs/TECHNICAL_BACKBONE.md](docs/TECHNICAL_BACKBONE.md): canonical technical reference for ingest, runtime, data model, vault, analytics, and roadmap alignment
- [SECURITY.md](SECURITY.md): security stack and trust model
- [ARCHITECTURE.md](ARCHITECTURE.md): runtime and infrastructure design
- [DEVELOPMENT.md](DEVELOPMENT.md): local setup, migrations, and contributor workflow

---

## API Reference

```
GET  /agents.md                               Agent skill file — fetch once, understand everything
GET  /api/mcp                                 Registry info, security layer list, agent prompt template
GET  /api/servers/search?q={intent}&limit=5   Semantic search — full inputSchema per tool returned
GET  /api/servers?sort=trust&verified=true&page=2&page_size=24
                                              Browse with filters + pagination
GET  /api/servers/:name                       Server detail, scan history, CVE issues
POST /api/proxy/:serverName/:toolName         Guarded proxy — every call inspected
POST /api/mcp-server                          Native MCP server (StreamableHTTP)
GET  /api/mcp-server                          Native MCP server (SSE — for older clients)
POST /api/ingest                              Trigger ingest (CRON_SECRET required)
POST /api/admin/ingest                        Trigger ingest from the signed-in admin session
```

---

## License

Apache 2.0 License — Built by [Akinbobola Emmanuel](https://github.com/akins-dev)
