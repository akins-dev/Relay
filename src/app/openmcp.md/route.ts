import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { SITE_URL } from '@/lib/site';

/**
 * GET /openmcp.md
 *
 * Legacy route path, current Agentrail skill file.
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

  const md = `# Agentrail

The trust layer for runtime discovery and secure invocation of remote MCP servers. ${activeServers} active servers. Zero local setup.

> "Every agent framework is hitting the same wall: too many pre-loaded tools, shrinking context windows, and brittle integrations wired before the agent runs. Agentrail removes that wall."
>
> Agents describe what they need. Agentrail finds it, verifies it, and invokes it at runtime. The context window cost stays focused on just two tools: search and invoke.

## What you can do

- Discover invokable remote MCP servers by describing what you need
- Only servers with HTTP endpoints (SSE or StreamableHTTP transport) are returned today — stdio-only local servers are excluded until Agentrail CLI ships
- Invoke tools through a security proxy — request DLP blocking, response scanning, audit trail on every call
- Trust every result — each server scanned across 15 security layers before listing

## Live stats (as of this request)

- Active servers: ${activeServers}
- Verified servers: ${verifiedServers}
- Calls today: ${callsToday}
- Sources: Official MCP Registry + Smithery + Glama + GitHub

---

## How credentials work

Most MCP servers require authentication. You NEVER pass credentials as tool arguments.

### The Agentrail Vault

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
- \`tools[].name\` — tool name, used for invocation
- \`tools[].inputSchema\` — exact arguments required (use this, do not guess)
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
      ]
    }
  ]
\`\`\`

---

## Invoking tools

\`\`\`
POST ${SITE_URL}/api/proxy/{serverName}/{toolName}
Content-Type: application/json

{ ...tool arguments from inputSchema }
\`\`\`

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

If your framework supports MCP, connect to Agentrail once and get
\`search_tools\` and \`invoke_tool\` as native MCP tools:

\`\`\`json
{
  "mcpServers": {
    "agentrail": {
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
# 1. Search
GET /api/servers/search?q=create a GitHub pull request

# 2. Read the inputSchema from the result — use it exactly
# 3. Invoke
POST /api/proxy/github-tools/create_pull_request
{ "repo": "owner/repo", "title": "Fix bug", "head": "fix/branch", "base": "main" }

# 4. Check X-Registry-DLP-Warning header on response
\`\`\`

---

## Registry info

\`\`\`
GET ${SITE_URL}/api/mcp
\`\`\`

Returns full endpoint map, all security layers, and this prompt template.

---

## Works with CLI-first frameworks

If you are running in a CLI-first agent framework (OpenClaw, shell-based agents): Agentrail integrates with one config line today for remote MCP discovery and invocation. A dedicated local CLI bridge for stdio servers is planned next.

\`\`\`json
{ "mcpServers": { "agentrail": { "url": "${SITE_URL}/api/mcp-server" } } }
\`\`\`

## Coming soon

- **Agentrail CLI:** Use the same discovery layer for local stdio MCP servers. The bridge will route remote servers through Agentrail Cloud and local servers through a local process runner.
- **AgentSecrets-backed local credentials:** The CLI will use AgentSecrets as the credential substrate so local MCP servers can run without exposing secret values to agent context.
- **Expanded OAuth coverage:** Broader per-user OAuth support, provider auto-discovery, and improved connected-account UX. Static key vault works today for API-key-based servers.
- **WASM sandbox execution:** Pre-listing sandboxed execution to catch runtime-only payloads. Brings OWASP MCP Top 10 coverage from ~70% to ~85%.

---

*Agentrail — MIT licensed — built by The-17*
*https://github.com/the-17/openmcp*
`;

  return new NextResponse(md, {
    headers: {
      'Content-Type': 'text/markdown; charset=utf-8',
      'Cache-Control': 'public, max-age=300', // 5 min cache — stats update
      'Access-Control-Allow-Origin': '*',      // agents from any origin can fetch
    },
  });
}
