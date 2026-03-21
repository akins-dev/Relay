'use client';
import { useState } from 'react';
import Link from 'next/link';

const SECTIONS = [
  { id: 'what-is-openmcp', label: 'What is openMCP?' },
  { id: 'how-it-works',    label: 'How it works' },
  { id: 'quickstart',      label: 'Quickstart' },
  { id: 'credentials',     label: 'Credentials & security' },
  { id: 'mcp-server',      label: 'Native MCP server' },
  { id: 'rest-api',        label: 'REST API reference' },
  { id: 'trust-scores',    label: 'Trust scores' },
  { id: 'categories',      label: 'MCP categories' },
  { id: 'faq',             label: 'FAQ' },
  { id: 'known-limitations', label: "What's coming" },
];

const CODE = {
  systemPrompt: `You have access to openMCP — a security-verified registry of MCP servers.
Read https://openmcp.dev/openmcp.md before your first tool call.

Search:  GET https://openmcp.dev/api/servers/search?q={intent}
Invoke:  POST https://openmcp.dev/api/proxy/{serverName}/{toolName}`,

  mcpConfig: `{
  "mcpServers": {
    "openmcp": {
      "url": "https://openmcp.dev/api/mcp-server"
    }
  }
}`,

  searchExample: `GET /api/servers/search?q=send+transactional+email

{
  "results": [
    {
      "name": "sendgrid-mail",
      "trust_score": 82,
      "source": "smithery",
      "tools": [
        {
          "name": "send_email",
          "inputSchema": {
            "required": ["to", "subject", "body"],
            "properties": {
              "to":      { "type": "string" },
              "subject": { "type": "string" },
              "body":    { "type": "string" }
            }
          }
        }
      ],
      "invoke": {
        "rest": "POST /api/proxy/sendgrid-mail/send_email"
      }
    }
  ]
}`,

  invokeExample: `POST /api/proxy/sendgrid-mail/send_email
Content-Type: application/json

{
  "to": "user@example.com",
  "subject": "Your order is confirmed",
  "body": "Thank you for your purchase!"
}`,

  agentSecrets: `# 1. Store your API key once (never in a file)
agentsecrets secrets set SENDGRID_API_KEY=SG.xxxx

# 2. Agent calls openMCP proxy
# 3. Proxy resolves key from AgentSecrets vault
# 4. Injects into upstream call
# 5. Agent gets response — never saw the key`,

  mcpServerSearch: `// Agent calls search_tools
{
  "jsonrpc": "2.0",
  "method": "tools/call",
  "params": {
    "name": "search_tools",
    "arguments": { "intent": "create a GitHub pull request" }
  }
}

// openMCP returns results with full inputSchema`,

  mcpServerInvoke: `// Agent calls invoke_tool
{
  "jsonrpc": "2.0",
  "method": "tools/call",
  "params": {
    "name": "invoke_tool",
    "arguments": {
      "server": "github-tools",
      "tool":   "create_pull_request",
      "args": {
        "repo":  "owner/repo",
        "title": "Fix login bug",
        "head":  "fix/login",
        "base":  "main"
      }
    }
  }
}`,
};

function CodeBlock({ code, label }: { code: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="codeblock" style={{ marginBottom: '16px' }}>
      {label && (
        <div className="codeblock-header">
          <span style={{ fontSize: '11px', fontFamily: 'var(--mono)', color: 'var(--text-3)' }}>{label}</span>
          <button
            onClick={() => { navigator.clipboard.writeText(code); setCopied(true); setTimeout(() => setCopied(false), 2000); }}
            className="btn btn-ghost btn-sm"
          >{copied ? '✓ Copied' : 'Copy'}</button>
        </div>
      )}
      <pre style={{ color: '#d6cfc8' }}>{code}</pre>
    </div>
  );
}

function Section({ id, title, children }: { id: string; title: string; children: React.ReactNode }) {
  return (
    <section id={id} style={{ paddingTop: '48px', paddingBottom: '16px', borderBottom: '1px solid var(--border)' }}>
      <h2 style={{ fontSize: '24px', fontWeight: 700, letterSpacing: '-0.02em', marginBottom: '20px', color: 'var(--text)' }}>
        {title}
      </h2>
      {children}
    </section>
  );
}

const P = ({ children }: { children: React.ReactNode }) => (
  <p style={{ color: 'var(--text-2)', lineHeight: 1.75, marginBottom: '16px', fontSize: '15px' }}>{children}</p>
);

const Callout = ({ children, color = 'var(--accent-bg)', border = 'var(--accent)' }: any) => (
  <div style={{ padding: '16px 20px', background: color, border: `1px solid ${border}`, borderRadius: '10px', marginBottom: '20px' }}>
    {children}
  </div>
);

const CATEGORIES = [
  { icon: '🔧', name: 'Developer tools',     count: '1,200+', examples: 'GitHub, GitLab, Jira, Linear, Sentry, Vercel',  creds: true  },
  { icon: '🗄️', name: 'Databases',           count: '800+',   examples: 'PostgreSQL, MySQL, MongoDB, Supabase, Redis',   creds: true  },
  { icon: '💳', name: 'Payments',            count: '150+',   examples: 'Stripe, PayPal, Paddle, Lemon Squeezy',         creds: true  },
  { icon: '📧', name: 'Communication',       count: '400+',   examples: 'Slack, Discord, Gmail, Outlook, Telegram',      creds: true  },
  { icon: '🤖', name: 'AI & ML',             count: '500+',   examples: 'OpenAI, Replicate, HuggingFace, ElevenLabs',    creds: true  },
  { icon: '☁️', name: 'Cloud infra',         count: '300+',   examples: 'AWS, GCP, Cloudflare, Vercel, Fly.io',          creds: true  },
  { icon: '📊', name: 'CRM & productivity',  count: '600+',   examples: 'Salesforce, HubSpot, Notion, Airtable',         creds: true  },
  { icon: '🌐', name: 'Public data',         count: '200+',   examples: 'Weather, exchange rates, Wikipedia, news',      creds: false },
  { icon: '🔍', name: 'Search',              count: '50+',    examples: 'Brave, Tavily, Exa, Perplexity',                creds: true  },
  { icon: '🎨', name: 'Design',              count: '100+',   examples: 'Figma, Canva, Adobe',                           creds: true  },
  { icon: '📁', name: 'File & storage',      count: '150+',   examples: 'Google Drive, Dropbox, S3, local filesystem',   creds: true  },
  { icon: '📈', name: 'Analytics',           count: '100+',   examples: 'PostHog, Mixpanel, Segment, GA',                creds: true  },
];

export default function DocsPage() {
  const [active, setActive] = useState('what-is-openmcp');

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '220px 1fr', minHeight: '100vh', maxWidth: '1200px', margin: '0 auto', padding: '40px 40px 80px' }}>

      {/* Sidebar */}
      <aside style={{ position: 'sticky', top: '80px', height: 'fit-content', paddingRight: '32px' }}>
        <div style={{ fontSize: '11px', fontFamily: 'var(--mono)', textTransform: 'uppercase', letterSpacing: '0.1em', color: 'var(--text-3)', marginBottom: '12px' }}>
          Documentation
        </div>
        <nav style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
          {SECTIONS.map(s => (
            <a
              key={s.id}
              href={`#${s.id}`}
              onClick={() => setActive(s.id)}
              style={{
                padding: '7px 12px', borderRadius: '8px', fontSize: '14px',
                color: active === s.id ? 'var(--accent)' : 'var(--text-2)',
                background: active === s.id ? 'var(--accent-bg)' : 'transparent',
                textDecoration: 'none', transition: 'all .15s', fontWeight: active === s.id ? 600 : 400,
              }}
            >{s.label}</a>
          ))}
        </nav>
      </aside>

      {/* Content */}
      <main style={{ minWidth: 0 }}>
        <div style={{ marginBottom: '48px' }}>
          <div className="section-label" style={{ color: 'var(--accent)' }}>docs</div>
          <h1 style={{ fontSize: '36px', fontWeight: 700, letterSpacing: '-0.02em', marginBottom: '12px', fontFamily: 'var(--font-serif)' }}>
            openMCP Documentation
          </h1>
          <p style={{ fontSize: '17px', color: 'var(--text-2)', lineHeight: 1.7 }}>
            Everything you need to connect your AI agents to thousands of scanned MCP servers.
          </p>
        </div>

        {/* What is openMCP */}
        <Section id="what-is-openmcp" title="What is openMCP?">
          <P>
            openMCP is the missing layer between AI agents and MCP servers. Today, every agent must have
            MCP servers explicitly configured before deployment. There is no way for an agent to discover
            what tools exist, evaluate their quality, or connect to them autonomously.
          </P>
          <P>
            openMCP solves this with a single endpoint. Your agent queries it by describing what it needs,
            gets back verified servers with full tool schemas, and invokes tools through a security proxy —
            all at runtime, with zero pre-configuration.
          </P>
          <Callout>
            <p style={{ fontSize: '14px', fontStyle: 'italic', color: 'var(--accent)', fontFamily: 'var(--font-serif)', lineHeight: 1.6 }}>
              "Agent development will never scale treating every tool integration as a 1:1 integration."
            </p>
          </Callout>
          <P>
            <strong>Free forever.</strong> The core registry, semantic search, and proxy are always free.
            No credit card. No rate limits on core features. No lock-in.
          </P>
          <P>
            <strong>Open source.</strong> MIT licensed. Full source at{' '}
            <a href="https://github.com/the-17/openmcp" style={{ color: 'var(--accent)' }}>github.com/the-17/openmcp</a>.
            The security claims are verifiable, not a promise.
          </P>
        </Section>

        {/* How it works */}
        <Section id="how-it-works" title="How it works">
          <P>Every agent interaction follows this flow:</P>
          {[
            ['1', 'Agent has a task', 'Needs to send an email, create a PR, charge a card — any capability.'],
            ['2', 'Queries openMCP by intent', 'GET /api/servers/search?q=send transactional email — returns verified servers with full inputSchema per tool.'],
            ['3', 'Reads the inputSchema', 'No guessing. The agent knows exactly what arguments each tool requires before calling.'],
            ['4', 'Invokes through the proxy', 'POST /api/proxy/sendgrid-mail/send_email — every call is DLP-scanned, shell-injection blocked, PII-checked, and audited.'],
            ['5', 'Gets a response', 'The upstream result, scrubbed for credentials and PII, returned to the agent. Audit trail written.'],
          ].map(([num, title, desc]) => (
            <div key={num} style={{ display: 'flex', gap: '16px', marginBottom: '12px', padding: '16px', background: 'var(--bg-1)', border: '1px solid var(--border)', borderRadius: '10px' }}>
              <span style={{ fontSize: '11px', fontFamily: 'var(--mono)', color: 'var(--accent)', fontWeight: 700, flexShrink: 0, width: '20px' }}>{num}</span>
              <div>
                <div style={{ fontSize: '14px', fontWeight: 600, marginBottom: '4px' }}>{title}</div>
                <div style={{ fontSize: '13px', color: 'var(--text-3)', lineHeight: 1.6 }}>{desc}</div>
              </div>
            </div>
          ))}

          <h3 style={{ fontSize: '17px', fontWeight: 600, margin: '24px 0 12px' }}>Security on every server and every call</h3>
          <P>
            Every server ingested from official registry, Smithery, Glama, or GitHub is scanned across
            15 layers before listing: static injection analysis, npm CVE scanning, schema pinning,
            typosquatting detection, and more. Every proxy call adds DLP, shell injection detection,
            PII scanning, URL elicitation safety, and context isolation. Current OWASP MCP Top 10
            coverage: ~70%.
          </P>
        </Section>

        {/* Quickstart */}
        <Section id="quickstart" title="Quickstart">
          <h3 style={{ fontSize: '17px', fontWeight: 600, margin: '0 0 12px' }}>Option 1 — System prompt (works everywhere)</h3>
          <CodeBlock code={CODE.systemPrompt} label="Add to your system prompt or AGENTS.md" />

          <h3 style={{ fontSize: '17px', fontWeight: 600, margin: '24px 0 12px' }}>Option 2 — Native MCP server (Claude Desktop, Cursor, Antigravity, etc.)</h3>
          <CodeBlock code={CODE.mcpConfig} label="claude_desktop_config.json / .cursor/mcp.json / mcp_config.json" />
          <P>Restart your IDE. Your agent now has two tools: <code style={{ fontFamily: 'var(--mono)', fontSize: '13px', background: 'var(--bg-2)', padding: '1px 6px', borderRadius: '4px' }}>search_tools</code> and <code style={{ fontFamily: 'var(--mono)', fontSize: '13px', background: 'var(--bg-2)', padding: '1px 6px', borderRadius: '4px' }}>invoke_tool</code>.</P>

          <h3 style={{ fontSize: '17px', fontWeight: 600, margin: '24px 0 12px' }}>Option 3 — Fetch the agent skill file</h3>
          <CodeBlock code="curl https://openmcp.dev/openmcp.md" label="Your agent fetches this once — understands everything" />
          <P>
            The skill file is served dynamically with live stats. It teaches any agent how to search,
            how to read inputSchemas, how to invoke, and what trust scores mean. No documentation
            hunting required.
          </P>
        </Section>

        {/* Credentials */}
        <Section id="credentials" title="Credentials & security">
          <P>
            <strong>Do all MCP servers require credentials?</strong> No — roughly 30% are public and
            require nothing. The rest require an API key or OAuth token. Weather, Wikipedia, exchange
            rates: free. Stripe, GitHub, Gmail: credentials required.
          </P>

          <h3 style={{ fontSize: '17px', fontWeight: 600, margin: '24px 0 12px' }}>The credential problem</h3>
          <P>
            Every MCP tutorial tells you to paste API keys into a config file. Those files get committed
            to git, read by AI assistants, and exfiltrated via prompt injection. Check Point documented
            CVE-2026-21852 — a vulnerability that harvests credentials directly from MCP config files.
          </P>

          <h3 style={{ fontSize: '17px', fontWeight: 600, margin: '24px 0 12px' }}>What openMCP does about it</h3>
          <P>
            The openMCP proxy runs DLP on every request and response — 11 credential patterns. If a
            credential pattern appears in a tool argument (the agent accidentally including an API key),
            the call is blocked before it reaches the upstream server. If a credential appears in a
            response, it is flagged before being returned to the agent.
          </P>

          <h3 style={{ fontSize: '17px', fontWeight: 600, margin: '24px 0 12px' }}>AgentSecrets — the complete solution</h3>
          <P>
            For full zero-knowledge credential handling, use AgentSecrets alongside openMCP. AgentSecrets
            stores credentials in your OS keychain (never a file), runs as an MCP server, and injects
            credentials at the transport layer so your agent never sees the value.
          </P>
          <CodeBlock code={CODE.agentSecrets} label="AgentSecrets flow" />
          <P>
            Install AgentSecrets:{' '}
            <a href="https://agentsecrets.theseventeen.co" style={{ color: 'var(--accent)' }}>agentsecrets.theseventeen.co</a>
            {' '}— one command sets up both Claude Desktop and Cursor.
          </P>

          <Callout color="var(--bg-1)">
            <p style={{ fontSize: '13px', color: 'var(--text-2)', lineHeight: 1.7 }}>
              <strong>Protecting yourself from sensitive operations:</strong> openMCP's proxy already blocks shell
              injection (18 patterns), credential DLP (11 patterns), and indirect prompt injection (12 patterns)
              on every call. For additional control — limiting which tools an agent can call, blocking specific
              domains, setting per-user rate limits — see the user controls section in your dashboard after
              signing in.
            </p>
          </Callout>
        </Section>

        {/* Native MCP server */}
        <Section id="mcp-server" title="Native MCP server">
          <P>
            openMCP exposes itself as a standard MCP server. Instead of making custom HTTP calls,
            your agent connects once and gets two native MCP tools.
          </P>
          <P>
            <strong>Transports supported:</strong> StreamableHTTP (POST — primary) and SSE (GET — for
            older clients). stdio is not supported — openMCP is a hosted service, not a local process.
          </P>

          <h3 style={{ fontSize: '17px', fontWeight: 600, margin: '24px 0 12px' }}>search_tools</h3>
          <CodeBlock code={CODE.mcpServerSearch} label="Find servers by natural language intent" />

          <h3 style={{ fontSize: '17px', fontWeight: 600, margin: '24px 0 12px' }}>invoke_tool</h3>
          <CodeBlock code={CODE.mcpServerInvoke} label="Invoke any tool through the security proxy" />
          <P>
            Every invoke_tool call runs through the same 15-layer security proxy as the REST API.
            DLP, shell injection detection, PII scan, audit log — all applied.
          </P>
        </Section>

        {/* REST API */}
        <Section id="rest-api" title="REST API reference">
          {[
            { method: 'GET',  path: '/openmcp.md',                       desc: 'Agent skill file — markdown, live stats injected' },
            { method: 'GET',  path: '/api/mcp',                          desc: 'Registry info, security layers, agent prompt template' },
            { method: 'GET',  path: '/api/servers/search?q={intent}',    desc: 'Semantic search — returns servers with full inputSchema' },
            { method: 'GET',  path: '/api/servers?sort=trust&source=official', desc: 'Browse with filters: sort, verified, source, tag, page' },
            { method: 'GET',  path: '/api/servers/:name',                desc: 'Server detail — scan history, CVE issues, tools' },
            { method: 'POST', path: '/api/proxy/:serverName/:toolName',  desc: '15-layer security proxy — DLP, shell inject, audit' },
            { method: 'POST', path: '/api/mcp-server',                   desc: 'Native MCP server (StreamableHTTP) — search_tools + invoke_tool' },
            { method: 'GET',  path: '/api/mcp-server',                   desc: 'Native MCP server (SSE — for older clients)' },
            { method: 'GET',  path: '/api/servers/:name/analytics',      desc: '30-day call volume, latency, DLP events, tool breakdown' },
          ].map(row => (
            <div key={row.path} style={{ display: 'flex', gap: '12px', alignItems: 'baseline', padding: '10px 0', borderBottom: '1px solid var(--border)' }}>
              <span style={{
                fontFamily: 'var(--mono)', fontSize: '11px', fontWeight: 700,
                padding: '2px 8px', borderRadius: '4px', flexShrink: 0,
                background: row.method === 'GET' ? 'var(--blue-bg)' : 'var(--accent-bg)',
                color: row.method === 'GET' ? 'var(--blue)' : 'var(--accent)',
              }}>{row.method}</span>
              <span style={{ fontFamily: 'var(--mono)', fontSize: '13px', color: 'var(--text)', flex: 1 }}>{row.path}</span>
              <span style={{ fontSize: '13px', color: 'var(--text-3)', flex: 1 }}>{row.desc}</span>
            </div>
          ))}

          <h3 style={{ fontSize: '17px', fontWeight: 600, margin: '24px 0 12px' }}>Search example</h3>
          <CodeBlock code={CODE.searchExample} label="GET /api/servers/search?q=send+transactional+email" />

          <h3 style={{ fontSize: '17px', fontWeight: 600, margin: '24px 0 12px' }}>Invoke example</h3>
          <CodeBlock code={CODE.invokeExample} label="POST /api/proxy/sendgrid-mail/send_email" />

          <P>
            Response headers on every proxy call:
          </P>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', marginBottom: '16px' }}>
            {[
              ['X-Registry-Trust-Score', 'Server trust score at call time (0–100)'],
              ['X-Registry-Latency',     'Upstream latency in ms'],
              ['X-Registry-DLP-Warning', 'Present if DLP rules triggered on response'],
            ].map(([header, desc]) => (
              <div key={header} style={{ display: 'flex', gap: '12px', padding: '8px 12px', background: 'var(--bg-1)', borderRadius: '6px', border: '1px solid var(--border)' }}>
                <code style={{ fontFamily: 'var(--mono)', fontSize: '12px', color: 'var(--accent)', flexShrink: 0 }}>{header}</code>
                <span style={{ fontSize: '13px', color: 'var(--text-3)' }}>{desc}</span>
              </div>
            ))}
          </div>
        </Section>

        {/* Trust scores */}
        <Section id="trust-scores" title="Trust scores">
          <P>
            Every server has a trust score from 0–100 that is returned alongside every search result.
            It is a composite of five signals:
          </P>
          {[
            ['Verified publisher (25 pts)', 'Publisher completed GitHub OIDC or DNS challenge to prove identity.'],
            ['Scan history (30 pts)',        'Clean static scan, no shell injection patterns, no CVEs in dependencies.'],
            ['Uptime (20 pts)',              'Measured over the last 30 days by our uptime cron running every 15 minutes.'],
            ['Schema stability (15 pts)',    'Days since last schema change. Servers that frequently mutate their tools score lower.'],
            ['Community signals (10 pts)',   'Star count, call volume, abuse reports.'],
          ].map(([label, desc]) => (
            <div key={label} style={{ display: 'flex', gap: '12px', marginBottom: '10px', padding: '14px', background: 'var(--bg-1)', border: '1px solid var(--border)', borderRadius: '10px' }}>
              <span style={{ fontFamily: 'var(--mono)', fontSize: '12px', color: 'var(--accent)', fontWeight: 700, flexShrink: 0, minWidth: '180px' }}>{label}</span>
              <span style={{ fontSize: '13px', color: 'var(--text-3)', lineHeight: 1.6 }}>{desc}</span>
            </div>
          ))}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: '10px', marginTop: '16px' }}>
            {[
              { range: '90–100', label: 'Verified + stable', bg: 'var(--accent-bg)', color: 'var(--accent)' },
              { range: '80–89',  label: 'Good for production', bg: 'var(--blue-bg)', color: 'var(--blue)' },
              { range: '< 70',   label: 'Use with caution', bg: 'var(--red-bg)', color: 'var(--red)' },
            ].map(s => (
              <div key={s.range} style={{ padding: '14px', background: s.bg, border: `1px solid ${s.color}30`, borderRadius: '8px', textAlign: 'center' }}>
                <div style={{ fontSize: '20px', fontWeight: 800, fontFamily: 'var(--mono)', color: s.color }}>{s.range}</div>
                <div style={{ fontSize: '12px', color: 'var(--text-3)', marginTop: '4px' }}>{s.label}</div>
              </div>
            ))}
          </div>
        </Section>

        {/* Categories */}
        <Section id="categories" title="MCP categories">
          <P>
            openMCP indexes thousands of servers across 12 categories. Servers with HTTP endpoints are invokable through the proxy. stdio-only local servers are browseable but not agent-invokable. About 70% of invokable servers require credentials.
          </P>
          <div className="grid-2" style={{ gap: '10px' }}>
            {CATEGORIES.map(cat => (
              <div key={cat.name} style={{ padding: '14px 16px', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: '10px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
                  <span style={{ fontSize: '14px', fontWeight: 600 }}>{cat.icon} {cat.name}</span>
                  <span style={{ fontSize: '11px', fontFamily: 'var(--mono)', color: 'var(--accent)', background: 'var(--accent-bg)', padding: '2px 8px', borderRadius: '4px' }}>{cat.count}</span>
                </div>
                <div style={{ fontSize: '12px', color: 'var(--text-3)', marginBottom: '6px' }}>{cat.examples}</div>
                <div style={{ fontSize: '11px', color: cat.creds ? 'var(--orange)' : 'var(--blue)' }}>
                  {cat.creds ? '🔑 Credentials required' : '🌐 Public — no credentials'}
                </div>
              </div>
            ))}
          </div>
        </Section>

        {/* FAQ */}
        <Section id="faq" title="FAQ">
          {[
            ['Is openMCP really free?',
             'Yes. The core registry, semantic search, and proxy are free forever. No credit card, no rate limits on core features, no freemium trap. We may introduce optional paid features (publisher analytics, enterprise private registries) in future — but the core stays free.'],
            ['Do I need to register to use it?',
             'No. Search and proxy are open. Registration is only needed to publish your own MCP server or create API keys for higher rate limits.'],
            ['How do credentials work if my MCP needs an API key?',
             'Right now: you pass the required arguments as part of the tool call, same as you would with any API. We recommend using AgentSecrets (agentsecrets.theseventeen.co) for zero-knowledge credential injection — credentials stored in OS keychain, never in any file, never in agent memory.'],
            ['What is the difference between openMCP and Smithery?',
             'Smithery is a developer marketplace for MCP discovery — CLI-first, requires human browser authentication. openMCP is designed for agents to use autonomously at runtime. It also scans every server before listing (Smithery does not), and exposes a native MCP server so agents need zero configuration beyond one URL.'],
            ['Can I use openMCP with Antigravity?',
             'Yes. Antigravity added MCP support in early 2026. Use the standard MCP config: { "mcpServers": { "openmcp": { "url": "https://openmcp.dev/api/mcp-server" } } }'],
            ['How does openMCP compare to Arcade or Composio?',
             'Arcade and Composio are gateway platforms focused on credential management and OAuth. They are strong on auth infrastructure (SOC 2, managed OAuth) but do not scan the servers they connect to. openMCP scans everything — shell injection, prompt injection in descriptions, CVEs, schema drift — but currently relies on users passing credentials normally. The two approaches are complementary.'],
            ['What does the 15-layer security stack actually do?',
             'See the Security section above. Briefly: L1 scans tool descriptions for prompt injection at publish time. L3 hashes all tool schemas and auto-suspends servers that mutate them. L4 blocks credentials in proxy traffic. S-12 blocks OS command injection in tool arguments. S-13 blocks instruction-like language injected into response data. Full details at /api/mcp.'],
          ].map(([q, a]) => (
            <div key={q as string} style={{ marginBottom: '20px', paddingBottom: '20px', borderBottom: '1px solid var(--border)' }}>
              <div style={{ fontSize: '15px', fontWeight: 600, marginBottom: '8px', color: 'var(--text)' }}>{q as string}</div>
              <div style={{ fontSize: '14px', color: 'var(--text-2)', lineHeight: 1.75 }}>{a as string}</div>
            </div>
          ))}
        </Section>

        {/* Known Limitations */}
        <section id="known-limitations" style={{ paddingTop: '48px', paddingBottom: '16px', borderBottom: '1px solid var(--border)' }}>
          <h2 style={{ fontSize: '24px', fontWeight: 700, letterSpacing: '-0.02em', marginBottom: '20px', color: 'var(--text)' }}>
            What's coming
          </h2>
          <p style={{ color: 'var(--text-2)', lineHeight: 1.75, marginBottom: '16px', fontSize: '15px' }}>
            openMCP is in active development. Here is what is shipping next.
          </p>
          {[
            {
              title: 'Per-user OAuth delegation',
              status: 'Coming in v0.3',
              detail: 'For servers requiring per-user OAuth (GitHub, Gmail, Slack, Stripe connected to your account), the proxy will orchestrate the OAuth consent flow and store your token encrypted in the vault. The static key vault works for API-key-based servers today.',
            },
            {
              title: 'WASM sandbox pre-listing execution',
              status: 'Coming in v0.3',
              detail: 'Sandboxed execution before listing will catch runtime-only payloads and deferred attacks that static analysis misses. Current security coverage is ~70% OWASP MCP Top 10 across 13 live layers. The sandbox brings this to ~85%.',
            },
          ].map(item => (
            <div key={item.title} style={{ marginBottom: '16px', padding: '16px 18px', background: 'var(--bg-1)', border: '1px solid var(--border)', borderRadius: '10px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '6px' }}>
                <div style={{ fontSize: '14px', fontWeight: 600, color: 'var(--text)' }}>{item.title}</div>
                <span style={{ fontSize: '11px', fontFamily: 'var(--mono)', color: 'var(--accent)', background: 'var(--accent-bg)', padding: '2px 8px', borderRadius: '4px', flexShrink: 0, marginLeft: '12px' }}>{item.status}</span>
              </div>
              <div style={{ fontSize: '13px', color: 'var(--text-2)', lineHeight: 1.7 }}>{item.detail}</div>
            </div>
          ))}
        </section>

        <div style={{ paddingTop: '40px', display: 'flex', gap: '12px' }}>
          <Link href="/connect" className="btn btn-primary">Connect your agent</Link>
          <Link href="/registry" className="btn btn-ghost">Browse registry</Link>
          <a href="https://github.com/the-17/openmcp" target="_blank" rel="noopener" className="btn btn-ghost">GitHub</a>
        </div>
      </main>
    </div>
  );
}
