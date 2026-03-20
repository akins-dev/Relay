import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

/**
 * GET /openmcp.md
 *
 * Machine-readable skill file for AI agents.
 * Agents fetch this once and understand how to use the entire platform.
 * Pattern: same as Smithery's skill.md — but for fully autonomous,
 * zero-human-intervention agent workflows.
 *
 * Usage in system prompt:
 *   Read https://openmcp.dev/openmcp.md before your first tool call.
 */
export async function GET() {
  // Fetch live stats to inject into the skill file
  const supabase = createClient();
  const { data: stats } = await supabase.rpc('global_stats').single();
  const s = (stats as any) ?? {};

  const activeServers   = s.active_servers   ?? '7,000+';
  const verifiedServers = s.verified_servers ?? '0';
  const callsToday      = s.calls_today      ?? '0';

  const md = `# openMCP

The secure, open-source MCP registry. ${activeServers} verified servers. Zero configuration.

> "Agent development will never scale treating every tool integration as a 1:1 integration."
> openMCP is the answer: one endpoint, every tool, discovered by intent.

## What you can do

- Discover any MCP server by describing what you need
- Invoke tools through a security proxy — DLP, schema pinning, audit trail on every call
- Trust every result — each server scanned across 15 security layers before listing

## Live stats (as of this request)

- Active servers: ${activeServers}
- Verified servers: ${verifiedServers}
- Calls today: ${callsToday}
- Sources: Official MCP Registry + Smithery + Glama + GitHub

---

## Finding tools

\`\`\`
GET https://openmcp.dev/api/servers/search?q={your intent}&limit=5
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
POST https://openmcp.dev/api/proxy/{serverName}/{toolName}
Content-Type: application/json

{ ...tool arguments from inputSchema }
\`\`\`

Every call is:
- DLP-scanned on request and response (credentials never leak)
- Shell injection checked (18 OS command patterns blocked)
- PII-scanned on response (email, phone, SSN, card numbers)
- Audited — full log with credential presence marked ABSENT

**Response headers always include:**
- \`X-Registry-Trust-Score\` — server trust score at call time
- \`X-Registry-Latency\` — upstream latency in ms
- \`X-Registry-DLP-Warning\` — present if response triggered DLP rules

---

## Connecting as a native MCP server (recommended)

If your framework supports MCP, connect to openMCP once and get
\`search_tools\` and \`invoke_tool\` as native MCP tools:

\`\`\`json
{
  "mcpServers": {
    "openmcp": {
      "url": "https://openmcp.dev/api/mcp-server/sse"
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
**Infrastructure:** Trust score (L5) · Database RLS (L6) · OAuth 2.1 + PKCE (L7)

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
GET https://openmcp.dev/api/mcp
\`\`\`

Returns full endpoint map, all security layers, and this prompt template.

---

*openMCP — MIT licensed — built by The-17*
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
