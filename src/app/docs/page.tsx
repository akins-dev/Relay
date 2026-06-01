'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import Link from 'next/link';
import { Search, X, ChevronUp, Menu } from 'lucide-react';
import { cn } from '@/lib/cn';
import { SITE_URL } from '@/lib/site';
import { BRAND } from '@/lib/brand';
import { getAgentBootstrapPrompt, getNativeMcpConfigSnippet } from '@/lib/agent-guidance';

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
  systemPrompt: getAgentBootstrapPrompt(),

  mcpConfig: getNativeMcpConfigSnippet(),

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
      "manifest": {
        "run_mode": "local_stdio",
        "next": "relay invoke sendgrid-mail send_email"
      }
    }
  ]
}`,

  invokeExample: `relay invoke sendgrid-mail send_email --json '{
  "to": "user@example.com",
  "subject": "Your order is confirmed",
  "body": "Thank you for your purchase!"
}'`,

  agentSecrets: `# MVP: keep credentials in the local agent environment
export SENDGRID_API_KEY="..."

# Agent calls Relay Local
relay invoke sendgrid-mail send_email --json '{"to":"user@example.com"}'

# Later: Relay Vault can provide the secret to Relay Local at invoke time`,

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

  mcpServerInvoke: `// Local Relay MCP: agent calls invoke_tool
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
  {
    section: `what-is-${BRAND.name}`,
    label: `What is ${BRAND.name}?`,
    text: `${BRAND.name} missing layer ai agents remote mcp servers configure deployment discover tools quality connect autonomously single relay runtime queries verified servers full tool schemas manifests local invoke security runtime intent context window network http transports stdio cli free open source MIT license`,
  },
  {
    section: "how-it-works",
    label: "How it works",
    text: `${BRAND.name} agent task send email create pr charge card capability queries ${BRAND.name} intent search servers inputSchema arguments invokes through Relay Local policy scans responses audit trail security layers static injection npm cve scanning schema pinning typosquatting detection dlp shell injection pii scanning url owasp`,
  },
  {
    section: "quickstart",
    label: "Quickstart",
    text: "quickstart system prompt agents.md add cloud mcp discovery local relay mcp server claude desktop cursor antigravity config json restart ide search_tools get_server_manifest relay serve invoke_tool skill file curl agents.md live stats teaches agent trust scores how to search read inputschemas",
  },
  {
    section: "credentials",
    label: "Credentials & security",
    text: `credentials security api key oauth token weather wikipedia exchange rates free stripe github gmail require credential problem config file git committed ai assistants exfiltrated prompt injection cve-2026-21852 harvest ${BRAND.name} Relay Local dlp request response blocked local env vault later encrypted plaintext secret name authorization header`,
  },
  {
    section: "mcp-server",
    label: "Native MCP server",
    text: "native mcp server standard mcp server connect one cloud mcp discovery connection two tools search_tools get_server_manifest transports streamablehttp post primary sse get older clients relay local mcp server relay serve planned",
  },
  {
    section: "rest-api",
    label: "REST API reference",
    text: "rest api reference get agents.md skill file markdown live stats servers search intent lexical retrieval reranking inputSchema manifest browse filters sort verified source tag page server detail scan history cve issues tools mcp-server streamablehttp sse analytics latency events",
  },
  {
    section: "trust-scores",
    label: "Trust scores",
    text: "trust scores 0 100 behavioral reliability bayesian prior verified publisher github oidc dns challenge prove identity scan history static scan no shell injection no cves npm uptime schema stability days since last change invoke history relay local outcomes 85 100 verified proven runtime reliability 65 84 clean scan invoke history production suitable below 65 cold start or active issues",
  },
  {
    section: "categories",
    label: "MCP categories",
    text: "mcp categories developer tools github gitlab jira linear sentry vercel databases postgresql mysql mongodb supabase redis payments stripe paypal paddle lemon squeezy communication slack discord gmail outlook telegram ai ml openai replicate huggingface elevenlabs cloud infra aws gcp cloudflare fly.io crm salesforce hubspot notion airtable public data weather exchange rates wikipedia news search brave tavily exa perplexity design figma canva adobe file storage google drive dropbox s3 analytics posthog mixpanel segment ga credentials required public",
  },
  {
    section: "faq",
    label: "FAQ",
    text: "faq frequently asked questions free no credit card freemium transparent limits publisher analytics enterprise private registries register search manifest publish mcp server api keys rate limits credentials api key vault later local env authorization header 401 variable name dashboard smithery arcade composio gateway oauth credential management discovery trust secure invocation scans scores agentsecrets cli local runtime stdio network reachable http transports security stack l1 prompt injection l3 hash tool schemas l4 credentials requests s-12 os command injection s-13 instruction-like language response owasp",
  },
  {
    section: "known-limitations",
    label: "What's coming",
    text: `what's coming ${BRAND.name} cli local stdio servers next launch wave discovery layer run local mcp servers agentsecrets credential injection per-user oauth delegation v0.3 github gmail slack stripe connected account static key vault api-key wasm sandbox pre-listing execution v0.3 sandboxed execution runtime-only payloads deferred attacks static analysis misses owasp mcp top 10 13 live layers 85%`,
  },
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
              gets back verified servers with full tool schemas and run manifests, then invokes through Relay Local —
              at runtime by intent — never pre-loaded, never eating your context window.
            </P>
            <P>
              Today, {BRAND.name} Cloud focuses on discovery and manifests. Relay Local is the planned runtime
              for both remote MCP endpoints and local <InlineCode>stdio</InlineCode> servers in the agent host.
            </P>
            <Callout>
              <p className="font-serif text-[15px] italic leading-relaxed text-white/80">
                &quot;Agent development will never scale treating every tool integration as a 1:1 integration.&quot;
              </p>
            </Callout>
            <P>
              <strong className="text-white">Free to use.</strong> The core registry, intent search, and manifests are available
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
              ['2', `Queries ${BRAND.name} by intent`, `search_tools or GET /api/servers/search?q=send transactional email — returns ranked servers with inputSchema and a run manifest.`],
              ['3', 'Reads the manifest and schema', 'No guessing. The agent knows the selected tool, required arguments, env vars, and whether Relay Local can run it.'],
              ['4', 'Invokes through Relay Local', `relay invoke or local MCP invoke_tool starts/connects to the downstream MCP server and applies local runtime checks.`],
              ['5', 'Gets a normalized response', 'Relay Local returns the upstream result, bounded and ready for later request/response scanning, audit, and outcome reporting.'],
            ].map(([num, title, desc]) => (
              <div key={num} className="mb-3 flex gap-4 rounded-xl border border-white/5 bg-white/[0.02] p-4">
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-brand-signal/20 border border-brand-signal/30 font-mono text-[11px] font-bold text-brand-signal">{num}</span>
                <div>
                  <div className="mb-1 text-[14px] font-semibold text-white">{title}</div>
                  <div className="text-[13px] leading-relaxed text-brand-steel">{desc}</div>
                </div>
              </div>
            ))}
            <H3>Security boundary</H3>
            <P>
              Relay Cloud is the control plane for catalog quality, search, manifests, provenance, and policy.
              Relay Local is the runtime boundary for invocation. That split keeps arbitrary third-party
              MCP processes out of Relay Cloud while preserving one Relay path for future DLP, policy,
              Vault, audit, and outcome learning.
            </P>
          </Section>

          <Section id="quickstart" title="Quickstart">
            <H3>Option 1 — System prompt (works everywhere)</H3>
            <CodeBlock code={CODE.systemPrompt} label="Add to your system prompt or AGENTS.md" />

            <H3>Option 2 — Relay Cloud MCP discovery</H3>
            <CodeBlock code={CODE.mcpConfig} label="claude_desktop_config.json / .cursor/mcp.json / mcp_config.json" />
            <P>Restart your IDE. Your agent now has two Cloud tools: <InlineCode>search_tools</InlineCode> and <InlineCode>get_server_manifest</InlineCode>. Local invocation is handled by Relay Local.</P>

            <H3>Option 3 — Relay Local MCP runtime</H3>
            <CodeBlock code={`{
  "mcpServers": {
    "${BRAND.slug}": {
      "command": "${BRAND.slug}",
      "args": ["serve"]
    }
  }
}`} label="Local MCP config for agent hosts that can run commands" />
            <P>Relay Local is the planned agent runtime. It exposes Relay tools locally and invokes downstream MCP servers without manually connecting each server.</P>

            <H3>Option 4 — Fetch the agent skill file</H3>
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
              The MVP keeps credentials in the local agent environment. Relay manifests declare required
              env vars so Relay Local can fail clearly before invocation. Request/response scanning, local
              policy, and audit reporting attach to Relay Local as the runtime matures.
            </P>
            <H3>{BRAND.name} Vault — later</H3>
            <P>
              Vault remains a planned capability. The safest sequence is local env first, then local encrypted
              storage, then optional Cloud Vault for users who want cross-device secret sync.
            </P>
            <CodeBlock code={CODE.agentSecrets} label={`${BRAND.name} Vault flow`} />
            <Callout>
              <p className="text-[14px] leading-relaxed text-brand-steel">
                <strong className="text-white">Protecting sensitive operations:</strong> Relay Local is the
                right place for argument validation, DLP checks, subprocess limits, response bounds, and audit
                reporting because it is where invocation actually happens.
              </p>
            </Callout>
          </Section>

          <Section id="mcp-server" title="Native MCP server">
            <P>
              {BRAND.name} exposes Cloud discovery as a standard MCP server. Relay Local will expose the
              invocation runtime as a local MCP server started with <InlineCode>{BRAND.slug} serve</InlineCode>.
            </P>
            <P>
              <strong className="text-white">Cloud transports supported:</strong> StreamableHTTP (POST — primary)
              and SSE (GET — for older clients). Cloud MCP is discovery-only in the MVP. Local Relay MCP
              is the planned invocation path for MCP-native agents.
            </P>
            <H3>search_tools</H3>
            <CodeBlock code={CODE.mcpServerSearch} label="Find servers by natural language intent" />
            <H3>local invoke_tool</H3>
            <CodeBlock code={CODE.mcpServerInvoke} label="Local Relay MCP invocation" />
            <P>
              <InlineCode>invoke_tool</InlineCode> belongs in Relay Local, not Relay Cloud. That keeps invocation
              agent-centric while avoiding hosted execution of arbitrary third-party packages.
            </P>
          </Section>

          <Section id="rest-api" title="REST API reference">
            <div className="mb-8 overflow-hidden rounded-xl border border-white/8 bg-white/[0.02]">
              {[
                { method: 'GET',  path: BRAND.agentMdRoute,                             desc: 'Agent skill file — markdown, live stats injected' },
                { method: 'GET',  path: '/api/mcp',                               desc: 'Registry info, security layers, agent prompt template' },
                { method: 'GET',  path: '/api/servers/search?q={intent}',         desc: 'Intent search — lexical retrieval plus reranking, returns servers with full inputSchema' },
                { method: 'GET',  path: '/api/servers?sort=trust&source=official&page=2&page_size=24', desc: 'Browse with filters: sort, verified, source, tag, page, page_size' },
                { method: 'GET',  path: '/api/servers/:name',                     desc: 'Server detail — scan history, CVE issues, tools' },
                { method: 'POST', path: '/api/mcp-server',                        desc: 'Cloud MCP discovery — search_tools + get_server_manifest' },
                { method: 'GET',  path: '/api/mcp-server',                        desc: 'Cloud MCP discovery SSE endpoint for older clients' },
                { method: 'CLI',  path: 'relay invoke <server> <tool>',           desc: 'Relay Local invocation adapter for CLI-capable agents' },
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
            <H3>Relay Local invoke example</H3>
            <CodeBlock code={CODE.invokeExample} label="relay invoke sendgrid-mail send_email" />
            <P>Relay Local should report structured invocation metadata:</P>
            <div className="mb-6 flex flex-col gap-2">
              {[
                ['server', 'Selected server name and manifest version'],
                ['latency_ms', 'End-to-end invocation latency'],
                ['outcome', 'success, failure, blocked, or timeout'],
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
                { range: '85–100', label: 'Verified + proven',      color: 'text-green-400',  border: 'border-green-500/20', bg: 'bg-green-500/[0.06]' },
                { range: '65–84',  label: 'Production-suitable',    color: 'text-amber-400',  border: 'border-amber-500/20', bg: 'bg-amber-500/[0.06]' },
                { range: '< 65',   label: 'Cold start or issues',   color: 'text-red-400',    border: 'border-red-500/20',   bg: 'bg-red-500/[0.06]' },
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
              {BRAND.name} indexes servers across 12 categories and returns manifests that tell Relay Local
              whether a result is runnable as local stdio, connectable as remote MCP, or discovery-only.
              About 70% of useful real-world servers require credentials.
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
                [`Is ${BRAND.name} really free?`, `Yes. The core registry, intent search, and manifests are available without a paid plan. No credit card, no freemium trap, and transparent limits. We may introduce optional paid features in future, but the core discovery layer remains accessible.`],
                ['Do I need to register to use it?', 'No for public discovery. Registration is useful for publishing, API keys, higher limits, and later account-level policy, Vault, and audit features.'],
                [`How do credentials work if my MCP needs an API key?`, `For the MVP, credentials should stay in the local agent environment. Relay manifests describe required env vars, and Relay Local validates them before invoking. Vault can be added later as an optional secret source for Relay Local.`],
                [`What is the difference between ${BRAND.name} and Smithery?`, `Smithery is a developer marketplace for MCP discovery. ${BRAND.name} is designed for agents to use autonomously at runtime: search by intent, fetch a manifest, then invoke through Relay Local without manually configuring every downstream MCP server.`],
                [`Can I use ${BRAND.name} with Antigravity?`, `If the agent host supports remote MCP, use the Cloud MCP config for discovery: { "mcpServers": { "${BRAND.name}": { "url": "${SITE_URL}/api/mcp-server" } } }. If it supports local stdio MCP, Relay Local should be configured with command "${BRAND.slug}" and args ["serve"].`],
                [`How does ${BRAND.name} compare to Arcade or Composio?`, `Arcade and Composio are gateway platforms focused heavily on credential management and OAuth. ${BRAND.name} focuses on agent-centric MCP discovery and a Relay Local runtime that can later attach policy, Vault, audit, and outcome learning at invocation time.`],
                [`Does ${BRAND.name} support stdio or local MCP servers today?`, `The current cloud app returns discovery results and manifests. Relay Local is the next runtime slice: it will run as CLI commands and as a local MCP server that can spawn package-backed stdio servers on demand.`],
                [`What does the security stack actually do?`, `For the MVP, security is split by responsibility. Relay Cloud handles catalog quality, provenance, and manifests. Relay Local is where argument validation, subprocess limits, response bounds, DLP, policy, audit, and outcome reporting belong.`],
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
              What&apos;s coming
            </h2>
            <P>{BRAND.name} is in active development. Here is what is shipping next.</P>
            <div className="flex flex-col gap-4 mb-12">
              {[
                {
                  title:  `${BRAND.name} CLI — native MCP server for stdio`,
                  status: 'Next launch wave',
                  detail: `A CLI package that runs as a native MCP server in your agent host (stdio transport). It uses the same discovery layer as the web API, but can also spawn local stdio MCP servers on demand — like npx downloads and runs without a permanent install. Credentials are fetched from the centralized ${BRAND.name} Vault. Security scanning runs locally.`,
                },
                {
                  title:  'TypeScript + Python SDKs',
                  status: 'Planned',
                  detail: `Programmatic agent integration — import { search, invoke } from '@${BRAND.slug}/sdk'. Wraps the REST API with authentication, retry, response header extraction, and type-safe tool argument validation.`,
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
              <a href={BRAND.githubUrl} target="_blank" rel="noopener noreferrer" className="btn btn-ghost px-6">GitHub</a>
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
              {(results.length > 0 ? results : SECTIONS).map(s => {
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
