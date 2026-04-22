import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { BRAND } from '@/lib/brand';
import { SITE_URL } from '@/lib/site';

/**
 * GET /agents.md
 *
 * Agent skill file.
 * Agents fetch this once and understand how to use the hosted platform.
 */
export async function GET() {
  // Fetch live stats to inject into the skill file
  const supabase = createClient();
  const { data: stats } = await supabase.rpc('global_stats').single();
  const s = (stats as any) ?? {};

  const activeServers   = s.active_servers   ?? 'thousands of';
  const verifiedServers = s.verified_servers ?? '0';
  const callsToday      = s.calls_today      ?? '0';

  const md = `# ${BRAND.name}

${BRAND.tagline} ${activeServers} active servers. Zero local setup.

> "Every agent framework is hitting the same wall: too many pre-loaded tools, shrinking context windows, and brittle integrations wired before the agent runs. ${BRAND.name} removes that wall."
>
> Agents describe what they need. ${BRAND.name} finds it, verifies it, and invokes it at runtime. The context window cost stays focused on just two tools: search and invoke.

## Activation rules — when to use this registry

**CALL search_tools when you need to:**
- Send messages, emails, or notifications to external services
- Query or write to databases, data stores, or file systems
- Create, update, or delete resources (issues, PRs, records, files)
- Call any external API or interact with any third-party service
- Execute any operation that affects the real world

**DO NOT call search_tools when:**
- You can answer from your own training (definitions, explanations, calculations)
- The task is reasoning, writing, or code generation with no external action
- The intent is a knowledge question ("what is X", "explain Y", "how does Z work")

**Decision rule:** If the task requires changing state somewhere outside this conversation, search first. If it only requires knowledge, answer directly.

## What you can do

- **Discover** MCP servers by intent — all transports (stdio, SSE, Streamable HTTP)
- **Invoke tools** through a security proxy (HTTP servers only) — DLP blocking, response scanning, audit trail on every call
- **Read resources** — file/data contexts exposed by servers (GET/POST /api/proxy/{server}/resources)
- **Run prompts** — server-defined prompt templates (POST /api/proxy/{server}/prompts/{name})
- **Trust every result** — each server scanned across 14 security layers before listing
- **Autodiscover this registry** — \`GET /.well-known/mcp.json\` returns a machine-readable manifest

**About stdio servers:** stdio servers appear in search results with \`proxy_available: false\`. They are not invocable through the web proxy today. ${BRAND.cli} (planned) will bridge them locally. For now, skip results where \`proxy_available\` is \`false\`.

## Live stats (as of this request)

- Active servers: ${activeServers} (all transports — stdio, SSE, HTTP)
- Verified servers: ${verifiedServers}
- Calls today: ${callsToday}
- Sources: Official MCP Registry + Smithery + Glama + GitHub + ClaudeMCP + MCP.so
- MCP spec version: 2025-03-26 (also supports 2024-11-05)

---

## How credentials work

Most MCP servers require authentication. You NEVER pass credentials as tool arguments.

### The ${BRAND.vault}

Store your API key once at ${SITE_URL}/dashboard/secrets.
The proxy decrypts and injects it at call time. You can view the secret name but never the value after saving. Your agent never sees the raw key at any point.

**Setup flow (one time per service):**
1. Get your API key from the service's dashboard
2. Go to ${SITE_URL}/dashboard/secrets
3. Set Server: the server name, Name: the suggested name from the 401 response, Value: your key
4. Tell your agent to proceed — works automatically forever after

**Call flow (every invocation):**
1. Agent calls POST /api/proxy/stripe-payments/charge_card { "amount": 4900, "currency": "usd" }
2. Proxy looks up STRIPE_PAYMENTS_API_KEY from vault (AES-256-GCM encrypted, pgsodium)
3. Decrypts and injects as Authorization header
4. Upstream server receives authenticated call
5. Response returned — key never touched agent memory, logs, or request body

**If a call returns 401:** the response includes the exact secret name to use and a direct dashboard link.

**Never do this:** pass API keys as tool arguments. The DLP layer blocks it with an explanation.

## Finding tools

\`\`\`
GET ${SITE_URL}/api/servers/search?q={your intent}&limit=5
\`\`\`

**Response fields you need:**
- \`name\` — server identifier, used for invocation
- \`transport\` — \`streamable_http\` | \`sse\` | \`stdio\`
- \`proxy_available\` — \`true\` = call through web proxy; \`false\` = use CLI bridge (\`openmcp run {name}\`)
- \`mcp_compliant\` — server passed MCP initialize handshake
- \`protocol_version\` — e.g. \`2025-03-26\` or \`2024-11-05\`
- \`tools[].name\` — tool name, used for invocation
- \`tools[].inputSchema\` — exact arguments required (use this, do not guess)
- \`resources\` — list of data contexts the server exposes (uri, name, mimeType)
- \`prompts\` — list of prompt templates (name, description, arguments)
- \`trust_score\` — 0–100. Prefer > 80 for production. > 90 = verified + stable.
- \`latency_ms\` — average upstream latency
- \`source\` — \`official\` | \`smithery\` | \`github\` | \`direct\`

**Example:**
\`\`\`
GET /api/servers/search?q=send transactional email&limit=3

→ [
    {
      "name": "sendgrid-mail",
      "trust_score": 82,
      "transport": "streamable_http",
      "proxy_available": true,
      "mcp_compliant": true,
      "protocol_version": "2025-03-26",
      "tools": [
        {
          "name": "send_email",
          "description": "Send a transactional email",
          "inputSchema": {
            "type": "object",
            "required": ["to", "subject", "body"],
            "properties": {
              "to":      { "type": "string" },
              "subject": { "type": "string" },
              "body":    { "type": "string" }
            }
          }
        }
      ],
      "resources": [],
      "prompts": []
    },
    {
      "name": "filesystem",
      "transport": "stdio",
      "proxy_available": false,
      "tools": ["read_file", "write_file", "list_directory"],
      "_hint": "Run locally: openmcp run filesystem"
    }
  ]
\`\`\`

---

## Invoking tools

\`\`\`
POST ${SITE_URL}/api/proxy/{serverName}/{toolName}
Authorization: Bearer sk_mcp_<your-key>
Content-Type: application/json

{ ...tool arguments from inputSchema }
\`\`\`

## Reading resources

\`\`\`
# List all resources
GET ${SITE_URL}/api/proxy/{serverName}/resources

# Read a specific resource by URI
POST ${SITE_URL}/api/proxy/{serverName}/resources
Content-Type: application/json
{ "uri": "file:///path/to/resource" }
\`\`\`

## Running prompts

\`\`\`
# List all prompts
GET ${SITE_URL}/api/proxy/{serverName}/prompts

# Get a prompt with arguments (MCP spec: all arguments must be strings)
POST ${SITE_URL}/api/proxy/{serverName}/prompts/{promptName}
Content-Type: application/json
{ "arguments": { "topic": "TypeScript generics", "tone": "concise" } }
\`\`\`

## About stdio servers

stdio servers appear in search results with \`proxy_available: false\` and \`transport: "stdio"\`.
They cannot be invoked through the web proxy. ${BRAND.cli} (coming soon) will act as a Native MCP server.
When configured in your agent host, the CLI dynamically spawns stdio subprocesses on demand (like \`npx\` downloads and runs without a permanent install), manages the process lifecycle, applies local security scans, and returns the result safely.

**For now:** When you encounter a search result with \`proxy_available: false\`, skip it until the CLI is available.
Only invoke servers where \`proxy_available\` is \`true\`.

Every call is:
- DLP-blocked on requests; response matches are surfaced via warnings and audit metadata
- Shell injection checked (18 OS command patterns blocked)
- PII-scanned on response (email, phone, SSN, card numbers)
- Audited — full log with credential presence marked ABSENT

**Response headers always include:**
- \`X-Registry-Trust-Score\` — server trust score at call time
- \`X-Registry-Latency\` — upstream latency in ms
- \`X-Registry-DLP-Warning\` — present if response triggered DLP rules

---

## Connecting as a native MCP server (recommended)

If your framework supports MCP, connect to ${BRAND.name} once and get
\`search_tools\` and \`invoke_tool\` as native MCP tools:

\`\`\`json
{
  "mcpServers": {
    "${BRAND.slug}": {
      "url": "${SITE_URL}/api/mcp-server"
    }
  }
}
\`\`\`

Then call:
- \`search_tools({ intent: "send an email" })\` — returns verified servers with full schemas
- \`invoke_tool({ server: "sendgrid-mail", tool: "send_email", args: {...} })\` — proxied securely

---

## Trust score guide

| Score | Meaning | Recommendation |
|-------|---------|----------------|
| 90–100 | Verified publisher, stable schema, high uptime | Safe for production |
| 80–89 | Good signal, passed all scans | Suitable for most use cases |
| 70–79 | Passed scans, limited history | Use with awareness |
| < 70 | Limited data or minor issues | Test before production use |

---

## Security layers (every server)

**Publish-time:** Static scan (L1) · Schema pinning (L3) · npm CVE scan · Typosquatting (L8)
**Runtime proxy:** Credential DLP (L4) · Shell injection (S-12) · Indirect injection (S-13) · PII detection (L10) · URL elicitation (L11) · Context isolation (L12)
**Infrastructure:** Trust score (L5) · Database RLS (L6) · OAuth flow security (L7)

Current OWASP MCP Top 10 coverage: ~70%. Target: 90%+ with WASM sandbox.

---

## Quick example workflow

\`\`\`
# 1. Autodiscover the registry (agents do this once)
GET /.well-known/mcp.json

# 2. Search
GET /api/servers/search?q=create a GitHub pull request

# 3. Check proxy_available — if false, skip (stdio, not invocable through web proxy yet)
# 4. Read the inputSchema from the result — use it exactly
# 5. Invoke (HTTP server example)
POST /api/proxy/github-tools/create_pull_request
{ "repo": "owner/repo", "title": "Fix bug", "head": "fix/branch", "base": "main" }

# 6. Check X-Registry-DLP-Warning header on response
\`\`\`

---

## Registry info

\`\`\`
GET ${SITE_URL}/api/mcp
\`\`\`

Returns full endpoint map, all security layers, and this prompt template.

---

## Works with CLI-first frameworks

If you are running in a CLI-first agent framework (OpenClaw, shell-based agents): ${BRAND.name} integrates with one config line today for remote MCP discovery and invocation. A dedicated local CLI bridge for stdio servers is planned next.

\`\`\`json
{ "mcpServers": { "${BRAND.slug}": { "url": "${SITE_URL}/api/mcp-server" } } }
\`\`\`

## Coming soon / In progress

- **${BRAND.cli}:** Native MCP server for your agent host. Spawns stdio MCP servers as local subprocesses on demand (like \`npx\`). Same discovery layer, same security scanning, fully central Vault credentials management.
- **TypeScript and Python SDKs:** Programmatic agent integration — \`import { search, invoke } from '${BRAND.slug}'\`
- **Session pooling:** Reuse MCP initialized sessions — reduces latency from ~600ms to ~50ms per call.
- **Sampling security:** Rate-limit and audit server-initiated \`sampling/createMessage\` requests.
- **OAuth token refresh:** Auto-refresh expired tokens in the proxy without user action.
- **WASM sandbox:** Pre-listing sandboxed execution. Brings OWASP MCP Top 10 coverage from ~70% to ~90%.
- **Cloud stdio bridge:** Container-based stdio invocation without local CLI.

---

*${BRAND.name} — MIT licensed — built by ${BRAND.org}*
*${BRAND.githubUrl}*
\`;`

  return new NextResponse(md, {
    headers: {
      'Content-Type': 'text/markdown; charset=utf-8',
      'Cache-Control': 'public, max-age=300', // 5 min cache — stats update
      'Access-Control-Allow-Origin': '*',      // agents from any origin can fetch
    },
  });
}