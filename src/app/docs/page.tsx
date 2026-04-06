'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import Link from 'next/link';
import { Search, X, ChevronUp, Menu } from 'lucide-react';
import { cn } from '@/lib/cn';
import { SITE_URL } from '@/lib/site';
import { BRAND } from '@/lib/brand';

// ─── Section data ──────────────────────────────────────────────────────────────

const SECTIONS = [
  { id: `what-is-${BRAND.name}`, label: `What is ${BRAND.name}?` },
  { id: 'how-it-works',      label: 'How it works' },
  { id: 'quickstart',        label: 'Quickstart' },
  { id: 'credentials',       label: 'Credentials & security' },
  { id: 'mcp-server',        label: 'Native MCP server' },
  { id: 'rest-api',          label: 'REST API reference' },
  { id: 'trust-scores',      label: 'Trust scores' },
  { id: 'categories',        label: 'MCP categories' },
  { id: 'faq',               label: 'FAQ' },
  { id: 'known-limitations', label: "What's coming" },
];

// ─── Code snippets ────────────────────────────────────────────────────────────

const CODE = {
  systemPrompt: `You have access to ${BRAND.name} — a trust layer for remote MCP servers.
Read ${SITE_URL}${BRAND.agentMdRoute} before your first tool call.

Search:  GET ${SITE_URL}/api/servers/search?q={intent}
Invoke:  POST ${SITE_URL}/api/proxy/{serverName}/{toolName}`,

  mcpConfig: `{
  "mcpServers": {
    "${BRAND.name}": {
      "url": "${SITE_URL}/api/mcp-server"
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
# Store once in ${BRAND.name} Vault at ${SITE_URL}/dashboard/secrets

# 2. Agent calls ${BRAND.name} proxy
# 3. Proxy resolves key from ${BRAND.name} Vault
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

// ${BRAND.name} returns results with full inputSchema`,

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

// ─── Searchable content index ─────────────────────────────────────────────────

const SEARCH_INDEX = [
  { section: `what-is-${BRAND.name}`, label: `What is ${BRAND.name}?`, text: `${BRAND.name} missing layer ai agents remote mcp servers configure deployment discover tools quality connect autonomously single endpoint queries verified servers full tool schemas invokes tools security proxy runtime intent context window network http transports stdio cli free open source mit license` },
  { section: 'how-it-works',      label: 'How it works',       text: `${BRAND.name} agent task send email create pr charge card capability queries ${BRAND.name} intent search servers inputSchema arguments invokes proxy blocks sensitive policy scans responses audit trail security layers static injection npm cve scanning schema pinning typosquatting detection dlp shell injection pii scanning url owasp` },
  { section: 'quickstart',        label: 'Quickstart',         text: 'quickstart system prompt agents.md add native mcp server claude desktop cursor antigravity config json restart ide search_tools invoke_tool skill file curl openmcp.md live stats teaches agent trust scores how to search read inputschemasad' },
  { section: 'credentials',       label: 'Credentials & security', text: 'credentials security api key oauth token weather wikipedia exchange rates free stripe github gmail require credential problem config file git committed ai assistants exfiltrated prompt injection cve-2026-21852 harvest ${BRAND.name} proxy dlp request response blocked aes-256-gcm vault encrypted plaintext secret name authorization header' },
  { section: 'mcp-server',        label: 'Native MCP server',  text: 'native mcp server standard mcp server connect one hosted mcp connection two tools search_tools invoke_tool transports streamablehttp post primary sse get older clients stdio not supported hosted service cli bridge planned' },
  { section: 'rest-api',          label: 'REST API reference',  text: 'rest api reference get openmcp.md skill file markdown live stats servers search semantic intent inputSchema browse filters sort verified source tag page server detail scan history cve issues tools post proxy serverName toolName invocation security audit mcp-server streamablehttp sse analytics latency dlp events' },
  { section: 'trust-scores',      label: 'Trust scores',        text: 'trust scores 0 100 composite five signals verified publisher github oidc dns challenge prove identity scan history static scan no shell injection no cves npm uptime 30 days cron 15 minutes schema stability days since last change frequently mutate lower community signals star count call volume abuse reports 90 100 verified stable 80 89 good production less than 70 use with caution' },
  { section: 'categories',        label: 'MCP categories',      text: 'mcp categories developer tools github gitlab jira linear sentry vercel databases postgresql mysql mongodb supabase redis payments stripe paypal paddle lemon squeezy communication slack discord gmail outlook telegram ai ml openai replicate huggingface elevenlabs cloud infra aws gcp cloudflare fly.io crm salesforce hubspot notion airtable public data weather exchange rates wikipedia news search brave tavily exa perplexity design figma canva adobe file storage google drive dropbox s3 analytics posthog mixpanel segment ga credentials required public' },
  { section: 'faq',               label: 'FAQ',                  text: 'faq frequently asked questions free no credit card freemium transparent limits publisher analytics enterprise private registries register search proxy publish mcp server api keys rate limits credentials api key vault aes-256-gcm proxy inject authorization header 401 variable name dashboard smithery arcade composio gateway oauth credential management discovery trust secure invocation scans scores agentsecrets cli local bridge stdio not yet network reachable http transports 15-layer security stack l1 prompt injection l3 hash tool schemas l4 credentials requests s-12 os command injection s-13 instruction-like language response owasp' },
  { section: 'known-limitations', label: "What's coming",       text: `what's coming ${BRAND.name} cli local stdio servers next launch wave discovery layer run local mcp servers agentsecrets credential injection per-user oauth delegation v0.3 github gmail slack stripe connected account static key vault api-key wasm sandbox pre-listing execution v0.3 sandboxed execution runtime-only payloads deferred attacks static analysis misses owasp mcp top 10 13 live layers 85%` },
];

// ─── Sub-components ───────────────────────────────────────────────────────────

function CodeBlock({ code, label }: { code: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="codeblock mb-4">
      {label && (
        <div className="codeblock-header flex justify-between">
          <span className="font-mono text-[11px] text-brand-steel">{label}</span>
          <button
            onClick={() => { navigator.clipboard.writeText(code); setCopied(true); setTimeout(() => setCopied(false), 2000); }}
            className="text-[11px] text-brand-steel hover:text-white transition-colors"
          >
            {copied ? '✓ Copied' : 'Copy'}
          </button>
        </div>
      )}
      <pre className="text-[13px] leading-7">{code}</pre>
    </div>
  );
}

function Section({ id, title, children }: { id: string; title: string; children: React.ReactNode }) {
  return (
    <section id={id} className="border-b border-white/5 py-12 scroll-mt-24">
      <h2 className="mb-6 font-display text-[1.6rem] sm:text-[2rem] font-medium tracking-tight text-white">
        {title}
      </h2>
      {children}
    </section>
  );
}

const P = ({ children }: { children: React.ReactNode }) => (
  <p className="mb-4 text-[15px] leading-relaxed text-brand-steel">{children}</p>
);

const H3 = ({ children }: { children: React.ReactNode }) => (
  <h3 className="mt-8 mb-3 font-display text-[17px] font-semibold text-white">{children}</h3>
);

const Callout = ({ children }: { children: React.ReactNode }) => (
  <div className="mb-5 rounded-xl border border-white/8 bg-white/[0.03] p-4 sm:p-5">
    {children}
  </div>
);

const InlineCode = ({ children }: { children: React.ReactNode }) => (
  <code className="mx-1 rounded border border-white/10 bg-white/5 px-1.5 py-0.5 font-mono text-[13px] text-white">
    {children}
  </code>
);

// ─── Categories data ──────────────────────────────────────────────────────────

const CATEGORIES = [
  { icon: '🔧', name: 'Developer tools',    count: '1,200+', examples: 'GitHub, GitLab, Jira, Linear, Sentry, Vercel',  creds: true  },
  { icon: '🗄️', name: 'Databases',          count: '800+',   examples: 'PostgreSQL, MySQL, MongoDB, Supabase, Redis',   creds: true  },
  { icon: '💳', name: 'Payments',           count: '150+',   examples: 'Stripe, PayPal, Paddle, Lemon Squeezy',         creds: true  },
  { icon: '📧', name: 'Communication',      count: '400+',   examples: 'Slack, Discord, Gmail, Outlook, Telegram',      creds: true  },
  { icon: '🤖', name: 'AI & ML',            count: '500+',   examples: 'OpenAI, Replicate, HuggingFace, ElevenLabs',    creds: true  },
  { icon: '☁️', name: 'Cloud infra',        count: '300+',   examples: 'AWS, GCP, Cloudflare, Vercel, Fly.io',          creds: true  },
  { icon: '📊', name: 'CRM & productivity', count: '600+',   examples: 'Salesforce, HubSpot, Notion, Airtable',         creds: true  },
  { icon: '🌐', name: 'Public data',        count: '200+',   examples: 'Weather, exchange rates, Wikipedia, news',      creds: false },
  { icon: '🔍', name: 'Search',             count: '50+',    examples: 'Brave, Tavily, Exa, Perplexity',                creds: true  },
  { icon: '🎨', name: 'Design',             count: '100+',   examples: 'Figma, Canva, Adobe',                           creds: true  },
  { icon: '📁', name: 'File & storage',     count: '150+',   examples: 'Google Drive, Dropbox, S3, local filesystem',   creds: true  },
  { icon: '📈', name: 'Analytics',          count: '100+',   examples: 'PostHog, Mixpanel, Segment, GA',                creds: true  },
];

// ─── Main page ────────────────────────────────────────────────────────────────

export default function DocsPage() {
  const [active, setActive] = useState(`what-is-${BRAND.name}`);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<typeof SEARCH_INDEX>([]);
  const [mobileOpen, setMobileOpen] = useState(false);
  const observerRef = useRef<IntersectionObserver | null>(null);

  // ── Scroll-spy: update active section as user scrolls ─────────────────────
  useEffect(() => {
    const targets = SECTIONS.map(s => document.getElementById(s.id)).filter(Boolean) as HTMLElement[];

    observerRef.current = new IntersectionObserver(
      (entries) => {
        // Find the topmost visible section
        const visible = entries
          .filter(e => e.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        if (visible.length > 0) {
          setActive(visible[0].target.id);
        }
      },
      { rootMargin: '-80px 0px -60% 0px', threshold: 0 }
    );

    targets.forEach(t => observerRef.current?.observe(t));
    return () => observerRef.current?.disconnect();
  }, []);

  // ── Deep search ───────────────────────────────────────────────────────────
  useEffect(() => {
    if (!query.trim()) { setResults([]); return; }
    const words = query.toLowerCase().split(/\s+/).filter(Boolean);
    const scored = SEARCH_INDEX.map(entry => {
      const haystack = (entry.label + ' ' + entry.text).toLowerCase();
      const score = words.reduce((acc, w) => {
        const inLabel = entry.label.toLowerCase().includes(w) ? 4 : 0;
        const count   = (haystack.match(new RegExp(w, 'g')) || []).length;
        return acc + inLabel + count;
      }, 0);
      return { ...entry, score };
    }).filter(e => e.score > 0).sort((a, b) => b.score - a.score);
    setResults(scored);
  }, [query]);

  function navigate(id: string) {
    const el = document.getElementById(id);
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    setActive(id);
    setQuery('');
    setResults([]);
    setMobileOpen(false);
  }

  // ── Sidebar nav items ─────────────────────────────────────────────────────

  const NavItems = () => (
    <nav className="flex flex-col gap-0.5">
      {SECTIONS.map(s => (
        <button
          key={s.id}
          onClick={() => navigate(s.id)}
          className={cn(
            'rounded-lg px-3 py-2 text-left text-[13px] transition-all duration-150',
            active === s.id
              ? 'bg-white/10 text-white font-medium border-l-2 border-brand-signal pl-[10px]'
              : 'text-brand-steel hover:bg-white/5 hover:text-white border-l-2 border-transparent pl-[10px]'
          )}
        >
          {s.label}
        </button>
      ))}
    </nav>
  );

  return (
    <div className="pb-32 lg:pb-24">
      <div className="mx-auto flex w-full max-w-[1240px] flex-col lg:flex-row lg:items-start lg:gap-16 px-4 sm:px-8 lg:px-10 lg:py-16">

        {/* ── Desktop Sidebar ── */}
        <aside className="sticky top-20 hidden w-[220px] shrink-0 lg:block">
          <div className="mb-4 font-mono text-[10px] font-bold uppercase tracking-[0.18em] text-brand-steel">
            Documentation
          </div>

          {/* Sidebar search */}
          <div className="relative mb-4">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-brand-steel pointer-events-none" />
            <input
              className="input !py-2 !pl-8 !pr-8 text-[13px]"
              placeholder="Search docs…"
              value={query}
              onChange={e => setQuery(e.target.value)}
            />
            {query && (
              <button onClick={() => { setQuery(''); setResults([]); }} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-brand-steel hover:text-white">
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>

          {/* Search results */}
          {results.length > 0 ? (
            <div className="flex flex-col gap-0.5 mb-4">
              {results.map(r => (
                <button
                  key={r.section}
                  onClick={() => navigate(r.section)}
                  className="rounded-lg px-3 py-2 text-left text-[13px] text-brand-signal hover:bg-white/5 border-l-2 border-brand-signal pl-[10px] transition-colors"
                >
                  {r.label}
                </button>
              ))}
            </div>
          ) : query && (
            <p className="text-[12px] text-brand-steel mb-4 px-1">No results found.</p>
          )}

          <NavItems />
        </aside>

        {/* ── Main Content ── */}
        <main className="min-w-0 flex-1 pt-10 lg:pt-0">
          {/* Page header */}
          <div className="mb-10 pb-10 border-b border-white/5">
            <div className="font-mono text-[11px] uppercase tracking-[0.18em] text-brand-signal mb-3">— docs</div>
            <h1 className="heading-display mb-4 text-[2.25rem] sm:text-[3rem] font-medium tracking-tight text-white">
              {BRAND.name} Documentation
            </h1>
            <p className="max-w-3xl text-[17px] leading-relaxed text-brand-steel">
              Everything you need to connect your AI agents to network-reachable MCP servers today,
              with local CLI support planned next.
            </p>

            {/* Mobile search */}
            <div className="relative mt-6 lg:hidden">
              <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-brand-steel pointer-events-none" />
              <input
                className="input !pl-10 !pr-10"
                placeholder="Search documentation…"
                value={query}
                onChange={e => setQuery(e.target.value)}
              />
              {query && (
                <button onClick={() => { setQuery(''); setResults([]); }} className="absolute right-3.5 top-1/2 -translate-y-1/2 text-brand-steel hover:text-white">
                  <X className="h-4 w-4" />
                </button>
              )}
            </div>

            {/* Mobile search results */}
            {results.length > 0 && (
              <div className="mt-2 rounded-xl border border-white/10 bg-white/[0.03] backdrop-blur-md p-2 lg:hidden">
                {results.map(r => (
                  <button
                    key={r.section}
                    onClick={() => navigate(r.section)}
                    className="w-full rounded-lg px-4 py-2.5 text-left text-[14px] text-brand-signal hover:bg-white/5 transition-colors"
                  >
                    {r.label}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* ── Sections ── */}

          <Section id={`what-is-${BRAND.name}`} title={`What is ${BRAND.name}?`}>
            <P>
              {BRAND.name} is the missing layer between AI agents and remote MCP servers. Today, every agent must have
              MCP servers explicitly configured before deployment. There is no way for an agent to discover
              what tools exist, evaluate their quality, or connect to them autonomously.
            </P>
            <P>
              {BRAND.name} solves this with a single endpoint. Your agent queries it by describing what it needs,
              gets back verified servers with full tool schemas, and invokes tools through a security proxy —
              at runtime by intent — never pre-loaded, never eating your context window.
            </P>
            <P>
              Today, {BRAND.name} focuses on network-reachable MCP servers with HTTP transports. Local
              <InlineCode>stdio</InlineCode> support is planned for {BRAND.name} CLI.
            </P>
            <Callout>
              <p className="font-serif text-[15px] italic leading-relaxed text-white/80">
                "Agent development will never scale treating every tool integration as a 1:1 integration."
              </p>
            </Callout>
            <P>
              <strong className="text-white">Free to use.</strong> The core registry, semantic search, and proxy are available
              without a paid plan. No credit card. Transparent limits. No lock-in.
            </P>
            <P>
              <strong className="text-white">Open source.</strong> MIT licensed. Full source at{' '}
              <a href={BRAND.githubUrl} className="text-brand-signal underline underline-offset-2 hover:text-white transition-colors">
                {BRAND.githubUrl.replace('https://', '')}
              </a>.
              The security claims are verifiable, not a promise.
            </P>
          </Section>

          <Section id="how-it-works" title="How it works">
            <P>Every agent interaction follows this flow:</P>
            {[
              ['1', 'Agent has a task', 'Needs to send an email, create a PR, charge a card — any capability.'],
              ['2', `Queries ${BRAND.name} by intent`, `GET /api/servers/search?q=send transactional email — returns verified servers with full inputSchema per tool.`],
              ['3', 'Reads the inputSchema', 'No guessing. The agent knows exactly what arguments each tool requires before calling.'],
              ['4', 'Invokes through the proxy', 'POST /api/proxy/sendgrid-mail/send_email — every call blocks sensitive request patterns, applies policy, scans responses, and writes an audit trail.'],
              ['5', 'Gets a response', 'The upstream result is returned with trust and warning metadata. If response scans trigger, the agent gets the result plus warning headers for review.'],
            ].map(([num, title, desc]) => (
              <div key={num} className="mb-3 flex gap-4 rounded-xl border border-white/5 bg-white/[0.02] p-4">
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-brand-signal/20 border border-brand-signal/30 font-mono text-[11px] font-bold text-brand-signal">{num}</span>
                <div>
                  <div className="mb-1 text-[14px] font-semibold text-white">{title}</div>
                  <div className="text-[13px] leading-relaxed text-brand-steel">{desc}</div>
                </div>
              </div>
            ))}
            <H3>Security on every server and every call</H3>
            <P>
              Every server ingested from official registry, Smithery, Glama, or GitHub is scanned across
              15 layers before listing: static injection analysis, npm CVE scanning, schema pinning,
              typosquatting detection, and more. Every proxy call adds DLP, shell injection detection,
              PII scanning, URL elicitation safety, and context isolation. Current OWASP MCP Top 10
              coverage: ~70%.
            </P>
          </Section>

          <Section id="quickstart" title="Quickstart">
            <H3>Option 1 — System prompt (works everywhere)</H3>
            <CodeBlock code={CODE.systemPrompt} label="Add to your system prompt or AGENTS.md" />

            <H3>Option 2 — Native MCP server (Claude Desktop, Cursor, Antigravity, etc.)</H3>
            <CodeBlock code={CODE.mcpConfig} label="claude_desktop_config.json / .cursor/mcp.json / mcp_config.json" />
            <P>Restart your IDE. Your agent now has two tools: <InlineCode>search_tools</InlineCode> and <InlineCode>invoke_tool</InlineCode>.</P>

            <H3>Option 3 — Fetch the agent skill file</H3>
            <CodeBlock code={`curl ${SITE_URL}${BRAND.agentMdRoute}`} label="Your agent fetches this once — understands everything" />
            <P>
              The skill file is served dynamically with live stats. It teaches any agent how to search,
              how to read inputSchemas, how to invoke, and what trust scores mean. No documentation
              hunting required.
            </P>
          </Section>

          <Section id="credentials" title="Credentials & security">
            <P>
              <strong className="text-white">Do all MCP servers require credentials?</strong> No — roughly 30% are public and
              require nothing. The rest require an API key or OAuth token. Weather, Wikipedia, exchange
              rates: free. Stripe, GitHub, Gmail: credentials required.
            </P>
            <H3>The credential problem</H3>
            <P>
              Every MCP tutorial tells you to paste API keys into a config file. Those files get committed
              to git, read by AI assistants, and exfiltrated via prompt injection. Check Point documented
              CVE-2026-21852 — a vulnerability that harvests credentials directly from MCP config files.
            </P>
            <H3>What {BRAND.name} does about it</H3>
            <P>
              The {BRAND.name} proxy runs DLP on every request and response — 11 credential patterns. If a
              credential pattern appears in a tool argument (the agent accidentally including an API key),
              the call is blocked before it reaches the upstream server. If a credential appears in a
              response, it is flagged in warning headers and audit logs for review.
            </P>
            <H3>{BRAND.name} Vault — the complete solution</H3>
            <P>
              Store credentials once in the {BRAND.name} Vault. They are encrypted with AES-256-GCM via Supabase
              pgsodium. The proxy decrypts at call time and injects as an Authorization header. The raw
              value is never stored in plaintext, never returned through the API, and never visible after
              you save it — only the secret name is shown.
            </P>
            <CodeBlock code={CODE.agentSecrets} label={`${BRAND.name} Vault flow`} />
            <P>
              Manage secrets:{' '}
              <a href={`${SITE_URL}/dashboard/secrets`} className="text-brand-signal underline underline-offset-2 hover:text-white transition-colors">
                {SITE_URL}/dashboard/secrets
              </a>
              {' '}— store once, then let the proxy inject automatically.
            </P>
            <Callout>
              <p className="text-[14px] leading-relaxed text-brand-steel">
                <strong className="text-white">Protecting yourself from sensitive operations:</strong> {BRAND.name}'s proxy already blocks shell
                injection (18 patterns), credential DLP (11 patterns), and indirect prompt injection (12 patterns)
                on every call. For additional control — limiting which tools an agent can call, blocking specific
                domains, setting per-user rate limits — see the user controls section in your dashboard after
                signing in.
              </p>
            </Callout>
          </Section>

          <Section id="mcp-server" title="Native MCP server">
            <P>
              {BRAND.name} exposes itself as a standard MCP server. Instead of making custom HTTP calls,
              your agent connects once and gets two native MCP tools.
            </P>
            <P>
              <strong className="text-white">Transports supported:</strong> StreamableHTTP (POST — primary) and SSE (GET — for
              older clients). stdio is not supported yet — {BRAND.name} is a hosted service today, with a CLI bridge planned next.
            </P>
            <H3>search_tools</H3>
            <CodeBlock code={CODE.mcpServerSearch} label="Find servers by natural language intent" />
            <H3>invoke_tool</H3>
            <CodeBlock code={CODE.mcpServerInvoke} label="Invoke any tool through the security proxy" />
            <P>
              Every invoke_tool call runs through the same remote trust and proxy layer as the REST API.
              Request blocking, response scanning, trust metadata, and audit logging are all applied.
            </P>
          </Section>

          <Section id="rest-api" title="REST API reference">
            <div className="mb-8 overflow-hidden rounded-xl border border-white/8 bg-white/[0.02]">
              {[
                { method: 'GET',  path: BRAND.agentMdRoute,                             desc: 'Agent skill file — markdown, live stats injected' },
                { method: 'GET',  path: '/api/mcp',                               desc: 'Registry info, security layers, agent prompt template' },
                { method: 'GET',  path: '/api/servers/search?q={intent}',         desc: 'Semantic search — returns servers with full inputSchema' },
                { method: 'GET',  path: '/api/servers?sort=trust&source=official', desc: 'Browse with filters: sort, verified, source, tag, page' },
                { method: 'GET',  path: '/api/servers/:name',                     desc: 'Server detail — scan history, CVE issues, tools' },
                { method: 'POST', path: '/api/proxy/:serverName/:toolName',       desc: 'Remote invocation proxy — request blocking, response scanning, audit' },
                { method: 'POST', path: '/api/mcp-server',                        desc: 'Native MCP server (StreamableHTTP) — search_tools + invoke_tool' },
                { method: 'GET',  path: '/api/mcp-server',                        desc: 'Native MCP server (SSE — for older clients)' },
                { method: 'GET',  path: '/api/servers/:name/analytics',           desc: '30-day call volume, latency, DLP events, tool breakdown' },
              ].map((row, i) => (
                <div key={row.path} className={cn('flex flex-col gap-2 p-3 sm:flex-row sm:items-center sm:gap-4', i > 0 && 'border-t border-white/5')}>
                  <span className={cn(
                    'inline-flex shrink-0 items-center rounded px-1.5 py-0.5 font-mono text-[11px] font-bold uppercase tracking-wider',
                    row.method === 'GET' ? 'bg-blue-500/10 text-blue-400 border border-blue-500/20' : 'bg-green-500/10 text-green-400 border border-green-500/20'
                  )}>{row.method}</span>
                  <span className="flex-1 font-mono text-[13px] text-white/80">{row.path}</span>
                  <span className="flex-1 text-[13px] text-brand-steel">{row.desc}</span>
                </div>
              ))}
            </div>
            <H3>Search example</H3>
            <CodeBlock code={CODE.searchExample} label="GET /api/servers/search?q=send+transactional+email" />
            <H3>Invoke example</H3>
            <CodeBlock code={CODE.invokeExample} label="POST /api/proxy/sendgrid-mail/send_email" />
            <P>Response headers on every proxy call:</P>
            <div className="mb-6 flex flex-col gap-2">
              {[
                ['X-Registry-Trust-Score', 'Server trust score at call time (0–100)'],
                ['X-Registry-Latency',     'Upstream latency in ms'],
                ['X-Registry-DLP-Warning', 'Present if DLP rules triggered on response'],
              ].map(([header, desc]) => (
                <div key={header} className="flex gap-4 rounded-xl border border-white/5 bg-white/[0.02] p-3">
                  <code className="shrink-0 font-mono text-[12px] font-medium text-brand-signal">{header}</code>
                  <span className="text-[13px] text-brand-steel">{desc}</span>
                </div>
              ))}
            </div>
          </Section>

          <Section id="trust-scores" title="Trust scores">
            <P>Every server has a trust score from 0–100 that is returned alongside every search result. It is a composite of five signals:</P>
            <div className="mb-6 flex flex-col gap-2">
              {[
                ['Verified publisher (25 pts)', 'Publisher completed GitHub OIDC or DNS challenge to prove identity.'],
                ['Scan history (30 pts)',        'Clean static scan, no shell injection patterns, no CVEs in dependencies.'],
                ['Uptime (20 pts)',              'Measured over the last 30 days by our uptime cron running every 15 minutes.'],
                ['Schema stability (15 pts)',    'Days since last schema change. Servers that frequently mutate their tools score lower.'],
                ['Community signals (10 pts)',   'Star count, call volume, abuse reports.'],
              ].map(([label, desc]) => (
                <div key={label} className="flex flex-col gap-1 rounded-xl border border-white/5 bg-white/[0.02] p-4 sm:flex-row sm:gap-4 sm:items-center">
                  <span className="shrink-0 font-display text-[14px] font-semibold text-white sm:min-w-[200px]">{label}</span>
                  <span className="text-[13px] leading-relaxed text-brand-steel">{desc}</span>
                </div>
              ))}
            </div>
            <div className="grid gap-3 sm:grid-cols-3">
              {[
                { range: '90–100', label: 'Verified + stable',   color: 'text-green-400',  border: 'border-green-500/20', bg: 'bg-green-500/[0.06]' },
                { range: '80–89',  label: 'Good for production', color: 'text-blue-400',   border: 'border-blue-500/20',  bg: 'bg-blue-500/[0.06]' },
                { range: '< 70',   label: 'Use with caution',    color: 'text-red-400',    border: 'border-red-500/20',   bg: 'bg-red-500/[0.06]' },
              ].map(s => (
                <div key={s.range} className={cn('rounded-xl border p-4 text-center', s.bg, s.border)}>
                  <div className={cn('font-mono text-[22px] font-bold', s.color)}>{s.range}</div>
                  <div className="mt-1 text-[12px] font-medium text-brand-steel">{s.label}</div>
                </div>
              ))}
            </div>
          </Section>

          <Section id="categories" title="MCP categories">
            <P>
              {BRAND.name} indexes thousands of servers across 12 categories. Today it focuses on servers with HTTP endpoints that can be invoked through the proxy. Local stdio support is planned for {BRAND.name} CLI. About 70% of invokable servers require credentials.
            </P>
            <div className="grid gap-3 sm:grid-cols-2">
              {CATEGORIES.map(cat => (
                <div key={cat.name} className="rounded-xl border border-white/5 bg-white/[0.02] p-4 hover:bg-white/[0.04] transition-colors">
                  <div className="mb-2 flex items-center justify-between">
                    <span className="font-display text-[15px] font-medium text-white">
                      <span className="mr-2">{cat.icon}</span>{cat.name}
                    </span>
                    <span className="rounded-full bg-white/10 px-2.5 py-0.5 font-mono text-[10px] font-bold text-white/60 tracking-widest">{cat.count}</span>
                  </div>
                  <div className="mb-2 text-[12px] text-brand-steel line-clamp-1" title={cat.examples}>{cat.examples}</div>
                  <div className={cn('text-[11px] font-medium', cat.creds ? 'text-orange-400' : 'text-blue-400')}>
                    {cat.creds ? '🔑 Credentials required' : '🌐 Public — no credentials'}
                  </div>
                </div>
              ))}
            </div>
          </Section>

          <Section id="faq" title="FAQ">
            <div className="flex flex-col gap-6">
              {[
                [`Is ${BRAND.name} really free?', 'Yes. The core registry, semantic search, and proxy are available without a paid plan. No credit card, no freemium trap, and transparent limits. We may introduce optional paid features (publisher analytics, enterprise private registries) in future — but the core product remains accessible.`],
                ['Do I need to register to use it?', 'No. Search and proxy are open. Registration is only needed to publish your own MCP server or create API keys for higher rate limits.'],
                [`How do credentials work if my MCP needs an API key?`, `API keys are stored in the ${BRAND.name} Vault (AES-256-GCM encrypted). When you call a tool through the proxy, the key is decrypted and injected as an Authorization header. The raw key never appears in tool arguments, agent context, or request logs. If a server needs a key you have not stored yet, the proxy returns a 401 with the exact variable name to use and a link to the dashboard.`],
                [`What is the difference between ${BRAND.name} and Smithery?`, `Smithery is a developer marketplace for MCP discovery — CLI-first, requires human browser authentication. ${BRAND.name} is designed for agents to use autonomously at runtime. It also scans every server before listing and exposes a native MCP server so agents need zero configuration beyond one URL.`],
                [`Can I use ${BRAND.name} with Antigravity?`, `Yes. Antigravity added MCP support in early 2026. Use the standard MCP config: { "mcpServers": { "${BRAND.name}": { "url": "${SITE_URL}/api/mcp-server" } } }`],
                [`How does ${BRAND.name} compare to Arcade or Composio?`, `Arcade and Composio are gateway platforms focused on credential management and OAuth. They are strong on auth infrastructure, while ${BRAND.name} focuses on discovery, trust, and secure invocation of remote MCP servers. ${BRAND.name} scans and scores the servers it lists, injects stored credentials through its vault and proxy, and plans to use AgentSecrets as the credential substrate for the future CLI/local bridge.`],
                [`Does ${BRAND.name} support stdio or local MCP servers today?`, `Not yet. The current product is remote-first and focuses on network-reachable MCP servers with HTTP transports. ${BRAND.name} CLI is the planned bridge for local stdio servers, with AgentSecrets handling credentials outside agent context.`],
                [`What does the 15-layer security stack actually do?`, `See the Security section above. Briefly: L1 scans tool descriptions for prompt injection at publish time. L3 hashes all tool schemas and auto-suspends servers that mutate them. L4 blocks credentials in requests and surfaces response warnings. S-12 blocks OS command injection in tool arguments. S-13 scans for instruction-like language in response data. Full details at /api/mcp.`],
              ].map(([q, a], i) => (
                <div key={q as string} className={cn('pb-6', i !== 7 && 'border-b border-white/5')}>
                  <div className="mb-2 font-display text-[15px] font-semibold text-white">{q as string}</div>
                  <div className="text-[14px] leading-relaxed text-brand-steel">{a as string}</div>
                </div>
              ))}
            </div>
          </Section>

          <section id="known-limitations" className="py-12 scroll-mt-24">
            <h2 className="mb-6 font-display text-[1.6rem] sm:text-[2rem] font-medium tracking-tight text-white">
              What's coming
            </h2>
            <P>{BRAND.name} is in active development. Here is what is shipping next.</P>
            <div className="flex flex-col gap-4 mb-12">
              {[
                {
                  title:  `${BRAND.name} CLI for local stdio servers`,
                  status: 'Next launch wave',
                  detail: `A local bridge that uses the same discovery layer for stdio MCP servers. It will resolve candidates from ${BRAND.name}, run local MCP servers when needed, and use AgentSecrets for credential injection outside agent context.`,
                },
                {
                  title:  'Per-user OAuth delegation',
                  status: 'Coming in v0.3',
                  detail: 'Expand OAuth coverage and auto-discovery for servers requiring per-user accounts (GitHub, Gmail, Slack, Stripe connected to your account). The static key vault works for API-key-based servers today.',
                },
                {
                  title:  'WASM sandbox pre-listing execution',
                  status: 'Coming in v0.3',
                  detail: 'Sandboxed execution before listing will catch runtime-only payloads and deferred attacks that static analysis misses. Current security coverage is ~70% OWASP MCP Top 10 across 13 live layers. The sandbox brings this to ~85%.',
                },
              ].map(item => (
                <div key={item.title} className="rounded-xl border border-white/5 bg-white/[0.02] p-5 hover:bg-white/[0.04] transition-colors">
                  <div className="mb-2 flex items-start justify-between gap-3">
                    <div className="font-display text-[15px] font-semibold text-white">{item.title}</div>
                    <span className="shrink-0 rounded-full border border-white/10 bg-white/5 px-2.5 py-0.5 font-mono text-[11px] text-brand-steel whitespace-nowrap">{item.status}</span>
                  </div>
                  <div className="text-[13px] leading-relaxed text-brand-steel">{item.detail}</div>
                </div>
              ))}
            </div>

            <div className="flex flex-wrap gap-3">
              <Link href="/connect" className="btn btn-primary px-6">Connect your agent</Link>
              <Link href="/registry" className="btn btn-ghost px-6">Browse registry</Link>
              <a href={BRAND.githubUrl} target="_blank" rel="noopener" className="btn btn-ghost px-6">GitHub</a>
            </div>
          </section>
        </main>
      </div>

      {/* ── Mobile: floating bottom navigation bar ── */}
      <div className="fixed bottom-0 left-0 right-0 z-50 lg:hidden">
        {/* Expanded nav sheet */}
        {mobileOpen && (
          <div className="border-t border-white/10 bg-[#0F172A]/95 backdrop-blur-xl px-4 pt-4 pb-2 max-h-[55vh] overflow-y-auto">
            <div className="mb-3 relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-brand-steel pointer-events-none" />
              <input
                className="input !pl-8 !py-2 text-[13px] w-full"
                placeholder="Search docs…"
                value={query}
                onChange={e => setQuery(e.target.value)}
              />
            </div>
            <nav className="grid grid-cols-2 gap-1 pb-2">
              {(results.length > 0 ? results : SECTIONS.map(s => ({ ...s, section: s.id }))).map(s => {
                const id = 'section' in s ? s.section : s.id;
                const label = s.label;
                return (
                  <button
                    key={id}
                    onClick={() => navigate(id)}
                    className={cn(
                      'rounded-lg px-3 py-2 text-left text-[13px] transition-colors',
                      active === id
                        ? 'bg-white/10 text-white font-medium'
                        : results.length > 0
                        ? 'text-brand-signal hover:bg-white/5'
                        : 'text-brand-steel hover:bg-white/5 hover:text-white'
                    )}
                  >
                    {label}
                  </button>
                );
              })}
            </nav>
          </div>
        )}

        {/* Bottom bar */}
        <div className="flex items-center justify-between border-t border-white/10 bg-[#0F172A]/95 backdrop-blur-xl px-4 py-3 safe-area-inset-bottom">
          <div className="text-[12px] font-medium text-white truncate max-w-[60%]">
            {SECTIONS.find(s => s.id === active)?.label ?? 'Docs'}
          </div>
          <button
            onClick={() => setMobileOpen(o => !o)}
            className="flex items-center gap-1.5 btn btn-ghost btn-sm"
          >
            {mobileOpen ? <ChevronUp className="h-4 w-4" /> : <Menu className="h-4 w-4" />}
            {mobileOpen ? 'Close' : 'Navigate'}
          </button>
        </div>
      </div>
    </div>
  );
}
