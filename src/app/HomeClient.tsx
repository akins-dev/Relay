'use client';

import Link from 'next/link';
import {
  ArrowRight,
  Compass,
  Radar,
  ShieldCheck,
  Sparkles,
  Workflow,
  Command,
  Terminal,
} from 'lucide-react';
import { ChatAgentSimulation } from '@/components/ChatAgentSimulation';
import { SecurityTimelineSimulation } from '@/components/SecurityTimelineSimulation';
import { ServerCard } from '@/components/registry/ServerCard';
import type { GlobalStats, Server } from '@/types';

const PRINCIPLES = [
  {
    title: 'Discover by intent',
    description: 'Agents ask for a capability, not a brittle integration name. Agentrail returns matching remote MCP tools with schema and trust context.',
    icon: Compass,
  },
  {
    title: 'Invoke through policy',
    description: 'Every call moves through one hosted trust layer for confirmation rules, rate limits, credential injection, and auditability.',
    icon: Workflow,
  },
  {
    title: 'Keep context lean',
    description: 'Instead of preloading a giant menu of tools, the agent reaches for the right one when it is actually needed.',
    icon: Radar,
  },
] as const;

function Metric({ value, label }: { value: string; label: string }) {
  return (
    <div className="flex flex-col items-center justify-center p-4">
      <div className="font-mono text-[11px] uppercase tracking-[0.18em] text-[#a1a1aa]">{label}</div>
      <div className="mt-2 font-display text-4xl font-medium tracking-[-0.03em] text-[#fff]">{value}</div>
    </div>
  );
}

// Minimal placeholder logos for the "Trusted By" segment
function LogoCloud() {
  return (
    <div className="mt-24 border-t border-[rgba(0,0,0,0.06)] pt-12 text-center pb-8">
      <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-[#a1a1aa] mb-8">
        Trusted by the teams pushing AI forward
      </p>
      <div className="flex flex-wrap items-center justify-center gap-x-12 gap-y-8 opacity-60 grayscale filter transition-all hover:grayscale-0">
        <div className="flex items-center gap-2 font-display text-xl font-bold"><Command className="h-5 w-5"/> Acme Corp</div>
        <div className="flex items-center gap-2 font-display text-xl font-bold tracking-tight">Vercel</div>
        <div className="flex items-center gap-2 font-display text-xl italic font-serif">Superhuman</div>
        <div className="flex items-center gap-2 font-display text-xl font-medium">Perplexity</div>
        <div className="flex items-center gap-2 font-display text-xl tracking-widest uppercase text-sm">Linear</div>
      </div>
    </div>
  );
}

export function HomeClient({ stats, featured }: { stats: GlobalStats; featured: Server[] }) {
  const invokable = stats.invokable_servers?.toLocaleString() ?? stats.active_servers.toLocaleString();
  const callsToday = stats.calls_today ? `${Math.max(1, Math.round(stats.calls_today / 1000))}K` : '0';
  const avgTrust = stats.avg_trust_score ? stats.avg_trust_score.toFixed(1) : '0.0';

  return (
    <div className="overflow-x-hidden">
      {/* ── 1. Hero & AI Chat Simulation ── */}
      <section className="page pt-12 sm:pt-20 lg:pt-28 text-center bg-transparent">
        <div className="mx-auto max-w-4xl flex flex-col items-center">
          <div className="inline-flex items-center gap-2 rounded-full border border-[rgba(0,0,0,0.08)] bg-white px-4 py-2 font-mono text-[11px] uppercase tracking-[0.18em] text-[var(--text-2)] shadow-sm anim-fadeup" style={{ animationDelay: '0ms' }}>
            <Sparkles className="h-3.5 w-3.5" />
            Agentrail Cloud
          </div>
          
          <h1 className="heading-display mt-8 max-w-4xl text-[3rem] font-medium leading-[0.98] text-[#0a0a0a] sm:text-[4.5rem] lg:text-[5.5rem] anim-fadeup" style={{ animationDelay: '100ms' }}>
            Next-Gen Tools, <br />
            Powered by Intent
          </h1>
          
          <p className="mt-8 max-w-2xl text-lg leading-8 text-[#52525b] anim-fadeup" style={{ animationDelay: '200ms' }}>
            Agentrail is the runtime discovery and trust layer for remote MCP servers. Instead of hardcoding a giant integration list, agents search for the capability they need and invoke it through one governed path.
          </p>

          <div className="mt-10 flex flex-col items-center gap-4 sm:flex-row justify-center anim-fadeup" style={{ animationDelay: '300ms' }}>
            <Link href="/connect" className="btn btn-primary btn-lg">
              Connect your agent
              <ArrowRight className="h-4 w-4" />
            </Link>
            <Link href="/registry" className="btn btn-ghost btn-lg">
              Browse the registry
            </Link>
          </div>
        </div>

        {/* Dual-Pane Simulation */}
        <div className="mt-20 anim-fadeup" style={{ animationDelay: '400ms' }}>
           <ChatAgentSimulation />
        </div>

        <LogoCloud />
      </section>

      {/* ── Dark Mode Transition ── */}
      <div className="relative w-full h-32 bg-gradient-to-b from-transparent to-[#0a0a0a]">
         <div className="absolute inset-x-0 bottom-0 h-px bg-gradient-to-r from-transparent via-[rgba(255,255,255,0.1)] to-transparent" />
      </div>

      <div className="bg-[#0a0a0a] text-[#ededed]">
        {/* Stats Section */}
        <section className="page py-12 border-b border-[rgba(255,255,255,0.05)]">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4 divide-y sm:divide-y-0 sm:divide-x divide-[rgba(255,255,255,0.08)]">
            <Metric label="Invokable servers" value={invokable} />
            <Metric label="Verified" value={stats.verified_servers?.toLocaleString() ?? '0'} />
            <Metric label="Calls today" value={callsToday} />
            <Metric label="Avg trust" value={avgTrust} />
          </div>
        </section>

        {/* ── 2. Security Timeline Section ── */}
        <section className="page py-24 border-b border-[rgba(255,255,255,0.05)] text-center overflow-hidden">
           <div className="mx-auto max-w-3xl mb-16">
             <div className="inline-flex items-center justify-center gap-2 mb-4 text-[#4ade80] font-mono text-[11px] uppercase tracking-[0.18em]">
               <ShieldCheck className="h-4 w-4" /> Runtime Security
             </div>
             <h2 className="heading-display text-[2.5rem] font-medium leading-[1.05] text-white sm:text-[3.5rem]">
               Govern every invocation.
               <span className="block text-[#a1a1aa]">Automatically.</span>
             </h2>
             <p className="mt-6 text-lg leading-8 text-[#a1a1aa]">
               Discovery is only useful if invocation is safe. Agentrail injects a unified trust layer between your agent and remote MCP tools—handling credentials, policy validation, and DLP scanning in milliseconds.
             </p>
           </div>
           
           <div className="relative">
             {/* Security Pipeline visual */}
             <SecurityTimelineSimulation />
           </div>
        </section>

        {/* ── 3. Features / Principles Section ── */}
        <section className="page py-16 sm:py-24">
          <div className="grid gap-12 lg:grid-cols-[0.8fr_1.2fr] lg:items-start">
            <div>
              <div className="section-label text-[#a1a1aa]">why this matters</div>
              <h2 className="heading-display text-[2.5rem] font-medium leading-[1.05] text-white sm:text-[3.5rem]">
                Hardcoded tools create noisy agents.
              </h2>
            </div>
            <div className="grid gap-8 sm:grid-cols-2">
              {PRINCIPLES.map((item) => {
                const Icon = item.icon;
                return (
                  <div key={item.title} className="group">
                    <div className="flex h-12 w-12 items-center justify-center rounded-full bg-[rgba(255,255,255,0.05)] text-white transition-colors group-hover:bg-white group-hover:text-black">
                      <Icon className="h-5 w-5" />
                    </div>
                    <h3 className="mt-6 font-display text-2xl font-medium leading-tight text-white">{item.title}</h3>
                    <p className="mt-3 text-sm leading-7 text-[#a1a1aa]">{item.description}</p>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="mt-16 rounded-[24px] border border-[rgba(255,255,255,0.08)] bg-[rgba(255,255,255,0.02)] p-6 sm:p-10 lg:flex lg:items-center lg:justify-between lg:gap-10">
            <div className="lg:w-1/2">
              <div className="font-mono text-[11px] uppercase tracking-[0.18em] text-[#a1a1aa]">The Agentrail Flow</div>
              <p className="mt-4 text-lg leading-8 text-[#d4d4d8]">
                The agent stays focused on business intent. Agentrail handles the search surface, the trust checks, the credentials, and the audit trail around the call itself.
              </p>
            </div>
            <div className="mt-8 lg:mt-0 lg:w-1/2">
              <pre className="whitespace-pre-wrap font-mono text-[13px] leading-8 text-[#a1a1aa]">
                <span className="text-white">1.</span> search_tools("create Linear issue")<br/>
                <span className="text-white">2.</span> Agentrail returns candidates + schemas<br/>
                <span className="text-white">3.</span> invoke_tool({`{ server, tool, args }`})<br/>
                <span className="text-white">4.</span> Policy, auth, proxy, and audit run<br/>
                <span className="text-white">5.</span> Result comes back with trust metadata
              </pre>
            </div>
          </div>
        </section>

        {/* Featured Registry Section */}
        {featured.length > 0 && (
          <section className="page py-16 sm:py-24 border-t border-[rgba(255,255,255,0.05)]">
            <div className="mb-12 flex flex-col gap-6 sm:flex-row sm:items-end sm:justify-between">
              <div>
                <div className="section-label text-[#a1a1aa]">Current Landscape</div>
                <h2 className="heading-display text-[2.5rem] font-medium leading-[1.05] text-white">
                  Verified remote tools
                </h2>
                <p className="mt-3 max-w-2xl text-lg leading-7 text-[#a1a1aa]">
                  A first look at the capabilities agents can discover and invoke through Agentrail Cloud today.
                </p>
              </div>
              <Link href="/registry" className="btn btn-ghost hover:!bg-white hover:!text-black !bg-[rgba(255,255,255,0.1)] !text-white !border-transparent">
                Explore registry
                <ArrowRight className="h-4 w-4" />
              </Link>
            </div>

            <div className="grid-2 [&_.card]:bg-[rgba(255,255,255,0.03)] [&_.card]:text-white [&_.card]:border-[rgba(255,255,255,0.08)] [&_.card:hover]:border-[rgba(255,255,255,0.2)] [&_.text-\[\#514b45\]]:text-[#a1a1aa]">
              {featured.map((server) => (
                <ServerCard key={server.id} server={server} />
              ))}
            </div>
          </section>
        )}

        {/* ── 4. Upcoming CLI Section ── */}
        <section className="page py-16 sm:py-24 border-t border-[rgba(255,255,255,0.05)] flex justify-center">
            <div className="max-w-3xl w-full rounded-[24px] border border-[rgba(255,255,255,0.08)] bg-[rgba(255,255,255,0.03)] p-8 sm:p-12 text-center relative overflow-hidden">
                {/* Decorative background glow */}
                <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-64 h-64 bg-white opacity-5 blur-[120px] rounded-full pointer-events-none" />
                
                <div className="inline-flex h-12 w-12 items-center justify-center rounded-full bg-[rgba(255,255,255,0.1)] text-white mb-6 relative z-10">
                   <Terminal className="h-5 w-5" />
                </div>
                <h2 className="heading-display text-[2.5rem] font-medium leading-[1.05] text-white relative z-10">
                    Agentrail CLI is coming soon.
                </h2>
                <p className="mt-4 text-lg leading-8 text-[#a1a1aa] mx-auto max-w-2xl relative z-10">
                    Agentrail Cloud brings governed invocation to the network. The upcoming CLI brings the exact same trust fabric to local <code className="text-[#e4e4e7] bg-[rgba(255,255,255,0.1)] px-1.5 py-0.5 rounded">stdio</code> MCP servers. Local testing, universal discovery.
                </p>
            </div>
        </section>

        {/* ── 5. Footer / CTA ── */}
        <section className="page py-16 sm:py-24 border-t border-[rgba(255,255,255,0.05)]">
          <div className="text-center max-w-3xl mx-auto">
            <h2 className="heading-display mt-4 text-[3rem] font-medium leading-[1.05] text-white sm:text-[4.5rem]">
               Start building with Agentrail Cloud today.
            </h2>
            <div className="mt-10 flex flex-col gap-4 sm:flex-row justify-center">
              <Link href="/connect" className="btn !bg-white !text-black btn-lg">
                Connect your agent
                <ArrowRight className="h-4 w-4" />
              </Link>
              <a
                href="https://github.com/the-17/openmcp"
                target="_blank"
                rel="noopener"
                className="btn btn-ghost !bg-[rgba(255,255,255,0.1)] !text-white !border-transparent hover:!bg-white hover:!text-black btn-lg"
              >
                View the source
              </a>
            </div>
          </div>

          <footer className="mt-24 pt-8 border-t border-[rgba(255,255,255,0.05)] flex flex-col gap-6 text-sm text-[#a1a1aa] sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-3">
              <div className="flex h-9 w-9 items-center justify-center rounded-full bg-white text-xs font-black text-black">
                ⇢
              </div>
              <div>
                <div className="font-display text-xl font-medium tracking-tight text-white">Agentrail</div>
                <div className="font-mono text-[10px] uppercase tracking-[0.18em]">by TheSeventeen</div>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-6">
              <Link href="/registry" className="hover:text-white transition-colors">Registry</Link>
              <Link href="/docs" className="hover:text-white transition-colors">Docs</Link>
              <Link href="/publish" className="hover:text-white transition-colors">Publish</Link>
              <a href="https://github.com/the-17/openmcp" target="_blank" rel="noopener" className="hover:text-white transition-colors">
                GitHub
              </a>
            </div>
          </footer>
        </section>
      </div>
    </div>
  );
}
