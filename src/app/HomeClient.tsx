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
import { HeroOrbital } from '@/components/HeroOrbital';
import { SecurityTimelineSimulation } from '@/components/SecurityTimelineSimulation';
import { ServerCard } from '@/components/registry/ServerCard';
import type { GlobalStats, Server } from '@/types';

const PRINCIPLES = [
  {
    title: 'Intelligent Discovery',
    description: 'Agents describe the capability they need by intent. Agentrail instantly returns matching remote MCP tools with complete schema mapping and trust context.',
    icon: Compass,
  },
  {
    title: 'Verified Trust Layer',
    description: 'Every tool invocation passes through a hosted trust proxy handling custom policy validation, rate limits, and zero-knowledge credential injection.',
    icon: Workflow,
  },
  {
    title: 'Minimal Context',
    description: 'Rather than preloading thousands of tokens of unverified tools, the agent discovers and fetches exactly what it needs right when the intent arises.',
    icon: Radar,
  },
] as const;

function Metric({ value, label }: { value: string; label: string }) {
  return (
    <div className="flex flex-col items-center justify-center p-4">
      <div className="font-mono text-[11px] uppercase tracking-[0.18em] text-brand-steel">{label}</div>
      <div className="mt-2 font-display text-4xl font-medium tracking-[-0.03em] text-white drop-shadow-md">{value}</div>
    </div>
  );
}

// Minimal placeholder logos for the "Trusted By" segment
function LogoCloud() {
  return (
    <div className="mt-32 border-t border-[rgba(255,255,255,0.06)] pt-12 text-center pb-8">
      <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-brand-steel mb-8">
        Trusted by the teams pushing AI forward
      </p>
      <div className="flex flex-wrap items-center justify-center gap-x-12 gap-y-8 opacity-50 grayscale transition-all duration-500 hover:grayscale-0 hover:opacity-100">
        <div className="flex items-center gap-2 font-display text-xl font-medium tracking-tight text-white"><Command className="h-5 w-5"/> Acme Corp</div>
        <div className="flex items-center gap-2 font-display text-xl font-bold tracking-tight text-white">Vercel</div>
        <div className="flex items-center gap-2 font-display text-xl italic font-serif text-white">Superhuman</div>
        <div className="flex items-center gap-2 font-display text-xl font-medium text-white">Perplexity</div>
        <div className="flex items-center gap-2 font-display text-xl tracking-widest uppercase text-sm text-white">Linear</div>
      </div>
    </div>
  );
}

export function HomeClient({ stats, featured }: { stats: GlobalStats; featured: Server[] }) {
  const invokable = stats.invokable_servers?.toLocaleString() ?? stats.active_servers.toLocaleString();
  const callsToday = stats.calls_today ? `${Math.max(1, Math.round(stats.calls_today / 1000))}K` : '0';
  const avgTrust = stats.avg_trust_score ? stats.avg_trust_score.toFixed(1) : '0.0';

  return (
    <div className="overflow-x-hidden pb-16">
      {/* ── 1. Hero ── */}
      <section className="page text-center relative z-10 w-full h-screen flex items-center justify-center">
        <div className="mx-auto max-w-4xl flex flex-col items-center">
          
          <h1 className="heading-display max-w-4xl text-[3.5rem] font-medium leading-[0.95] text-white sm:text-[4.5rem] lg:text-[6rem] anim-fadeup drop-shadow-2xl" style={{ animationDelay: '100ms' }}>
            Seamless Intent.<br />
            <span className="text-white">Instant Execution.</span>
          </h1>
          
          <p className="mt-8 max-w-2xl text-lg leading-8 text-brand-steel anim-fadeup" style={{ animationDelay: '200ms' }}>
            Give your agents the power to dynamically discover, verify, and safely invoke remote MCP tools at runtime—no hardcoded menus required.
          </p>

          <div className="mt-10 flex flex-col items-center gap-4 sm:flex-row justify-center anim-fadeup md:w-auto w-full" style={{ animationDelay: '300ms' }}>
            <Link href="/connect" className="btn btn-primary btn-lg w-full md:w-auto shadow-[0_0_30px_rgba(79,70,229,0.3)]">
              Connect your agent
              <ArrowRight className="h-4 w-4" />
            </Link>
            <Link href="/registry" className="btn btn-ghost btn-lg w-full md:w-auto">
              Explore the registry
            </Link>
          </div>
        </div>

        

        {/* <LogoCloud /> */}
      </section>

      {/* ── Stats Section ── */}
      <section className="page py-12 border-b border-[rgba(255,255,255,0.05)] mt-12">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4 divide-y sm:divide-y-0 sm:divide-x divide-[rgba(255,255,255,0.08)] backdrop-blur-md bg-[rgba(255,255,255,0.02)] rounded-3xl border border-[rgba(255,255,255,0.05)]">
          <Metric label="Invokable servers" value={invokable} />
          <Metric label="Verified" value={stats.verified_servers?.toLocaleString() ?? '0'} />
          <Metric label="Calls today" value={callsToday} />
          <Metric label="Avg trust" value={avgTrust} />
        </div>
      </section>

      <section className="page py-16 sm:py-24 border-b border-[rgba(255,255,255,0.05)] flex flex-col items-center">
        
        {/* Section Heading Label */}
        <div className="inline-flex items-center gap-2.5 mb-16 px-3 py-1 rounded-full border border-[rgba(6,182,212,0.2)] bg-[rgba(6,182,212,0.1)] shadow-[0_0_20px_rgba(6,182,212,0.4)] anim-fadeup">
           <div className="w-1.5 h-1.5 rounded-full bg-brand-signal animate-[pulse_2s_infinite]" />
           <span className="text-[11px] font-mono uppercase tracking-[0.2em] text-brand-signal">The Agentrail Flow</span>
        </div>

        {/* Text / Code Block */}
        <div className="w-full max-w-5xl rounded-[24px] border border-[rgba(255,255,255,0.1)] bg-[rgba(255,255,255,0.02)] p-6 sm:p-10 lg:flex lg:items-center lg:justify-between lg:gap-10 backdrop-blur-md relative overflow-hidden mb-16 anim-fadeup" style={{ animationDelay: '100ms' }}>
          <div className="absolute top-0 right-0 w-64 h-64 bg-brand-DEFAULT opacity-10 blur-[100px] pointer-events-none" />
          <div className="lg:w-1/2 relative z-10">
            <h2 className="heading-display text-3xl font-medium leading-tight text-white sm:text-4xl">
              From intent to safe execution.
            </h2>
            <p className="mt-4 text-lg leading-8 text-brand-steel">
              The agent stays focused on business intent. Agentrail natively handles the search surface, the trust checks, the secret injection, and the audit trail.
            </p>
          </div>
          <div className="mt-8 lg:mt-0 lg:w-1/2 relative z-10">
            <pre className="whitespace-pre-wrap font-mono text-[13px] leading-8 text-brand-steel bg-[#030712] p-6 rounded-2xl border border-[rgba(255,255,255,0.06)] shadow-[inset_0_2px_20px_rgba(0,0,0,0.5)]">
              <span className="text-brand-white">1.</span> search_tools("create issue")<br/>
              <span className="text-brand-white">2.</span> Registry returns matching schemas<br/>
              <span className="text-brand-white">3.</span> invoke_tool({`{ server, tool, args }`})<br/>
              <span className="text-brand-white">4.</span> Policy, auth, and DLP proxy runs<br/>
              <span className="text-brand-white">5.</span> Result returned to agent safely
            </pre>
          </div>
        </div>

        {/* Central Orb Simulation */}
        <div className="w-full relative flex justify-center anim-fadeup" style={{ animationDelay: '200ms' }}>
           <HeroOrbital />
        </div>

      </section>

      {/* ── 2. Security Timeline Section ── */}
      <section className="page py-24 border-b border-[rgba(255,255,255,0.05)] text-center overflow-hidden">
         <div className="mx-auto max-w-3xl mb-16 relative z-10">
           <div className="inline-flex items-center justify-center gap-2 mb-4 text-brand-trust font-mono text-[11px] uppercase tracking-[0.18em] shadow-[0_0_20px_rgba(16,185,129,0.4)] px-3 py-1 bg-[rgba(16,185,129,0.1)] rounded-full border border-[rgba(16,185,129,0.2)]">
             <ShieldCheck className="h-4 w-4" /> Runtime Security
           </div>
           <h2 className="heading-display text-[2.5rem] font-medium leading-[1.05] text-white sm:text-[4rem]">
             Govern every invocation.<br />
             <span className="text-brand-steel">Automatically.</span>
           </h2>
           <p className="mt-6 text-lg leading-8 text-brand-steel">
             Discovery is only useful if invocation is safe. Agentrail injects a unified trust layer between your agent and remote MCP tools—handling zero-knowledge credentials, policy validation, and DLP scanning in milliseconds.
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
            <div className="section-label">Why This Matters</div>
            <h2 className="heading-display text-[2.5rem] font-medium leading-[1.05] text-white sm:text-[3.5rem]">
              Hardcoded tools create brittle agents.
            </h2>
          </div>
          <div className="grid gap-8 sm:grid-cols-2">
            {PRINCIPLES.map((item) => {
              const Icon = item.icon;
              return (
                <div key={item.title} className="group p-6 rounded-3xl border border-[rgba(255,255,255,0.05)] bg-[rgba(255,255,255,0.02)] transition-all hover:bg-[rgba(255,255,255,0.05)] hover:border-brand-DEFAULT">
                  <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-[rgba(255,255,255,0.05)] text-brand-signal transition-colors group-hover:bg-brand-DEFAULT group-hover:text-white group-hover:shadow-[0_0_20px_rgba(79,70,229,0.5)]">
                    <Icon className="h-6 w-6" />
                  </div>
                  <h3 className="mt-6 font-display text-2xl font-medium leading-tight text-white">{item.title}</h3>
                  <p className="mt-3 text-sm leading-7 text-brand-steel">{item.description}</p>
                </div>
              );
            })}
          </div>
        </div>

        
      </section>

      {/* Featured Registry Section */}
      {featured.length > 0 && (
        <section className="page py-16 sm:py-24 border-t border-[rgba(255,255,255,0.05)]">
          <div className="mb-12 flex flex-col gap-6 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <div className="section-label">Current Landscape</div>
              <h2 className="heading-display text-[2.5rem] font-medium leading-[1.05] text-white">
                Verified remote tools
              </h2>
              <p className="mt-3 max-w-2xl text-lg leading-7 text-brand-steel">
                A first look at the governed capabilities your agents can discover through Agentrail Cloud today.
              </p>
            </div>
            <Link href="/registry" className="btn btn-ghost">
              Explore registry
              <ArrowRight className="h-4 w-4" />
            </Link>
          </div>

          <div className="grid-2 [&_.card]:bg-[rgba(255,255,255,0.03)] [&_.card]:text-white [&_.card]:border-[rgba(255,255,255,0.08)] [&_.card:hover]:border-[rgba(255,255,255,0.2)]">
            {featured.map((server) => (
              <ServerCard key={server.id} server={server} />
            ))}
          </div>
        </section>
      )}

      {/* ── 4. Upcoming CLI Section ── */}
      <section className="page py-16 sm:py-24 border-t border-[rgba(255,255,255,0.05)] flex justify-center">
          <div className="max-w-4xl w-full rounded-[32px] border border-[rgba(255,255,255,0.1)] bg-[rgba(15,23,42,0.4)] backdrop-blur-xl p-8 sm:p-16 text-center relative overflow-hidden shadow-2xl">
              {/* Decorative background glow */}
              <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-96 h-96 bg-brand-signal opacity-10 blur-[120px] rounded-full pointer-events-none" />
              
              <div className="inline-flex h-14 w-14 items-center justify-center rounded-2xl border border-[rgba(255,255,255,0.1)] bg-[rgba(255,255,255,0.05)] text-white mb-8 relative z-10 shadow-[0_0_20px_rgba(255,255,255,0.1)]">
                 <Terminal className="h-6 w-6" />
              </div>
              <h2 className="heading-display text-[2.5rem] font-medium leading-[1.05] text-white relative z-10 sm:text-[3.5rem]">
                  Agentrail CLI is coming soon.
              </h2>
              <p className="mt-6 text-lg leading-8 text-brand-steel mx-auto max-w-2xl relative z-10">
                  Agentrail Cloud brings governed invocation to the network. The upcoming CLI brings that exact same trust fabric to local <code className="text-[#e2e8f0] bg-[rgba(255,255,255,0.1)] px-2 py-1 rounded font-mono text-sm mx-1">stdio</code> MCP servers. Local testing, universal discovery.
              </p>
          </div>
      </section>

      {/* ── 5. Footer / CTA ── */}
      <section className="page py-16 sm:py-24 border-t border-[rgba(255,255,255,0.05)] relative overflow-hidden">
        <div className="absolute bottom-0 left-1/2 -translate-x-1/2 w-[800px] h-[400px] bg-brand-DEFAULT opacity-10 blur-[150px] pointer-events-none rounded-[100%]" />
        
        <div className="text-center max-w-3xl mx-auto relative z-10">
          <h2 className="heading-display mt-4 text-[3.5rem] font-medium leading-[1.05] text-white sm:text-[5rem] drop-shadow-md">
             Start building <br /> with Agentrail.
          </h2>
          <div className="mt-12 flex flex-col gap-4 sm:flex-row justify-center">
            <Link href="/connect" className="btn btn-primary btn-lg shadow-[0_0_30px_rgba(255,255,255,0.2)]">
              Connect your agent
              <ArrowRight className="h-4 w-4" />
            </Link>
            <a
              href="https://github.com/the-17/openmcp"
              target="_blank"
              rel="noopener"
              className="btn btn-ghost btn-lg"
            >
              View the Source
            </a>
          </div>
        </div>

        <footer className="mt-32 pt-8 border-t border-[rgba(255,255,255,0.08)] flex flex-col gap-6 text-sm text-brand-steel sm:flex-row sm:items-center sm:justify-between relative z-10">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-white text-xs font-black text-black">
              ⇢
            </div>
            <div>
              <div className="font-display text-xl font-medium tracking-tight text-white">Agentrail</div>
              <div className="font-mono text-[10px] uppercase tracking-[0.18em]">by TheSeventeen</div>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-6 font-medium">
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
  );
}
