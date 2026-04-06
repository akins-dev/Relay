'use client';

import { useState } from 'react';
import Link from 'next/link';
import { motion } from 'framer-motion';
import { ArrowRight, Bot, Cloud, LockKeyhole, TerminalSquare, Workflow, Copy, Check } from 'lucide-react';
import { cn } from '@/lib/cn';
import { AnimatedHeading, AnimatedParagraph, AnimatedLabel, AnimatedSection } from '@/components/AnimatedText';
import { SITE_URL } from '@/lib/site';
import { BRAND } from '@/lib/brand';

const SNIPPETS = {
  'claude-desktop': {
    label: 'Claude Desktop',
    lang:  'json',
    file:  '~/Library/Application Support/Claude/claude_desktop_config.json',
    code: `{
  "mcpServers": {
    "${BRAND.name}": {
      "url": "${SITE_URL}/api/mcp-server"
    }
  }
}`,
  },
  cursor: {
    label: 'Cursor',
    lang:  'json',
    file:  '~/.cursor/mcp.json',
    code: `{
  "mcpServers": {
    "${BRAND.name}": {
      "url": "${SITE_URL}/api/mcp-server"
    }
  }
}`,
  },
  'system-prompt': {
    label: 'System Prompt',
    lang:  'text',
    file:  'Any agent framework',
    code: `## Tool Discovery

You have access to ${BRAND.name}, the trust layer for remote MCP tools.
Read ${SITE_URL}${BRAND.agentMdRoute} once before your first tool call.

Search:  GET ${SITE_URL}/api/servers/search?q={intent}
Invoke:  POST ${SITE_URL}/api/proxy/{serverName}/{toolName}

Prefer servers with trust_score > 80.
Always use the returned inputSchema before invoking a tool.`,
  },
  langchain: {
    label: 'LangChain / Python',
    lang:  'python',
    file:  'Any Python agent',
    code: `import httpx

async def search_${BRAND.name}(intent: str):
    async with httpx.AsyncClient() as client:
        response = await client.get(
            "${SITE_URL}/api/servers/search",
            params={"q": intent, "limit": 5}
        )
        return response.json()

async def invoke_${BRAND.name}(server: str, tool: str, args: dict):
    async with httpx.AsyncClient() as client:
        response = await client.post(
            f"${SITE_URL}/api/proxy/{server}/{tool}",
            json=args
        )
        return response.json()`,
  },
  curl: {
    label: 'cURL / REST',
    lang:  'bash',
    file:  'Any HTTP client',
    code: `# 1. Discover tools by intent
curl "${SITE_URL}/api/servers/search?q=send+transactional+email"

# 2. Invoke through the trust layer
curl -X POST "${SITE_URL}/api/proxy/sendgrid-mail/send_email" \\
  -H "Content-Type: application/json" \\
  -d '{"to": "user@example.com", "subject": "Hello", "body": "..."}'

# 3. Fetch the agent skill file
curl ${SITE_URL}${BRAND.agentMdRoute}`,
  },
} as const;

const STEPS = [
  { num: '01', title: 'Connect once',       desc: `Add a single hosted MCP endpoint to your agent runtime. ${BRAND.name} Cloud becomes the search and invoke surface for remote servers.`,                                    icon: Cloud },
  { num: '02', title: 'Search by intent',   desc: 'Your agent asks for a capability such as "create a Linear issue" instead of relying on a prewired list of integrations.',                                            icon: Bot },
  { num: '03', title: 'Read the schema',    desc: `${BRAND.name} returns matching remote servers with trust metadata and full tool schemas so the agent knows what to pass.`,                                                 icon: Workflow },
  { num: '04', title: 'Invoke safely',      desc: 'Calls route through the proxy for policy checks, credential injection, response scanning, and audit logging.',                                                        icon: LockKeyhole },
] as const;

export default function ConnectPage() {
  const [active, setActive] = useState<keyof typeof SNIPPETS>('claude-desktop');
  const [copied, setCopied] = useState(false);

  const snippet = SNIPPETS[active];

  async function copy(text: string) {
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div className="overflow-x-hidden pb-24">

      {/* ── Hero ── */}
      <section className="page py-16 sm:py-24 border-b border-white/5">
        <div className="grid gap-12 lg:grid-cols-[1fr_1.1fr] lg:items-start">

          {/* Left copy */}
          <div className="max-w-2xl">
            <AnimatedLabel className="inline-flex items-center gap-2 mb-6 px-3 py-1 rounded-full border border-brand-signal/20 bg-brand-signal/10 shadow-[0_0_20px_rgba(6,182,212,0.3)]">
              <TerminalSquare className="h-3.5 w-3.5 text-brand-signal" />
              <span className="font-mono text-[11px] uppercase tracking-[0.2em] text-brand-signal">Connection guide</span>
            </AnimatedLabel>

            <AnimatedHeading
              as="h1"
              className="heading-display text-[2.5rem] sm:text-[3.5rem] lg:text-[4.5rem] font-medium leading-[1.0] text-white"
            >
              {'Connect once.\nDiscover MCP tools at runtime.'}
            </AnimatedHeading>

            <AnimatedParagraph className="mt-6 text-base sm:text-lg leading-8 text-brand-steel" delay={0.2}>
              {BRAND.name} Cloud gives your agent one hosted MCP connection for remote discovery and
              secure invocation. The local CLI comes next, but the remote trust layer is ready now.
            </AnimatedParagraph>

            <motion.div
              className="mt-8 flex flex-col gap-3 sm:flex-row"
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.4, duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
            >
              <Link href="/registry" className="btn btn-primary btn-lg gap-2">
                Browse live registry <ArrowRight className="h-4 w-4" />
              </Link>
              <Link href="/docs" className="btn btn-ghost btn-lg">
                Read the docs
              </Link>
            </motion.div>

            {/* Notice card */}
            <AnimatedSection
              className="mt-10 rounded-2xl border border-white/8 bg-white/[0.03] p-5 backdrop-blur-sm"
              delay={0.5}
            >
              <div className="font-mono text-[11px] uppercase tracking-[0.18em] text-brand-steel mb-2">Remote-first launch</div>
              <p className="text-sm leading-7 text-brand-steel">
                {BRAND.name} currently focuses on network-reachable MCP servers over HTTP. Local{' '}
                <code className="rounded border border-white/10 bg-white/5 px-1.5 py-0.5 font-mono text-[12px] text-white">stdio</code>{' '}
                support will ship through ${BRAND.name} CLI later.
              </p>
            </AnimatedSection>
          </div>

          {/* Right: code snippet panel */}
          <AnimatedSection
            className="rounded-[28px] border border-white/10 bg-white/[0.02] p-4 sm:p-5 backdrop-blur-md shadow-2xl"
            delay={0.15}
          >
            {/* Header bar */}
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-white/8 bg-black/60 px-4 py-3">
              <div>
                <div className="font-mono text-[11px] uppercase tracking-[0.18em] text-brand-signal">{snippet.label}</div>
                <div className="mt-0.5 font-mono text-[11px] text-brand-steel">{snippet.file}</div>
              </div>
              <button
                onClick={() => copy(snippet.code)}
                className="btn btn-sm btn-ghost gap-1.5"
              >
                {copied ? <Check className="h-3.5 w-3.5 text-green-400" /> : <Copy className="h-3.5 w-3.5" />}
                {copied ? 'Copied!' : 'Copy'}
              </button>
            </div>

            {/* Tab switcher */}
            <div className="mb-4 flex flex-wrap gap-1.5">
              {(Object.keys(SNIPPETS) as Array<keyof typeof SNIPPETS>).map((key) => (
                <button
                  key={key}
                  onClick={() => setActive(key)}
                  className={cn(
                    'btn btn-sm rounded-full px-3 text-[12px] font-mono',
                    active === key ? 'btn-primary' : 'btn-ghost'
                  )}
                >
                  {SNIPPETS[key].label}
                </button>
              ))}
            </div>

            {/* Code block */}
            <div className="codeblock">
              <div className="codeblock-header">
                <span className="font-mono text-[11px] uppercase tracking-[0.18em] text-brand-steel">{snippet.lang}</span>
                <span className="font-mono text-[11px] text-brand-signal">${BRAND.name} config</span>
              </div>
              <pre className="text-[13px]">{snippet.code}</pre>
            </div>
          </AnimatedSection>
        </div>
      </section>

      {/* ── How it works ── */}
      <section className="page py-16 sm:py-24 border-b border-white/5">
        <div className="mx-auto max-w-3xl text-center mb-16">
          <AnimatedLabel className="section-label justify-center mb-4">How it works</AnimatedLabel>
          <AnimatedHeading
            as="h2"
            className="heading-display text-[2rem] sm:text-[3rem] font-medium text-white"
          >
            A single connection becomes a runtime tool gateway.
          </AnimatedHeading>
          <AnimatedParagraph className="mt-5 text-base leading-8 text-brand-steel" delay={0.15}>
            The point is not adding another giant config file. The point is replacing preloaded
            tool sprawl with one stable search and invocation surface.
          </AnimatedParagraph>
        </div>

        <div className="grid gap-4 md:grid-cols-2 mb-10">
          {STEPS.map((step, i) => {
            const Icon = step.icon;
            return (
              <AnimatedSection
                key={step.num}
                delay={i * 0.1}
                className="group rounded-2xl border border-white/5 bg-white/[0.02] p-6 transition-all hover:bg-white/[0.04] hover:border-brand-DEFAULT"
              >
                <div className="flex items-start gap-4">
                  <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-white/5 text-brand-signal transition-colors group-hover:bg-brand-DEFAULT group-hover:text-white group-hover:shadow-[0_0_20px_rgba(79,70,229,0.4)]">
                    <Icon className="h-5 w-5" />
                  </div>
                  <div>
                    <div className="font-mono text-[11px] uppercase tracking-[0.18em] text-brand-steel">{step.num}</div>
                    <h3 className="mt-2 font-display text-xl font-medium text-white">{step.title}</h3>
                    <p className="mt-2 text-sm leading-7 text-brand-steel">{step.desc}</p>
                  </div>
                </div>
              </AnimatedSection>
            );
          })}
        </div>

        {/* Flow + security */}
        <div className="grid gap-4 lg:grid-cols-[1.1fr_0.9fr]">
          <div className="codeblock">
            <div className="codeblock-header">
              <span className="font-mono text-[11px] uppercase tracking-[0.18em] text-brand-steel">Flow</span>
              <span className="font-mono text-[11px] text-brand-signal">hosted MCP</span>
            </div>
            <pre>{`1. Agent needs a capability
2. search_tools("send transactional email")
3. ${BRAND.name} returns matching remote tools + schemas
4. invoke_tool({ server, tool, args })
5. ${BRAND.name} handles policy, credentials, proxying, and audit`}</pre>
          </div>

          <AnimatedSection className="rounded-2xl border border-white/5 bg-white/[0.02] p-6">
            <div className="flex items-center gap-3 mb-4">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-green-500/10 border border-green-500/20">
                <LockKeyhole className="h-5 w-5 text-green-400" />
              </div>
              <div className="font-display text-lg font-medium text-white">Security on every call</div>
            </div>
            <p className="text-sm leading-7 text-brand-steel">
              Every remote server is scanned before listing. Every proxy call blocks unsafe request
              patterns, injects credentials outside agent arguments, surfaces response warnings, and
              writes an audit trail.
            </p>
            <div className="mt-5 flex flex-wrap gap-2">
              {['Request DLP', 'Proxy audit', 'Credential isolation'].map(tag => (
                <span key={tag} className="rounded-full border border-white/10 bg-white/5 px-3 py-1 font-mono text-[11px] uppercase tracking-[0.16em] text-brand-steel">
                  {tag}
                </span>
              ))}
            </div>
          </AnimatedSection>
        </div>
      </section>

      {/* ── CTA ── */}
      <section className="page py-16 sm:py-24">
        <div className="mx-auto max-w-3xl text-center">
          <AnimatedLabel className="section-label justify-center mb-4">Next surface</AnimatedLabel>
          <AnimatedHeading
            as="h2"
            className="heading-display text-[2rem] sm:text-[3rem] font-medium text-white"
          >
            {`${BRAND.name} Cloud now.\n${BRAND.name} CLI later.`}
          </AnimatedHeading>
          <AnimatedParagraph className="mt-5 max-w-2xl mx-auto text-base leading-8 text-brand-steel" delay={0.15}>
            The hosted remote layer launches first because it solves runtime discovery and secure
            invocation immediately. The local CLI will extend that same discovery model to{' '}
            <code className="rounded border border-white/10 bg-white/5 px-1.5 py-0.5 font-mono text-[12px] text-white">stdio</code>{' '}
            servers later.
          </AnimatedParagraph>

          <motion.div
            className="mt-8 flex flex-col justify-center gap-3 sm:flex-row"
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.35, duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
          >
            <a href={BRAND.agentMdRoute} target="_blank" rel="noopener" className="btn btn-ghost btn-lg">
              Read the skill file
            </a>
            <Link href="/registry" className="btn btn-primary btn-lg gap-2">
              Explore remote servers <ArrowRight className="h-4 w-4" />
            </Link>
          </motion.div>
        </div>
      </section>
    </div>
  );
}
