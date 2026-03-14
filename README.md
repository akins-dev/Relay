# ⬡ MCP Registry

**The open-source universal MCP discovery and security platform.**

Publish your MCP server once. Let any AI agent find and invoke it at runtime — with zero hardcoded connections and a built-in 5-layer security stack.

[![License: MIT](https://img.shields.io/badge/License-MIT-22c55e.svg)](LICENSE)
[![Next.js](https://img.shields.io/badge/Next.js-14-black)](https://nextjs.org)
[![Open Source](https://img.shields.io/badge/open%20source-yes-22c55e)](https://github.com/the-17/mcp-registry)

---

## What is this?

MCP Registry solves the biggest missing piece in the MCP ecosystem: **runtime discovery**.

Today every AI agent must have MCP servers explicitly configured before deployment. With MCP Registry, one line in your system prompt gives agents access to every registered server — discovered by intent, invoked through a secure proxy, with credentials never touching agent memory.

```
# Your entire MCP configuration — just this in your system prompt:

You have access to the MCP Registry at https://registry.the-17.dev.
When you need any capability, search: GET /api/servers/search?q={intent}
Then invoke via: POST /api/proxy/{serverName}/{toolName}
```

---

## Quick Start

### Local development

```bash
git clone https://github.com/the-17/mcp-registry
cd mcp-registry

# Install dependencies
npm install

# Copy env and configure
cp .env.example .env

# Seed the database with demo servers
npm run db:seed

# Start the dev server
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

### Docker (production)

```bash
cp .env.example .env
# Edit .env — set a strong JWT_SECRET

docker-compose up --build -d
docker-compose exec app npx tsx scripts/seed.ts
```

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                        MCP Registry                             │
│                                                                 │
│  ┌──────────┐   publish + scan   ┌─────────────────────────┐   │
│  │Developer │──────────────────▶ │  Registry + Scanner     │   │
│  └──────────┘                    │  (SQLite + static scan) │   │
│                                  └────────────┬────────────┘   │
│                                               │                 │
│  ┌──────────┐  search("intent")  ┌────────────▼────────────┐   │
│  │  Agent   │──────────────────▶ │  Semantic Search API    │   │
│  └────┬─────┘                    └────────────┬────────────┘   │
│       │                                        │ trust+endpoint  │
│       │  invoke tool             ┌────────────▼────────────┐   │
│       └────────────────────────▶ │  Proxy Layer (DLP+audit)│   │
│                                  └────────────┬────────────┘   │
│                                               │                 │
│                                  ┌────────────▼────────────┐   │
│                                  │  Upstream MCP Server    │   │
│                                  └─────────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
```

---

## Security Stack

Every published server passes through 5 mandatory layers:

| Layer | What it catches |
|-------|----------------|
| **L1 — Static Scan** | Prompt injection in tool descriptions, exfiltration patterns, deceptive language, insecure endpoints |
| **L2 — WASM Sandbox** | Runtime-only behaviors, deferred payloads, error-channel attacks invisible to static analysis |
| **L3 — Schema Pinning** | Rug-pull attacks — any schema mutation triggers auto-suspension and re-scan |
| **L4 — Proxy DLP** | Credential patterns in request/response bodies, cross-server hijacking, domain-hop exfiltration |
| **L5 — Trust Score** | Dynamic per-server score from scan history, uptime, schema stability, and community signals |

---

## API Reference

### Discovery

```http
# Search by natural language intent
GET /api/servers/search?q=send+transactional+email&limit=5

# Browse with filters
GET /api/servers?sort=trust&verified=true&tag=payments&page=1

# Get server details
GET /api/servers/:name

# Global stats
GET /api/servers/stats

# Registry info (for agent system prompts)
GET /api/mcp
```

### Invocation (via proxy)

```http
# Invoke a tool through the secure proxy
POST /api/proxy/:serverName/:toolName
Content-Type: application/json
Authorization: Bearer sk_mcp_...  # optional

{ "param": "value" }
```

Response headers always include:
- `X-Registry-Latency` — upstream latency in ms
- `X-Registry-Trust-Score` — server trust score at time of call
- `X-Registry-DLP-Warning` — present if response triggered DLP rules

### Authentication

```http
POST /api/auth/register   { username, email, password }
POST /api/auth/login      { email, password }
GET  /api/auth/me         Bearer <token>
POST /api/auth/api-keys   { name }     Bearer <token>
DELETE /api/auth/api-keys?id=<id>      Bearer <token>
```

---

## Publishing a Server

Via the web UI at `/publish`, or directly:

```bash
curl -X POST https://registry.the-17.dev/api/servers \
  -H "Authorization: Bearer your-jwt-token" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "my-mcp-server",
    "display_name": "My MCP Server",
    "description": "What it does in 20+ chars",
    "endpoint": "https://your-server.example.com",
    "version": "1.0.0",
    "license": "MIT",
    "tags": ["category", "subcategory"],
    "tools": ["tool_one", "tool_two"]
  }'
```

The response includes a `scan` object with `passed`, `score`, and any `issues` found.

---

## Project Structure

```
mcp-registry/
├── src/
│   ├── app/
│   │   ├── api/
│   │   │   ├── auth/          # register, login, me, api-keys
│   │   │   ├── servers/       # list, publish, search, stats, [name], star
│   │   │   ├── proxy/         # [serverName]/[toolName] — DLP proxy
│   │   │   └── mcp/           # registry info endpoint for agents
│   │   ├── registry/          # browse + [name] detail pages
│   │   ├── publish/           # publish form
│   │   ├── dashboard/         # user dashboard
│   │   ├── login/             # auth page
│   │   ├── page.tsx           # home (server component)
│   │   ├── HomeClient.tsx     # animated hero, terminal, flow diagram
│   │   ├── layout.tsx
│   │   └── globals.css
│   ├── components/
│   │   ├── layout/Nav.tsx
│   │   ├── registry/ServerCard.tsx
│   │   └── AuthProvider.tsx
│   ├── lib/
│   │   ├── db.ts              # SQLite singleton
│   │   ├── auth.ts            # JWT + API key helpers
│   │   └── security.ts        # scanner + DLP + trust score
│   └── types/index.ts
├── scripts/
│   └── seed.ts
├── Dockerfile
├── docker-compose.yml
├── next.config.js
└── .env.example
```

---

## Self-Hosting

This project is designed to be self-hosted. The only dependency is Node.js 22+ (SQLite is bundled via better-sqlite3).

For production:
1. Set a strong `JWT_SECRET` (min 32 chars)
2. Mount a persistent volume at `/data` for the SQLite database
3. Put a reverse proxy (Nginx, Caddy) in front for TLS

---

## Contributing

MIT licensed. Issues and PRs welcome at [github.com/the-17/mcp-registry](https://github.com/the-17/mcp-registry).

Built by [The-17](https://github.com/the-17) — building the infrastructure layer of the AI agent economy.
