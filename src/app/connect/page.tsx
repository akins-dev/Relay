'use client';
import { useState } from 'react';

const SNIPPETS = {
  'claude-desktop': {
    label: 'Claude Desktop',
    lang: 'json',
    file: '~/Library/Application Support/Claude/claude_desktop_config.json',
    code: `{
  "mcpServers": {
    "openmcp": {
      "url": "https://openmcp.dev/api/mcp-server"
    }
  }
}`,
  },
  cursor: {
    label: 'Cursor',
    lang: 'json',
    file: '~/.cursor/mcp.json',
    code: `{
  "mcpServers": {
    "openmcp": {
      "url": "https://openmcp.dev/api/mcp-server"
    }
  }
}`,
  },
  'system-prompt': {
    label: 'System Prompt / AGENTS.md',
    lang: 'text',
    file: 'Any agent framework',
    code: `## MCP Tools

You have access to openMCP — a security-verified registry of 7,000+ MCP servers.
Read https://openmcp.dev/openmcp.md once before your first tool call.

Search:  GET https://openmcp.dev/api/servers/search?q={intent}
Invoke:  POST https://openmcp.dev/api/proxy/{serverName}/{toolName}

Prefer servers with trust_score > 80. Always use inputSchema from search results.`,
  },
  langchain: {
    label: 'LangChain / Python',
    lang: 'python',
    file: 'Any Python agent',
    code: `import httpx

async def search_mcp(intent: str):
    async with httpx.AsyncClient() as client:
        r = await client.get(
            "https://openmcp.dev/api/servers/search",
            params={"q": intent, "limit": 5}
        )
        return r.json()

async def invoke_mcp(server: str, tool: str, args: dict):
    async with httpx.AsyncClient() as client:
        r = await client.post(
            f"https://openmcp.dev/api/proxy/{server}/{tool}",
            json=args
        )
        return r.json()`,
  },
  curl: {
    label: 'cURL / REST',
    lang: 'bash',
    file: 'Any HTTP client',
    code: `# 1. Discover tools by intent
curl "https://openmcp.dev/api/servers/search?q=send+transactional+email"

# 2. Invoke through the security proxy
curl -X POST "https://openmcp.dev/api/proxy/sendgrid-mail/send_email" \\
  -H "Content-Type: application/json" \\
  -d '{"to": "user@example.com", "subject": "Hello", "body": "..."}'

# 3. Fetch the agent skill file
curl https://openmcp.dev/openmcp.md`,
  },
};

export default function ConnectPage() {
  const [active, setActive] = useState<keyof typeof SNIPPETS>('claude-desktop');
  const [copied, setCopied] = useState(false);

  function copy(text: string) {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  const snippet = SNIPPETS[active];

  return (
    <div className="page-sm" style={{ paddingTop: '60px', paddingBottom: '100px' }}>

      {/* Header */}
      <div style={{ marginBottom: '48px' }}>
        <div className="section-label" style={{ color: 'var(--accent)', marginBottom: '12px' }}>connect</div>
        <h1 style={{ fontSize: 'clamp(28px, 4vw, 42px)', fontWeight: 700, letterSpacing: '-0.02em', lineHeight: 1.1, marginBottom: '16px', fontFamily: 'var(--font-serif)' }}>
          One connection.<br /><span style={{ color: 'var(--accent)' }}>Every tool.</span>
        </h1>
        <p style={{ fontSize: '16px', color: 'var(--text-2)', lineHeight: 1.7, maxWidth: '480px' }}>
          Add openMCP to your agent once. Get access to 7,000+ verified MCP servers — discovered by intent, invoked through a 15-layer security proxy.
        </p>
      </div>

      {/* Quote */}
      <div style={{
        borderLeft: '2px solid var(--accent)',
        paddingLeft: '16px',
        marginBottom: '48px',
      }}>
        <p style={{ fontSize: '14px', color: 'var(--accent)', fontFamily: 'var(--font-serif)', fontStyle: 'italic', lineHeight: 1.6 }}>
          "Agent development will never scale treating every tool integration as a 1:1 integration."
        </p>
      </div>

      {/* Framework tabs */}
      <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap', marginBottom: '24px', borderBottom: '1px solid var(--border)', paddingBottom: '0' }}>
        {(Object.keys(SNIPPETS) as Array<keyof typeof SNIPPETS>).map(key => (
          <button
            key={key}
            onClick={() => setActive(key)}
            style={{
              background: 'none', border: 'none',
              borderBottom: active === key ? '2px solid var(--accent)' : '2px solid transparent',
              marginBottom: '-1px',
              color: active === key ? 'var(--text)' : 'var(--text-3)',
              padding: '10px 16px',
              cursor: 'pointer',
              fontSize: '13px',
              fontFamily: 'var(--font)',
              fontWeight: active === key ? 600 : 400,
              transition: 'color .15s',
            }}
          >
            {SNIPPETS[key].label}
          </button>
        ))}
      </div>

      {/* Code block */}
      <div className="codeblock" style={{ marginBottom: '40px' }}>
        <div className="codeblock-header">
          <span style={{ fontSize: '11px', color: 'var(--text-3)', fontFamily: 'var(--mono)' }}>
            {snippet.file}
          </span>
          <button onClick={() => copy(snippet.code)} className="btn btn-ghost btn-sm">
            {copied ? '✓ Copied' : 'Copy'}
          </button>
        </div>
        <pre style={{ color: 'var(--text-2)' }}>{snippet.code}</pre>
      </div>

      {/* How it works */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', marginBottom: '48px' }}>
        {[
          { num: '01', title: 'Agent has a task', desc: 'Needs to send an email, create a PR, charge a card — any capability.' },
          { num: '02', title: 'Queries openMCP by intent', desc: 'GET /api/servers/search?q=send+transactional+email — returns verified servers with full tool schemas.' },
          { num: '03', title: 'Reads the inputSchema', desc: 'No guessing. The agent knows exactly what arguments each tool requires before calling.' },
          { num: '04', title: 'Invokes through the proxy', desc: 'POST /api/proxy/sendgrid-mail/send_email — DLP scanned, audited, credentials never exposed.' },
        ].map(step => (
          <div key={step.num} style={{
            display: 'flex', gap: '16px', alignItems: 'flex-start',
            padding: '20px', background: 'var(--bg-1)',
            border: '1px solid var(--border)', borderRadius: '12px',
          }}>
            <span style={{ fontSize: '11px', fontFamily: 'var(--mono)', color: 'var(--accent)', fontWeight: 700, flexShrink: 0, marginTop: '2px' }}>{step.num}</span>
            <div>
              <div style={{ fontSize: '14px', fontWeight: 600, marginBottom: '4px' }}>{step.title}</div>
              <div style={{ fontSize: '13px', color: 'var(--text-3)', lineHeight: 1.6 }}>{step.desc}</div>
            </div>
          </div>
        ))}
      </div>

      {/* Security note */}
      <div style={{
        padding: '20px 24px',
        background: 'var(--accent-bg)',
        border: '1px solid rgba(232,103,58,0.2)',
        borderRadius: '12px',
        marginBottom: '32px',
      }}>
        <div style={{ fontSize: '13px', fontWeight: 600, color: 'var(--accent)', marginBottom: '8px' }}>
          Security on every call
        </div>
        <div style={{ fontSize: '13px', color: 'var(--text-2)', lineHeight: 1.7 }}>
          Every server scanned across 15 layers before listing. Every proxy call DLP-checked, shell-injection blocked, PII-scanned, and audited.
          Current OWASP MCP Top 10 coverage: ~70%.{' '}
          <a href="/registry" style={{ color: 'var(--accent)', textDecoration: 'none' }}>Browse verified servers →</a>
        </div>
      </div>

      {/* Links */}
      <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
        <a href="/openmcp.md" target="_blank" className="btn btn-ghost btn-sm" style={{ textDecoration: 'none', fontFamily: 'var(--mono)' }}>
          curl /openmcp.md
        </a>
        <a href="/api/mcp" target="_blank" className="btn btn-ghost btn-sm" style={{ textDecoration: 'none', fontFamily: 'var(--mono)' }}>
          GET /api/mcp
        </a>
        <a href="/registry" className="btn btn-primary btn-sm" style={{ textDecoration: 'none' }}>
          Browse Registry
        </a>
      </div>
    </div>
  );
}
