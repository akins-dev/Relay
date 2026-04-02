'use client';
import { useState } from 'react';
import Link from 'next/link';
import { cn } from '@/lib/cn';
const SECTIONS = [
  { id: 'what-is-agentrail', label: 'What is Agentrail?' },
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
  systemPrompt: `You have access to Agentrail — a trust layer for remote MCP servers.
Read https://openmcp.dev/openmcp.md before your first tool call.

Search:  GET https://openmcp.dev/api/servers/search?q={intent}
Invoke:  POST https://openmcp.dev/api/proxy/{serverName}/{toolName}`,

  mcpConfig: `{
  "mcpServers": {
    "agentrail": {
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
# Store once in Agentrail Vault at openmcp.dev/dashboard/secrets

# 2. Agent calls Agentrail proxy
# 3. Proxy resolves key from Agentrail Vault
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

// Agentrail returns results with full inputSchema`,

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
    <div className="codeblock mb-4 h-full">
      {label && (
        <div className="codeblock-header flex justify-between !bg-black !border-b-[rgba(255,255,255,0.1)]">
          <span className="font-mono text-[11px] text-[#a1a1aa]">{label}</span>
          <button
            onClick={() => { navigator.clipboard.writeText(code); setCopied(true); setTimeout(() => setCopied(false), 2000); }}
            className="text-[11px] text-[#a1a1aa] hover:text-white transition-colors"
          >{copied ? '✓ Copied' : 'Copy'}</button>
        </div>
      )}
      <pre className="!bg-[#0a0a0a] !text-[#ededed]">{code}</pre>
    </div>
  );
}

function Section({ id, title, children }: { id: string; title: string; children: React.ReactNode }) {
  return (
    <section id={id} className="border-b border-[rgba(0,0,0,0.06)] py-12">
      <h2 className="mb-5 font-display text-[24px] font-medium tracking-tight text-[#0a0a0a]">
        {title}
      </h2>
      {children}
    </section>
  );
}

const P = ({ children }: { children: React.ReactNode }) => (
  <p className="mb-4 text-[15px] leading-relaxed text-[#52525b]">{children}</p>
);

const Callout = ({ children, color = 'bg-[#fafafa]', border = 'border-[rgba(0,0,0,0.08)]' }: any) => (
  <div className={cn("mb-5 rounded-[12px] border p-4 sm:p-5", color, border)}>
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
  const [active, setActive] = useState('what-is-agentrail');

  return (
    <div className="mx-auto flex w-full max-w-[1200px] flex-col gap-10 p-6 sm:p-10 lg:flex-row lg:items-start lg:gap-16 lg:py-16">

      {/* Sidebar */}
      <aside className="sticky top-24 hidden w-[220px] shrink-0 lg:block">
        <div className="mb-3 font-mono text-[11px] font-bold uppercase tracking-[0.1em] text-[#a1a1aa]">
          Documentation
        </div>
        <nav className="flex flex-col gap-1.5">
          {SECTIONS.map(s => (
            <a
              key={s.id}
              href={`#${s.id}`}
              onClick={() => setActive(s.id)}
              className={cn(
                "rounded-lg px-3 py-2 text-[14px] transition-all",
                active === s.id
                  ? "bg-black font-medium text-white shadow-sm"
                  : "font-medium text-[#52525b] hover:bg-neutral-100 hover:text-black"
              )}
            >{s.label}</a>
          ))}
        </nav>
      </aside>

      {/* Content */}
      <main className="min-w-0 flex-1">
        <div className="mb-12">
          <div className="section-label text-[#a1a1aa] mb-4">docs</div>
          <h1 className="heading-display mb-3 text-[2.25rem] font-medium tracking-tight text-[#0a0a0a] sm:text-[2.75rem]">
            Agentrail Documentation
          </h1>
          <p className="max-w-3xl text-[17px] leading-relaxed text-[#52525b]">
            Everything you need to connect your AI agents to network-reachable MCP servers today, with local CLI support planned next.
          </p>
        </div>

        {/* What is Agentrail */}
        <Section id="what-is-agentrail" title="What is Agentrail?">
          <P>
            Agentrail is the missing layer between AI agents and remote MCP servers. Today, every agent must have
            MCP servers explicitly configured before deployment. There is no way for an agent to discover
            what tools exist, evaluate their quality, or connect to them autonomously.
          </P>
          <P>
            Agentrail solves this with a single endpoint. Your agent queries it by describing what it needs,
            gets back verified servers with full tool schemas, and invokes tools through a security proxy —
            at runtime by intent — never pre-loaded, never eating your context window.
          </P>
          <P>
            Today, Agentrail focuses on network-reachable MCP servers with HTTP transports. Local
            <code className="mx-1 rounded-md border border-[rgba(0,0,0,0.08)] bg-[#fafafa] px-1.5 py-0.5 font-mono text-[13px] text-black">stdio</code>
            support is planned for Agentrail CLI.
          </P>
          <Callout>
            <p className="font-serif text-[15px] italic leading-relaxed text-[#0a0a0a]">
              "Agent development will never scale treating every tool integration as a 1:1 integration."
            </p>
          </Callout>
          <P>
            <strong>Free to use.</strong> The core registry, semantic search, and proxy are available
            without a paid plan. No credit card. Transparent limits. No lock-in.
          </P>
          <P>
            <strong>Open source.</strong> MIT licensed. Full source at{' '}
            <a href="https://github.com/the-17/openmcp" className="text-black underline underline-offset-2">github.com/the-17/openmcp</a>.
            The security claims are verifiable, not a promise.
          </P>
        </Section>

        {/* How it works */}
        <Section id="how-it-works" title="How it works">
          <P>Every agent interaction follows this flow:</P>
          {[
            ['1', 'Agent has a task', 'Needs to send an email, create a PR, charge a card — any capability.'],
            ['2', 'Queries Agentrail by intent', 'GET /api/servers/search?q=send transactional email — returns verified servers with full inputSchema per tool.'],
            ['3', 'Reads the inputSchema', 'No guessing. The agent knows exactly what arguments each tool requires before calling.'],
            ['4', 'Invokes through the proxy', 'POST /api/proxy/sendgrid-mail/send_email — every call blocks sensitive request patterns, applies policy, scans responses, and writes an audit trail.'],
            ['5', 'Gets a response', 'The upstream result is returned with trust and warning metadata. If response scans trigger, the agent gets the result plus warning headers for review.'],
          ].map(([num, title, desc]) => (
            <div key={num} className="mb-3 flex gap-4 rounded-[12px] border border-[rgba(0,0,0,0.06)] bg-white p-4 shadow-sm">
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-black font-mono text-[11px] font-bold text-white">{num}</span>
              <div>
                <div className="mb-1 text-[14px] font-semibold text-[#0a0a0a]">{title}</div>
                <div className="text-[13px] leading-relaxed text-[#52525b]">{desc}</div>
              </div>
            </div>
          ))}

          <h3 className="mt-8 mb-3 font-display text-[17px] font-semibold text-[#0a0a0a]">Security on every server and every call</h3>
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
          <h3 className="mb-3 font-display text-[17px] font-semibold text-[#0a0a0a]">Option 1 — System prompt (works everywhere)</h3>
          <CodeBlock code={CODE.systemPrompt} label="Add to your system prompt or AGENTS.md" />

          <h3 className="mt-8 mb-3 font-display text-[17px] font-semibold text-[#0a0a0a]">Option 2 — Native MCP server (Claude Desktop, Cursor, Antigravity, etc.)</h3>
          <CodeBlock code={CODE.mcpConfig} label="claude_desktop_config.json / .cursor/mcp.json / mcp_config.json" />
          <P>Restart your IDE. Your agent now has two tools: <code className="mx-1 rounded-md border border-[rgba(0,0,0,0.08)] bg-[#fafafa] px-1.5 py-0.5 font-mono text-[13px] text-black">search_tools</code> and <code className="mx-1 rounded-md border border-[rgba(0,0,0,0.08)] bg-[#fafafa] px-1.5 py-0.5 font-mono text-[13px] text-black">invoke_tool</code>.</P>

          <h3 className="mt-8 mb-3 font-display text-[17px] font-semibold text-[#0a0a0a]">Option 3 — Fetch the agent skill file</h3>
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

          <h3 className="mt-8 mb-3 font-display text-[17px] font-semibold text-[#0a0a0a]">The credential problem</h3>
          <P>
            Every MCP tutorial tells you to paste API keys into a config file. Those files get committed
            to git, read by AI assistants, and exfiltrated via prompt injection. Check Point documented
            CVE-2026-21852 — a vulnerability that harvests credentials directly from MCP config files.
          </P>

          <h3 className="mt-8 mb-3 font-display text-[17px] font-semibold text-[#0a0a0a]">What Agentrail does about it</h3>
          <P>
            The Agentrail proxy runs DLP on every request and response — 11 credential patterns. If a
            credential pattern appears in a tool argument (the agent accidentally including an API key),
            the call is blocked before it reaches the upstream server. If a credential appears in a
            response, it is flagged in warning headers and audit logs for review.
          </P>

          <h3 className="mt-8 mb-3 font-display text-[17px] font-semibold text-[#0a0a0a]">Agentrail Vault — the complete solution</h3>
          <P>
            Store credentials once in the Agentrail Vault. They are encrypted with AES-256-GCM via Supabase
            pgsodium. The proxy decrypts at call time and injects as an Authorization header. The raw
            value is never stored in plaintext, never returned through the API, and never visible after
            you save it — only the secret name is shown.
          </P>
          <CodeBlock code={CODE.agentSecrets} label="Agentrail Vault flow" />
          <P>
            Manage secrets:{' '}
            <a href="https://openmcp.dev/dashboard/secrets" className="text-black underline underline-offset-2">openmcp.dev/dashboard/secrets</a>
            {' '}— store once, then let the proxy inject automatically.
          </P>

          <Callout color="bg-[#fafafa]" border="border-[rgba(0,0,0,0.08)]">
            <p className="text-[14px] leading-relaxed text-[#52525b]">
              <strong>Protecting yourself from sensitive operations:</strong> Agentrail's proxy already blocks shell
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
            Agentrail exposes itself as a standard MCP server. Instead of making custom HTTP calls,
            your agent connects once and gets two native MCP tools.
          </P>
          <P>
            <strong>Transports supported:</strong> StreamableHTTP (POST — primary) and SSE (GET — for
            older clients). stdio is not supported yet — Agentrail is a hosted service today, with a CLI bridge planned next.
          </P>

          <h3 className="mt-8 mb-3 font-display text-[17px] font-semibold text-[#0a0a0a]">search_tools</h3>
          <CodeBlock code={CODE.mcpServerSearch} label="Find servers by natural language intent" />

          <h3 className="mt-8 mb-3 font-display text-[17px] font-semibold text-[#0a0a0a]">invoke_tool</h3>
          <CodeBlock code={CODE.mcpServerInvoke} label="Invoke any tool through the security proxy" />
          <P>
            Every invoke_tool call runs through the same remote trust and proxy layer as the REST API.
            Request blocking, response scanning, trust metadata, and audit logging are all applied.
          </P>
        </Section>

        {/* REST API */}
        <Section id="rest-api" title="REST API reference">
          <div className="mb-8 overflow-hidden rounded-[12px] border border-[rgba(0,0,0,0.06)] bg-white shadow-sm">
            {[
              { method: 'GET',  path: '/openmcp.md',                       desc: 'Agent skill file — markdown, live stats injected' },
              { method: 'GET',  path: '/api/mcp',                          desc: 'Registry info, security layers, agent prompt template' },
              { method: 'GET',  path: '/api/servers/search?q={intent}',    desc: 'Semantic search — returns servers with full inputSchema' },
              { method: 'GET',  path: '/api/servers?sort=trust&source=official', desc: 'Browse with filters: sort, verified, source, tag, page' },
              { method: 'GET',  path: '/api/servers/:name',                desc: 'Server detail — scan history, CVE issues, tools' },
              { method: 'POST', path: '/api/proxy/:serverName/:toolName',  desc: 'Remote invocation proxy — request blocking, response scanning, audit' },
              { method: 'POST', path: '/api/mcp-server',                   desc: 'Native MCP server (StreamableHTTP) — search_tools + invoke_tool' },
              { method: 'GET',  path: '/api/mcp-server',                   desc: 'Native MCP server (SSE — for older clients)' },
              { method: 'GET',  path: '/api/servers/:name/analytics',      desc: '30-day call volume, latency, DLP events, tool breakdown' },
            ].map((row, i) => (
              <div key={row.path} className={cn("flex flex-col gap-2 p-3 sm:flex-row sm:items-center sm:gap-4", i > 0 && "border-t border-[rgba(0,0,0,0.04)]")}>
                <span className={cn(
                  "inline-flex shrink-0 items-center rounded pl-[6px] pr-[6px] py-[2px] font-mono text-[11px] font-bold uppercase tracking-wider",
                  row.method === 'GET' ? 'bg-blue-50 text-blue-600' : 'bg-green-50 text-green-700'
                )}>{row.method}</span>
                <span className="flex-1 font-mono text-[13px] text-black">{row.path}</span>
                <span className="flex-1 text-[13px] text-[#52525b]">{row.desc}</span>
              </div>
            ))}
          </div>

          <h3 className="mb-3 font-display text-[17px] font-semibold text-[#0a0a0a]">Search example</h3>
          <CodeBlock code={CODE.searchExample} label="GET /api/servers/search?q=send+transactional+email" />

          <h3 className="mt-8 mb-3 font-display text-[17px] font-semibold text-[#0a0a0a]">Invoke example</h3>
          <CodeBlock code={CODE.invokeExample} label="POST /api/proxy/sendgrid-mail/send_email" />

          <P>
            Response headers on every proxy call:
          </P>
          <div className="mb-6 flex flex-col gap-2">
            {[
              ['X-Registry-Trust-Score', 'Server trust score at call time (0–100)'],
              ['X-Registry-Latency',     'Upstream latency in ms'],
              ['X-Registry-DLP-Warning', 'Present if DLP rules triggered on response'],
            ].map(([header, desc]) => (
              <div key={header} className="flex gap-4 rounded-[10px] border border-[rgba(0,0,0,0.06)] bg-[#fafafa] p-3 shadow-sm">
                <code className="shrink-0 font-mono text-[12px] font-medium text-black">{header}</code>
                <span className="text-[13px] text-[#52525b]">{desc}</span>
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
          <div className="mb-6 flex flex-col gap-2">
            {[
              ['Verified publisher (25 pts)', 'Publisher completed GitHub OIDC or DNS challenge to prove identity.'],
              ['Scan history (30 pts)',        'Clean static scan, no shell injection patterns, no CVEs in dependencies.'],
              ['Uptime (20 pts)',              'Measured over the last 30 days by our uptime cron running every 15 minutes.'],
              ['Schema stability (15 pts)',    'Days since last schema change. Servers that frequently mutate their tools score lower.'],
              ['Community signals (10 pts)',   'Star count, call volume, abuse reports.'],
            ].map(([label, desc]) => (
              <div key={label} className="flex flex-col gap-1 rounded-[10px] border border-[rgba(0,0,0,0.06)] bg-[#fafafa] p-4 shadow-sm sm:flex-row sm:gap-4 sm:items-center">
                <span className="shrink-0 font-display text-[14px] font-semibold text-black sm:min-w-[190px]">{label}</span>
                <span className="text-[13px] leading-relaxed text-[#52525b]">{desc}</span>
              </div>
            ))}
          </div>
          
          <div className="grid gap-3 sm:grid-cols-3">
            {[
              { range: '90–100', label: 'Verified + stable', bg: 'bg-green-50', color: 'text-green-700', border: 'border-green-200' },
              { range: '80–89',  label: 'Good for production', bg: 'bg-blue-50', color: 'text-blue-700', border: 'border-blue-200' },
              { range: '< 70',   label: 'Use with caution', bg: 'bg-red-50', color: 'text-red-700', border: 'border-red-200' },
            ].map(s => (
              <div key={s.range} className={cn("rounded-[12px] border p-4 text-center", s.bg, s.border)}>
                <div className={cn("font-mono text-[22px] font-bold", s.color)}>{s.range}</div>
                <div className="mt-1 text-[12px] font-medium opacity-80 mix-blend-multiply">{s.label}</div>
              </div>
            ))}
          </div>
        </Section>

        {/* Categories */}
        <Section id="categories" title="MCP categories">
          <P>
            Agentrail indexes thousands of servers across 12 categories. Today it focuses on servers with HTTP endpoints that can be invoked through the proxy. Local stdio support is planned for Agentrail CLI. About 70% of invokable servers require credentials.
          </P>
          <div className="grid gap-3 sm:grid-cols-2">
            {CATEGORIES.map(cat => (
              <div key={cat.name} className="rounded-[12px] border border-[rgba(0,0,0,0.06)] bg-white p-4 shadow-sm hover:shadow-md transition-shadow">
                <div className="mb-2 flex items-center justify-between">
                  <span className="font-display text-[15px] font-medium text-black"><span className="mr-2">{cat.icon}</span>{cat.name}</span>
                  <span className="rounded bg-black px-2 py-0.5 font-mono text-[10px] font-bold text-white tracking-widest">{cat.count}</span>
                </div>
                <div className="mb-3 text-[12px] text-[#52525b] line-clamp-1" title={cat.examples}>{cat.examples}</div>
                <div className={cn("text-[11px] font-medium", cat.creds ? 'text-orange-600' : 'text-blue-600')}>
                  {cat.creds ? '🔑 Credentials required' : '🌐 Public — no credentials'}
                </div>
              </div>
            ))}
          </div>
        </Section>

        {/* FAQ */}
        <Section id="faq" title="FAQ">
          <div className="flex flex-col gap-6">
            {[
              ['Is Agentrail really free?',
               'Yes. The core registry, semantic search, and proxy are available without a paid plan. No credit card, no freemium trap, and transparent limits. We may introduce optional paid features (publisher analytics, enterprise private registries) in future — but the core product remains accessible.'],
              ['Do I need to register to use it?',
               'No. Search and proxy are open. Registration is only needed to publish your own MCP server or create API keys for higher rate limits.'],
              ['How do credentials work if my MCP needs an API key?',
               'API keys are stored in the Agentrail Vault (AES-256-GCM encrypted). When you call a tool through the proxy, the key is decrypted and injected as an Authorization header. The raw key never appears in tool arguments, agent context, or request logs. If a server needs a key you have not stored yet, the proxy returns a 401 with the exact variable name to use and a link to the dashboard.'],
              ['What is the difference between Agentrail and Smithery?',
               'Smithery is a developer marketplace for MCP discovery — CLI-first, requires human browser authentication. Agentrail is designed for agents to use autonomously at runtime. It also scans every server before listing and exposes a native MCP server so agents need zero configuration beyond one URL.'],
              ['Can I use Agentrail with Antigravity?',
               'Yes. Antigravity added MCP support in early 2026. Use the standard MCP config: { "mcpServers": { "agentrail": { "url": "https://openmcp.dev/api/mcp-server" } } }'],
              ['How does Agentrail compare to Arcade or Composio?',
               'Arcade and Composio are gateway platforms focused on credential management and OAuth. They are strong on auth infrastructure, while Agentrail focuses on discovery, trust, and secure invocation of remote MCP servers. Agentrail scans and scores the servers it lists, injects stored credentials through its vault and proxy, and plans to use AgentSecrets as the credential substrate for the future CLI/local bridge.'],
              ['Does Agentrail support stdio or local MCP servers today?',
               'Not yet. The current product is remote-first and focuses on network-reachable MCP servers with HTTP transports. Agentrail CLI is the planned bridge for local stdio servers, with AgentSecrets handling credentials outside agent context.'],
              ['What does the 15-layer security stack actually do?',
               'See the Security section above. Briefly: L1 scans tool descriptions for prompt injection at publish time. L3 hashes all tool schemas and auto-suspends servers that mutate them. L4 blocks credentials in requests and surfaces response warnings. S-12 blocks OS command injection in tool arguments. S-13 scans for instruction-like language in response data. Full details at /api/mcp.'],
            ].map(([q, a], i) => (
              <div key={q as string} className={cn("pb-6", i !== 7 && "border-b border-[rgba(0,0,0,0.06)]")}>
                <div className="mb-2 font-display text-[15px] font-semibold text-[#0a0a0a]">{q as string}</div>
                <div className="text-[14px] leading-relaxed text-[#52525b]">{a as string}</div>
              </div>
            ))}
          </div>
        </Section>

        {/* Known Limitations */}
        <section id="known-limitations" className="py-12">
          <h2 className="mb-5 font-display text-[24px] font-medium tracking-tight text-[#0a0a0a]">
            What's coming
          </h2>
          <P>
            Agentrail is in active development. Here is what is shipping next.
          </P>
          <div className="flex flex-col gap-4">
            {[
              {
                title: 'Agentrail CLI for local stdio servers',
                status: 'Next launch wave',
                detail: 'A local bridge that uses the same discovery layer for stdio MCP servers. It will resolve candidates from Agentrail, run local MCP servers when needed, and use AgentSecrets for credential injection outside agent context.',
              },
              {
                title: 'Per-user OAuth delegation',
                status: 'Coming in v0.3',
                detail: 'Expand OAuth coverage and auto-discovery for servers requiring per-user accounts (GitHub, Gmail, Slack, Stripe connected to your account). The static key vault works for API-key-based servers today.',
              },
              {
                title: 'WASM sandbox pre-listing execution',
                status: 'Coming in v0.3',
                detail: 'Sandboxed execution before listing will catch runtime-only payloads and deferred attacks that static analysis misses. Current security coverage is ~70% OWASP MCP Top 10 across 13 live layers. The sandbox brings this to ~85%.',
              },
            ].map(item => (
              <div key={item.title} className="rounded-[12px] border border-[rgba(0,0,0,0.06)] bg-white p-5 shadow-sm transition-shadow hover:shadow-md">
                <div className="mb-2 flex items-start justify-between">
                  <div className="font-display text-[15px] font-semibold text-[#0a0a0a]">{item.title}</div>
                  <span className="ml-3 shrink-0 rounded bg-neutral-100 px-2 py-0.5 font-mono text-[11px] font-bold text-[#52525b]">{item.status}</span>
                </div>
                <div className="text-[13px] leading-relaxed text-[#52525b]">{item.detail}</div>
              </div>
            ))}
          </div>
        </section>

        <div className="mt-8 flex flex-wrap gap-3">
          <Link href="/connect" className="btn btn-primary px-6">Connect your agent</Link>
          <Link href="/registry" className="btn btn-ghost px-6 !bg-white">Browse registry</Link>
          <a href="https://github.com/the-17/openmcp" target="_blank" rel="noopener" className="btn btn-ghost px-6 !bg-white">GitHub</a>
        </div>
      </main>
    </div>
  );
}
