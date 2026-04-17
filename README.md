# ⬡ Relay

**The secure, runtime discovery and invocation layer for MCP servers.**

> "Agent development will never scale if we treat every new tool as a hard-coded 1:1 integration."

[![License: Apache 2.0](https://img.shields.io/badge/License-Apache_2.0-e8673a.svg)](LICENSE)
[![Next.js](https://img.shields.io/badge/Next.js-14.2.25-black)](https://nextjs.org)
[![Supabase](https://img.shields.io/badge/Supabase-Postgres-3ECF8E)](https://supabase.com)

---

## The Problem: The Context & Security Bottleneck

Currently, AI agents are strictly bottlenecked by human pre-configuration. To interact with the outside world, a developer must manually discover, configure, and inject entire Model Context Protocol (MCP) tool schemas into an agent's context window **before** it ever runs. 

As an agent's capabilities grow, injecting dozens of massive tool schemas wastes huge portions of the LLM's context window. This constraint drives up token costs, significantly increases latency, and degrades the agent's reasoning focus, which inevitably leads to severe hallucinations. Worse yet, giving an autonomous agent unmitigated access to unverified remote tools presents a massive security vector. The friction of the current static MCP ecosystem fundamentally limits autonomous workflows.

## The Vision: Relay

**Relay completely breaks the 30-tool context ceiling.**

Relay is a secure runtime discovery tool that allows AI agents to query and discover tools purely by intent. Instead of manually selecting and pre-loading static toolsets, agents use Relay to dynamically discover exactly what they need, the moment they need to solve a user's problem. 

This architectural shift grants agents access to thousands of MCPs instantly while permanently keeping their context window light (reducing the cognitive load and resulting hallucinations). The context window cost is forever reduced to exactly two meta-tools: `search` and `invoke`.

Most importantly, Relay acts as the immutable bridging layer—ensuring strict data loss prevention (DLP), payload injection detection, and repository trust-scoring. Relay empowers true autonomous agentic scale without compromising security.

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

### Option 2 — System prompt / AGENTS.md

```
You have access to Relay at https://Relay.dev.
Read https://Relay.dev/Relay.md before your first tool call.
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
GET  /Relay.md                                Agent skill file — fetch once, understand everything
GET  /api/mcp                                 Registry info, security layer list, agent prompt template
GET  /api/servers/search?q={intent}&limit=5   Semantic search — full inputSchema per tool returned
GET  /api/servers?sort=trust&verified=true&page=2&page_size=24
                                              Browse with filters + pagination
GET  /api/servers/:name                       Server detail, scan history, CVE issues
POST /api/proxy/:serverName/:toolName         15-layer security proxy — every call inspected
POST /api/mcp-server                          Native MCP server (StreamableHTTP)
GET  /api/mcp-server                          Native MCP server (SSE — for older clients)
POST /api/ingest                              Trigger ingest (CRON_SECRET required)
POST /api/admin/ingest                        Trigger ingest from the signed-in admin session
```

---

## License

Apache 2.0 License — Built by [Akinbobola Emmanuel](https://github.com/akins-dev)
