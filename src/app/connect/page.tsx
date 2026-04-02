'use client';

import { useState } from 'react';
import Link from 'next/link';
import { ArrowRight, Bot, Cloud, LockKeyhole, TerminalSquare, Workflow } from 'lucide-react';
import { cn } from '@/lib/cn';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';

const SNIPPETS = {
  'claude-desktop': {
    label: 'Claude Desktop',
    lang: 'json',
    file: '~/Library/Application Support/Claude/claude_desktop_config.json',
    code: `{
  "mcpServers": {
    "agentrail": {
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
    "agentrail": {
      "url": "https://openmcp.dev/api/mcp-server"
    }
  }
}`,
  },
  'system-prompt': {
    label: 'System Prompt / AGENTS.md',
    lang: 'text',
    file: 'Any agent framework',
    code: `## Tool Discovery

You have access to Agentrail, the trust layer for remote MCP tools.
Read https://openmcp.dev/openmcp.md once before your first tool call.

Search:  GET https://openmcp.dev/api/servers/search?q={intent}
Invoke:  POST https://openmcp.dev/api/proxy/{serverName}/{toolName}

Prefer servers with trust_score > 80.
Always use the returned inputSchema before invoking a tool.`,
  },
  langchain: {
    label: 'LangChain / Python',
    lang: 'python',
    file: 'Any Python agent',
    code: `import httpx

async def search_agentrail(intent: str):
    async with httpx.AsyncClient() as client:
        response = await client.get(
            "https://openmcp.dev/api/servers/search",
            params={"q": intent, "limit": 5}
        )
        return response.json()

async def invoke_agentrail(server: str, tool: str, args: dict):
    async with httpx.AsyncClient() as client:
        response = await client.post(
            f"https://openmcp.dev/api/proxy/{server}/{tool}",
            json=args
        )
        return response.json()`,
  },
  antigravity: {
    label: 'Google Antigravity',
    lang: 'json',
    file: 'Antigravity MCP config',
    code: `{
  "mcpServers": {
    "agentrail": {
      "url": "https://openmcp.dev/api/mcp-server"
    }
  }
}`,
  },
  curl: {
    label: 'cURL / REST',
    lang: 'bash',
    file: 'Any HTTP client',
    code: `# 1. Discover tools by intent
curl "https://openmcp.dev/api/servers/search?q=send+transactional+email"

# 2. Invoke through the trust layer
curl -X POST "https://openmcp.dev/api/proxy/sendgrid-mail/send_email" \\
  -H "Content-Type: application/json" \\
  -d '{"to": "user@example.com", "subject": "Hello", "body": "..."}'

# 3. Fetch the agent skill file
curl https://openmcp.dev/openmcp.md`,
  },
} as const;

const STEPS = [
  {
    num: '01',
    title: 'Connect once',
    desc: 'Add a single hosted MCP endpoint to your agent runtime. Agentrail Cloud becomes the search and invoke surface for remote servers.',
    icon: Cloud,
  },
  {
    num: '02',
    title: 'Search by intent',
    desc: 'Your agent asks for a capability such as “create a Linear issue” instead of relying on a prewired list of integrations.',
    icon: Bot,
  },
  {
    num: '03',
    title: 'Read the schema',
    desc: 'Agentrail returns matching remote servers with trust metadata and full tool schemas so the agent knows what to pass.',
    icon: Workflow,
  },
  {
    num: '04',
    title: 'Invoke safely',
    desc: 'Calls route through the proxy for policy checks, credential injection, response scanning, and audit logging.',
    icon: LockKeyhole,
  },
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
    <div className="overflow-x-hidden">
      <section className="relative border-b border-[rgba(0,0,0,0.06)]">
        <div className="page relative py-16 sm:py-20">
          <div className="grid gap-10 lg:grid-cols-[0.95fr_1.05fr] lg:items-center">
            <div className="max-w-2xl">
              <div className="inline-flex items-center gap-2 rounded-full border border-[rgba(0,0,0,0.1)] bg-[rgba(255,255,255,0.9)] px-4 py-2 font-mono text-[11px] uppercase tracking-[0.18em] text-[#a1a1aa] shadow-sm">
                <TerminalSquare className="h-3.5 w-3.5" />
                Connection guide
              </div>

              <h1 className="heading-display mt-6 text-[2.45rem] font-medium leading-[0.98] text-[#0a0a0a] sm:text-[3.15rem] lg:text-[4rem]">
                Connect once.
                <span className="block text-[#a1a1aa]">
                  Discover remote MCP tools at runtime.
                </span>
              </h1>

              <p className="mt-6 max-w-xl text-base leading-8 text-[#52525b] sm:text-lg">
                Agentrail Cloud gives your agent one hosted MCP connection for remote discovery and secure invocation. The local CLI comes next, but the remote trust layer is ready now.
              </p>

              <div className="mt-8 flex flex-col gap-3 sm:flex-row">
                <Button asChild size="lg" className="rounded-full bg-black px-6 text-white hover:bg-neutral-800 shadow-md">
                  <Link href="/registry">
                    Browse live registry
                    <ArrowRight className="h-4 w-4" />
                  </Link>
                </Button>
                <Button asChild variant="outline" size="lg" className="rounded-full border-[rgba(0,0,0,0.1)] bg-white px-6 text-[#0a0a0a] shadow-sm hover:bg-neutral-50">
                  <Link href="/docs">Read the docs</Link>
                </Button>
              </div>

              <Card className="mt-10 rounded-[28px] border border-[rgba(0,0,0,0.06)] bg-white shadow-sm">
                <CardContent className="p-6">
                  <div className="font-mono text-[11px] uppercase tracking-[0.18em] text-[#a1a1aa]">Remote-first launch</div>
                  <p className="mt-3 text-sm leading-7 text-[#52525b]">
                    Agentrail currently focuses on network-reachable MCP servers over HTTP. Local <code className="rounded border border-[rgba(0,0,0,0.05)] bg-[#fafafa] px-1.5 py-0.5 font-mono text-[12px] text-[#0a0a0a]">stdio</code> support will ship through Agentrail CLI later.
                  </p>
                </CardContent>
              </Card>
            </div>

            <Card className="rounded-[32px] border border-[rgba(0,0,0,0.06)] bg-[rgba(255,255,255,0.7)] p-4 shadow-xl backdrop-blur-md sm:p-5">
              <CardContent className="p-0">
                <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-[rgba(255,255,255,0.08)] bg-[#0a0a0a] px-4 py-3">
                  <div>
                    <div className="font-mono text-[11px] uppercase tracking-[0.18em] text-cyan-400">{snippet.label}</div>
                    <div className="mt-1 font-mono text-[11px] text-[#a1a1aa]">{snippet.file}</div>
                  </div>
                  <Button
                    onClick={() => copy(snippet.code)}
                    variant="outline"
                    size="sm"
                    className="rounded-full border border-[rgba(255,255,255,0.1)] bg-[rgba(255,255,255,0.05)] text-white hover:bg-[rgba(255,255,255,0.1)]"
                  >
                    {copied ? 'Copied' : 'Copy snippet'}
                  </Button>
                </div>

                <div className="mb-4 flex flex-wrap gap-2">
                {(Object.keys(SNIPPETS) as Array<keyof typeof SNIPPETS>).map((key) => (
                  <Button
                    key={key}
                    onClick={() => setActive(key)}
                    variant={active === key ? 'default' : 'outline'}
                    size="sm"
                    className={cn(
                      'rounded-full px-4',
                      active === key
                        ? 'bg-black text-white hover:bg-neutral-800 shadow-md'
                        : 'border border-[rgba(0,0,0,0.08)] bg-white text-[#52525b] shadow-sm hover:bg-neutral-50 hover:text-black'
                    )}
                  >
                    {SNIPPETS[key].label}
                  </Button>
                ))}
                </div>

                <div className="codeblock">
                  <div className="codeblock-header !bg-[#000] !border-b-[rgba(255,255,255,0.1)]">
                    <span className="font-mono text-[11px] uppercase tracking-[0.18em] text-[#a1a1aa]">{snippet.lang}</span>
                    <span className="font-mono text-[11px] text-cyan-400">agentrail config</span>
                  </div>
                  <pre className="!bg-[#0a0a0a] !text-[#ededed]">{snippet.code}</pre>
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      </section>

      <section className="page py-16 sm:py-20">
        <div className="mx-auto max-w-3xl text-center">
          <div className="section-label justify-center text-[#a1a1aa]">how it works</div>
          <h2 className="heading-display text-[2rem] font-medium text-[#0a0a0a] sm:text-[2.45rem]">
            A single connection becomes a runtime tool gateway.
          </h2>
          <p className="mx-auto mt-5 max-w-2xl text-base leading-8 text-[#52525b]">
            The point is not adding another giant config file. The point is replacing preloaded tool sprawl with one stable search and invocation surface.
          </p>
        </div>

        <div className="mt-12 grid gap-5 lg:grid-cols-2">
          {STEPS.map((step) => {
            const Icon = step.icon;
            return (
              <Card key={step.num} className="rounded-[28px] border border-[rgba(0,0,0,0.06)] bg-white shadow-sm transition-shadow hover:shadow-md">
                <CardContent className="p-6">
                  <div className="flex items-start gap-4">
                    <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-[rgba(0,0,0,0.03)] text-black">
                      <Icon className="h-5 w-5" />
                    </div>
                    <div className="flex-1">
                      <div className="font-mono text-[11px] uppercase tracking-[0.18em] text-[#a1a1aa]">{step.num}</div>
                      <h3 className="mt-2 font-display text-xl font-medium text-[#0a0a0a]">{step.title}</h3>
                      <p className="mt-3 text-sm leading-7 text-[#52525b]">{step.desc}</p>
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>

        <div className="mt-10 grid gap-5 lg:grid-cols-[1.05fr_0.95fr]">
          <div className="codeblock h-full">
            <div className="codeblock-header flex justify-between">
              <span className="font-mono text-[11px] uppercase tracking-[0.18em] text-[#a1a1aa]">Flow</span>
              <span className="font-mono text-[11px] uppercase tracking-[0.18em] text-cyan-400">hosted MCP</span>
            </div>
            <pre className="!bg-[#0a0a0a]">{`1. Agent needs a capability
2. search_tools("send transactional email")
3. Agentrail returns matching remote tools + schemas
4. invoke_tool({ server, tool, args })
5. Agentrail handles policy, credentials, proxying, and audit`}</pre>
          </div>

          <div className="rounded-[24px] border border-[rgba(0,0,0,0.06)] bg-white p-6 shadow-sm">
            <div className="flex items-center gap-3 text-black">
              <LockKeyhole className="h-5 w-5" />
              <div className="font-display text-lg font-medium text-[#0a0a0a]">Security on every call</div>
            </div>
            <p className="mt-4 text-sm leading-7 text-[#52525b]">
              Every remote server is scanned before listing. Every proxy call blocks unsafe request patterns, injects credentials outside agent arguments, surfaces response warnings, and writes an audit trail.
            </p>
            <div className="mt-5 flex flex-wrap gap-2">
              <span className="rounded-full border border-[rgba(0,0,0,0.08)] bg-[#fafafa] px-3 py-1 font-mono text-[11px] uppercase tracking-[0.16em] text-[#52525b]">Request DLP</span>
              <span className="rounded-full border border-[rgba(0,0,0,0.08)] bg-[#fafafa] px-3 py-1 font-mono text-[11px] uppercase tracking-[0.16em] text-[#52525b]">Proxy audit</span>
              <span className="rounded-full border border-[rgba(0,0,0,0.08)] bg-[#fafafa] px-3 py-1 font-mono text-[11px] uppercase tracking-[0.16em] text-[#52525b]">Credential isolation</span>
            </div>
          </div>
        </div>
      </section>

      <section className="border-t border-[rgba(0,0,0,0.06)]">
        <div className="page py-16 sm:py-20">
          <div className="mx-auto max-w-3xl text-center">
            <div className="section-label justify-center text-[#a1a1aa]">next surface</div>
            <h2 className="heading-display text-[2rem] font-medium text-[#0a0a0a] sm:text-[2.45rem]">
              Agentrail Cloud now.
              <span className="block text-[#a1a1aa]">Agentrail CLI after.</span>
            </h2>
            <p className="mx-auto mt-5 max-w-2xl text-base leading-8 text-[#52525b]">
              The hosted remote layer launches first because it solves runtime discovery and secure invocation immediately. The local CLI will extend that same discovery model to <code className="rounded border border-[rgba(0,0,0,0.05)] bg-[#fafafa] px-1.5 py-0.5 font-mono text-[12px] text-black">stdio</code> servers later.
            </p>

            <div className="mt-8 flex flex-col justify-center gap-3 sm:flex-row">
              <Button asChild variant="outline" size="lg" className="rounded-full border-[rgba(0,0,0,0.1)] bg-white px-6 text-[#0a0a0a] shadow-sm hover:bg-neutral-50">
                <a href="/openmcp.md" target="_blank" rel="noopener">Read the skill file</a>
              </Button>
              <Button asChild size="lg" className="rounded-full bg-black px-6 text-white hover:bg-neutral-800 shadow-md">
                <Link href="/registry">
                  Explore remote servers
                  <ArrowRight className="h-4 w-4" />
                </Link>
              </Button>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
