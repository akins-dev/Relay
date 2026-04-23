# ⬡ Relay

**The agent-centric runtime discovery and invocation layer for MCP servers.**

Canonical technical reference: [`docs/README.md`](docs/README.md)

> "Agent development will never scale if we treat every new tool as a hard-coded 1:1 integration."

[![License: Apache 2.0](https://img.shields.io/badge/License-Apache_2.0-e8673a.svg)](LICENSE)
[![Next.js](https://img.shields.io/badge/Next.js-14.2.25-black)](https://nextjs.org)
[![Supabase](https://img.shields.io/badge/Supabase-Postgres-3ECF8E)](https://supabase.com)

---

## The Problem: The Practical MCP Cap

In practice, agent builders hit a sanity ceiling long before they run out of available MCP servers. Once you move past a modest number of configured servers, the workflow becomes brittle: someone still has to discover the right server, wire it in, manage auth, maintain it, and decide what the model should see ahead of time.

That is the real MCP scaling problem. The ecosystem may contain thousands of servers, but usable capacity is capped by what a human can explicitly pre-configure and what an agent can sanely operate with. Large tool surfaces increase context pressure, token cost, and routing ambiguity. Manual setup also turns every new capability into another 1:1 integration burden. Security, credential handling, and transport differences make the problem worse.

## The Vision: Relay

**Relay removes the practical MCP configuration ceiling.**

Relay is an agent-centric runtime layer that lets agents do the heavy lifting at runtime. Instead of forcing developers to explicitly preload and maintain an ever-growing set of MCP servers, Relay lets the agent discover what it needs by intent, choose a server at runtime, and execute through one controlled path.

Our current implementation approach is to expose two meta-tools: `search` and `invoke`. That is not the thesis by itself. It is the mechanism we believe most cleanly solves the practical cap problem: keep the model-facing surface small while still allowing access to a much larger capability universe.

Security, trust, credential injection, policy enforcement, and analytics sit underneath that runtime model. They are essential, but they are support systems for the core idea: agents should not be blocked by explicit pre-configuration when the right capability could be discovered and used at runtime.

---

## Connect your agent

### Option 1 — Native MCP server (Claude Desktop, Cursor, Antigravity, Claude Code)

```json
{
  "mcpServers": {
    "relay": {
      "url": "https://relay.agentrail.dev/api/mcp-server"
    }
  }
}
```

Your agent gets two tools: `search_tools(intent)` and `invoke_tool(server, tool, args)`.

### Option 2 — System prompt / agents.md

```
You have access to Relay at https://Relay.dev.
Read https://Relay.dev/agents.md before your first tool call.
Search:  GET https://Relay.dev/api/servers/search?q={intent}
Invoke:  POST https://Relay.dev/api/proxy/{serverName}/{toolName}
```

### Option 3 — REST API

```bash
# Discover by intent — returns full inputSchema per tool
curl "https://Relay.dev/api/servers/search?q=send+transactional+email"

# Invoke through the secure proxy
curl -X POST "https://Relay.dev/api/proxy/sendgrid-mail/send_email" \
  -H "Content-Type: application/json" \
  -d '{"to": "user@example.com", "subject": "Hello", "body": "..."}'
```

---

## Credentials — Relay Vault

Most MCP servers require API keys. Store them once in the Relay Vault. The proxy decrypts and injects at call time — your agent never sees the raw value. You can view the secret name but not the value after saving.

**One-time setup per service:**

1. Get your API key from the service dashboard
2. Go to [Relay.dev/dashboard/secrets](https://Relay.dev/dashboard/secrets)
3. Enter the server name, the suggested variable name (shown in any 401 response), and your key
4. Done — every future call through Relay injects it automatically

---

## 📚 Core Documentation

As the repository scale has grown to handle enterprise-grade loads, detailed configuration instructions and design logic have been properly split into specialized manuals:

### 🛡️ [Security Guides & Trust Models](SECURITY.md)
Contains the exact breakdowns for the 14-layer security system (L1 through S-14), encompassing Shell Injection protections, PII safeguards, and Context-Bleed defenses. It also defines how external Sub-Registries map to quantitative 0–100 Trust Scores.

### 🏗️ [Architecture Deep Dive](ARCHITECTURE.md)
Outlines the high-performance systems powering Relay's infrastructure, including the 0-Latency DB Poly-Cache, Event-Loop ReDoS protections, our custom Three-Tier Skip algorithm for hyper-fast MCP ingestion, and details about future SDK and CLI rollouts.

### 🛠️ [Setup & Developer Guide](DEVELOPMENT.md)
Looking to host Relay locally, contribute to the Core API, or launch the Render NodeJS stdio-Sandbox? The Builder's Guide includes the full `bun run` processes, mandatory `.env` configurations, and Supabase SQL migration chains. It also includes the vital Pre-Production Checklist for operating your own live instance.

---

## API Reference

```
GET  /agents.md                               Agent skill file — fetch once, understand everything
GET  /api/mcp                                 Registry info, security layer list, agent prompt template
GET  /api/servers/search?q={intent}&limit=5   Semantic search — full inputSchema per tool returned
GET  /api/servers?sort=trust&verified=true&page=2&page_size=24
                                              Browse with filters + pagination
GET  /api/servers/:name                       Server detail, scan history, CVE issues
POST /api/proxy/:serverName/:toolName         14-layer security proxy — every call inspected
POST /api/mcp-server                          Native MCP server (StreamableHTTP)
GET  /api/mcp-server                          Native MCP server (SSE — for older clients)
POST /api/ingest                              Trigger ingest (CRON_SECRET required)
POST /api/admin/ingest                        Trigger ingest from the signed-in admin session
```

---

## License

Apache 2.0 License — Built by [Akinbobola Emmanuel](https://github.com/akins-dev)
