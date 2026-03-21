'use client';
import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { ServerCard } from '@/components/registry/ServerCard';
import { AgentSimulation } from '@/components/AgentSimulation';
import type { Server, GlobalStats } from '@/types';


/* ── Flow Diagram ───────────────────────────────────────── */
const FLOW = [
  { num: '01', icon: '⬡', label: 'Agent', sub: 'Has task', color: '#9898a8' },
  { num: '02', icon: '🔍', label: 'Registry', sub: 'Search by intent', color: 'var(--accent)' },
  { num: '03', icon: '🛡', label: 'Security', sub: '12 layers active', color: '#3b82f6' },
  { num: '04', icon: '⚡', label: 'Invoke', sub: 'Audited call', color: '#f97316' },
  { num: '05', icon: '✓', label: 'Done', sub: 'Zero config', color: 'var(--accent)' },
];

function FlowDiagram() {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', flexWrap: 'wrap', gap: '4px' }}>
      {FLOW.map((step, i) => (
        <div key={i} style={{ display: 'flex', alignItems: 'center' }}>
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '10px', padding: '0 12px' }}>
            <div style={{
              width: '56px', height: '56px', borderRadius: '14px',
              border: `1px solid ${step.color}30`,
              background: `linear-gradient(135deg, ${step.color}12, ${step.color}06)`,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: '22px',
              position: 'relative',
              boxShadow: `0 0 20px ${step.color}10`,
            }}>
              {step.icon}
              <span style={{
                position: 'absolute', top: '-8px', right: '-8px',
                fontSize: '9px', fontFamily: 'var(--mono)', fontWeight: 700,
                color: step.color, background: 'var(--bg)', border: `1px solid ${step.color}30`,
                padding: '1px 5px', borderRadius: '4px',
              }}>{step.num}</span>
            </div>
            <div style={{ textAlign: 'center' }}>
              <div style={{ fontSize: '13px', fontWeight: 700, color: step.color }}>{step.label}</div>
              <div style={{ fontSize: '11px', color: 'var(--text-3)', maxWidth: '80px', lineHeight: 1.3, marginTop: '2px' }}>{step.sub}</div>
            </div>
          </div>
          {i < FLOW.length - 1 && (
            <div style={{ display: 'flex', alignItems: 'center', marginBottom: '40px' }}>
              <div style={{ width: '12px', height: '1px', background: 'var(--border-2)' }} />
              <svg width="12" height="10" viewBox="0 0 12 10" fill="none" style={{ color: 'var(--border-3)' }}>
                <path d="M7 1L11 5L7 9M1 5H11" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
              <div style={{ width: '12px', height: '1px', background: 'var(--border-2)' }} />
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

/* ── Security layers ─────────────────────────────────────── */
const SEC = [
  { num: 'L1',  title: 'Static Scan',        desc: 'Tool descriptions scanned for prompt injection, exfiltration patterns, and hidden instructions at publish time.',    color: '#ef4444' },
  { num: 'L2',  title: 'WASM Sandbox',        desc: 'Sandboxed pre-listing execution catches runtime behaviors static analysis misses — deferred payloads, error-channel attacks.', color: '#f97316' },
  { num: 'L3',  title: 'Schema Pinning',      desc: 'Tool schemas hashed at publish. Any mutation auto-suspends the server and triggers re-scan. Rug-pull attacks blocked.', color: '#a855f7' },
  { num: 'L4',  title: 'Proxy DLP',           desc: 'Every invocation routes through the proxy. Credential patterns blocked on request and response. Real-time audit log.', color: '#3b82f6' },
  { num: 'L5',  title: 'Trust Score',         desc: 'Dynamic per-server score from scan history, uptime, schema stability, and community signals — returned on every search result.', color: 'var(--accent)' },
  { num: 'L6',  title: 'Database RLS',        desc: 'Supabase Row Level Security enforced at the database layer. App-level bugs cannot leak cross-user data under any circumstance.', color: '#0ea5e9' },
  { num: 'L7',  title: 'OAuth 2.1 + PKCE',   desc: 'Auth handled by Supabase with PKCE enforced on every flow. Blocks confused deputy attacks and consent bypass exploits.', color: '#6366f1' },
  { num: 'L8',  title: 'Typosquatting',       desc: 'pg_trgm fuzzy similarity check at publish time. Names too close to verified servers are rejected before listing.', color: '#ec4899' },
  { num: 'L9',  title: 'Sampling Inspection', desc: 'MCP sampling requests (server-initiated LLM calls) inspected for injection patterns before being forwarded to clients.', color: '#f59e0b' },
  { num: 'L10', title: 'PII Detection',       desc: 'Proxy responses scanned for email addresses, phone numbers, SSNs, and card numbers before being returned to the agent.', color: '#14b8a6' },
  { num: 'L11', title: 'URL Elicitation',     desc: 'MCP elicitation URLs validated before acting on them. Blocks javascript:, data:, file://, localhost redirects, and SSRF attempts.', color: '#84cc16' },
  { num: 'L12', title: 'Context Isolation',   desc: 'Proxy responses scanned for session tokens, bearer tokens, and auth values that could indicate cross-user context leakage.', color: '#f97316' },
];

/* ── OSS Features ────────────────────────────────────────── */
const OSS_FEATURES = [
  {
    icon: (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"/>
      </svg>
    ),
    color: 'var(--accent)',
    title: 'Open source',
    desc: 'MIT licensed. Full source on GitHub. Fork it, self-host it, contribute back.',
  },
  {
    icon: (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/>
        <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
      </svg>
    ),
    color: '#3b82f6',
    title: 'Free forever',
    desc: 'Free forever. No rate limits on core features. No credit card required. No lock-in.',
  },
  {
    icon: (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/>
      </svg>
    ),
    color: '#f97316',
    title: 'Agent-native',
    desc: 'Designed for machine consumption. Clean JSON, semantic search, trust scores on every result.',
  },
];

/* ── Main ───────────────────────────────────────────────── */
function useIsMobile() {
  const [mobile, setMobile] = React.useState(false);
  React.useEffect(() => {
    const check = () => setMobile(window.innerWidth < 768);
    check();
    window.addEventListener('resize', check);
    return () => window.removeEventListener('resize', check);
  }, []);
  return mobile;
}

export function HomeClient({ stats, featured }: { stats: GlobalStats; featured: Server[] }) {
  const isMobile = useIsMobile();
  return (
    <div style={{ overflowX: 'hidden' }}>

      {/* ── HERO ─────────────────────────────────────────── */}
      <section style={{ position: 'relative', minHeight: '92vh', display: 'flex', alignItems: 'center' }}>
        {/* Ambient background layers */}
        <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none', overflow: 'hidden' }}>
          {/* Dot grid */}
          <div style={{
            position: 'absolute', inset: 0,
            backgroundImage: 'radial-gradient(rgba(194,68,12,.07) 1px, transparent 1px)',
            backgroundSize: '28px 28px',
            WebkitMaskImage: 'radial-gradient(ellipse 80% 70% at 50% 0%, black 20%, transparent 75%)', maskImage: 'radial-gradient(ellipse 80% 70% at 50% 0%, black 20%, transparent 75%)',
          }} />
          {/* Top center glow */}
          <div style={{
            position: 'absolute', top: '-120px', left: '50%', transform: 'translateX(-50%)',
            width: '900px', height: '700px',
            background: 'radial-gradient(ellipse, rgba(194,68,12,0.06) 0%, transparent 68%)',
          }} />
          {/* Side glows */}
          <div style={{
            position: 'absolute', top: '20%', left: '-100px',
            width: '400px', height: '400px',
            background: 'radial-gradient(circle, rgba(194,68,12,0.04) 0%, transparent 70%)',
          }} />
          <div style={{
            position: 'absolute', top: '30%', right: '-100px',
            width: '400px', height: '400px',
            background: 'radial-gradient(circle, rgba(194,68,12,0.04) 0%, transparent 70%)',
          }} />
        </div>

        <div className="page" style={{
          display: 'grid',
          gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr',
          gap: isMobile ? '40px' : '64px',
          alignItems: 'center',
          position: 'relative',
          zIndex: 1,
          width: '100%',
        }}>
          {/* Left — Copy */}
          <div style={{ animation: 'slideUp .7s cubic-bezier(.22,1,.36,1) both' }}>
            {/* Pill badge */}
            <div style={{
              display: 'inline-flex', alignItems: 'center', gap: '8px',
              padding: '7px 16px',
              background: 'rgba(194,68,12,0.06)',
              border: '1px solid rgba(194,68,12,0.15)',
              borderRadius: '100px',
              marginBottom: '32px',
              animation: 'fadeIn .5s ease .1s both',
            }}>
              <div className="anim-pulse" style={{ width: '6px', height: '6px', borderRadius: '50%', background: 'var(--accent)', boxShadow: '0 0 8px var(--accent)' }} />
              <span style={{ fontSize: '12px', color: 'var(--accent)', fontFamily: 'var(--mono)', letterSpacing: '0.02em' }}>open source · free forever · MIT</span>
            </div>

            {/* Headline */}
            <h1 className="heading-serif" style={{
              fontWeight: 700,
              fontSize: 'clamp(36px, 5vw, 60px)',
              lineHeight: 1.08,
              letterSpacing: '-0.02em',
              marginBottom: '24px',
              animation: 'slideUp .7s cubic-bezier(.22,1,.36,1) .1s both',
              fontFamily: 'var(--font-lora)',
            }}>
              The secure<br />
              <span style={{
                color: 'var(--accent)',
                textShadow: '0 0 50px rgba(232,103,58,0.3)',
              }}>open MCP</span><br />
              registry.
            </h1>

            {/* Quote + Subheadline */}
            <div style={{
              marginBottom: '40px',
              maxWidth: '480px',
              animation: 'slideUp .7s cubic-bezier(.22,1,.36,1) .2s both',
            }}>
              <div style={{
                borderLeft: '2px solid var(--accent)',
                paddingLeft: '16px',
                marginBottom: '20px',
              }}>
                <p style={{
                  fontSize: '14px',
                  color: 'var(--accent)',
                  fontFamily: 'var(--font-serif)',
                  fontStyle: 'italic',
                  lineHeight: 1.6,
                  opacity: 0.9,
                }}>
                  "Agent development will never scale treating every tool integration as a 1:1 integration."
                </p>
              </div>
              <p style={{
                fontSize: '17px',
                color: 'var(--text-2)',
                lineHeight: 1.7,
              }}>
                Your AI agent can now find and use any tool it needs — automatically. thousands of scanned MCP servers, discovered by intent, invoked through a security proxy. Zero pre-configuration. Always free.
              </p>
            </div>

            {/* CTAs */}
            <div style={{
              display: 'flex', flexDirection: isMobile ? 'column' : 'row', gap: '12px', flexWrap: 'wrap',
              animation: 'slideUp .7s cubic-bezier(.22,1,.36,1) .3s both',
            }}>
              <Link href="/connect" className="btn btn-primary btn-lg" style={{ textDecoration: 'none' }}>
                Connect your agent
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M5 12h14M12 5l7 7-7 7"/>
                </svg>
              </Link>
              <Link href="/registry" className="btn btn-ghost btn-lg" style={{ textDecoration: 'none' }}>Browse registry</Link>
            </div>

            {/* Live stats */}
            <div style={{
              display: 'grid',
              gridTemplateColumns: isMobile ? 'repeat(2, 1fr)' : 'repeat(4, auto)',
              gap: isMobile ? '20px' : '32px',
              marginTop: '56px',
              paddingTop: '40px',
              borderTop: '1px solid var(--border)',
              animation: 'slideUp .7s cubic-bezier(.22,1,.36,1) .4s both',
            }}>
              {[
                { v: stats.invokable_servers?.toLocaleString() ?? stats.active_servers?.toLocaleString() ?? '—', l: 'Invokable Servers' },
                { v: stats.calls_today ? `${(stats.calls_today / 1000).toFixed(0)}K` : '—', l: 'Calls Today' },
                { v: stats.verified_servers?.toLocaleString() ?? '—', l: 'Verified' },
                { v: stats.sources ? `${stats.sources.official + stats.sources.github + stats.sources.smithery}` : '—', l: 'Sources' },
              ].map(s => (
                <div key={s.l}>
                  <div style={{
                    fontSize: '28px', fontWeight: 700,
                    color: 'var(--accent)',
                    fontFamily: 'var(--mono)',
                    letterSpacing: '-0.03em',
                    lineHeight: 1,
                  }}>{s.v}</div>
                  <div style={{
                    fontSize: '11px',
                    color: 'var(--text-3)',
                    textTransform: 'uppercase',
                    letterSpacing: '0.1em',
                    marginTop: '6px',
                    fontWeight: 500,
                  }}>{s.l}</div>
                </div>
              ))}
            </div>
          </div>

          {/* Right — Interactive simulation */}
          <div style={{ animation: 'fadeIn .8s ease .3s both' }}>
            <AgentSimulation />
          </div>
        </div>
      </section>

      {/* ── HOW IT WORKS ──────────────────────────────────── */}
      <section style={{ padding: isMobile ? '60px 24px' : '120px 80px', borderTop: '1px solid var(--border)' }}>
        <div style={{ maxWidth: '900px', margin: '0 auto' }}>
          <div style={{ textAlign: 'center', marginBottom: '64px' }}>
            <div className="section-label" style={{ color: 'var(--accent)', justifyContent: 'center' }}>how it works</div>
            <h2 className="heading-serif" style={{ fontSize: 'clamp(26px,3.5vw,40px)', fontWeight: 700, letterSpacing: '-0.02em', marginBottom: '16px', fontFamily: 'var(--font-lora)' }}>
              One prompt. Every tool.
            </h2>
            <p style={{ color: 'var(--text-2)', fontSize: '16px', maxWidth: '480px', margin: '0 auto', lineHeight: 1.7 }}>
              The alternative to 1:1 tool integrations. One endpoint, queried by intent, invoked through a 15-layer security proxy.
            </p>
          </div>

          {/* Flow diagram */}
          <div style={{
            background: 'var(--bg-1)',
            border: '1px solid var(--border)',
            borderRadius: '20px',
            padding: '48px 24px',
            marginBottom: '48px',
          }}>
            <FlowDiagram />
          </div>

          {/* Prompt snippet */}
          <div className="codeblock">
            <div className="codeblock-header">
              <span style={{ fontSize: '11px', color: 'var(--text-3)', fontFamily: 'var(--mono)' }}>AGENTS.md · your complete MCP configuration</span>
              <span style={{ fontSize: '11px', color: 'var(--accent)', fontFamily: 'var(--mono)' }}>2 lines</span>
            </div>
            <pre>{`## MCP Tools

You have access to the openMCP at https://registry.the-17.dev.
When you need any capability, search: `}<span style={{ color: 'var(--accent)' }}>GET /api/servers/search?q={'{intent}'}</span>{`
Then invoke via:                       `}<span style={{ color: 'var(--accent)' }}>POST /api/proxy/{'{serverName}'}/{'{toolName}'}</span>{`

Never assume a tool doesn't exist. Always search first.`}</pre>
          </div>
        </div>
      </section>

      {/* ── SECURITY ──────────────────────────────────────── */}
      <section style={{
        padding: isMobile ? '60px 24px' : '120px 80px',
        background: 'var(--bg-1)',
        borderTop: '1px solid var(--border)',
        borderBottom: '1px solid var(--border)',
        position: 'relative',
        overflow: 'hidden',
      }}>
        {/* Background decoration */}
        <div style={{
          position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%,-50%)',
          width: '600px', height: '400px',
          background: 'radial-gradient(ellipse, rgba(220,38,38,0.03) 0%, transparent 70%)',
          pointerEvents: 'none',
        }} />

        <div style={{ maxWidth: '1100px', margin: '0 auto', position: 'relative' }}>
          <div style={{ textAlign: 'center', marginBottom: '56px' }}>
            <div className="section-label" style={{ color: 'var(--red)', justifyContent: 'center' }}>security first</div>
            <h2 className="heading-serif" style={{ fontSize: 'clamp(26px,3.5vw,40px)', fontWeight: 700, letterSpacing: '-0.02em', marginBottom: '16px', fontFamily: 'var(--font-lora)' }}>
              12-layer protection stack
            </h2>
            <p style={{ color: 'var(--text-2)', fontSize: '16px', maxWidth: '520px', margin: '0 auto', lineHeight: 1.7 }}>
              1 in 3 public MCP servers have critical vulnerabilities. Every server is scanned, pinned, and monitored from publish time through every proxy call.
            </p>
          </div>

          <div className="grid-4">
            {SEC.map(l => (
              <div key={l.num} className="card" style={{
                padding: '22px 18px',
                position: 'relative',
                overflow: 'hidden',
                cursor: 'default',
              }}>
                {/* Colored top accent bar */}
                <div style={{
                  position: 'absolute', top: 0, left: 0, right: 0, height: '2px',
                  background: `linear-gradient(90deg, ${l.color}, ${l.color}88)`,
                  animation: 'borderPulse 3s ease-in-out infinite',
                }} />
                {/* Layer number */}
                <div style={{
                  fontSize: '11px', fontWeight: 700,
                  color: l.color, fontFamily: 'var(--mono)',
                  background: `${l.color}12`,
                  border: `1px solid ${l.color}25`,
                  borderRadius: '6px',
                  padding: '3px 8px',
                  display: 'inline-block',
                  marginBottom: '12px',
                  letterSpacing: '0.05em',
                }}>{l.num}</div>
                <div style={{ fontSize: '13px', fontWeight: 700, marginBottom: '8px', color: 'var(--text)' }}>{l.title}</div>
                <p style={{ fontSize: '12px', color: 'var(--text-3)', lineHeight: 1.6 }}>{l.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── FEATURED ──────────────────────────────────────── */}
      {featured.length > 0 && (
        <section style={{ padding: isMobile ? '60px 24px' : '120px 80px' }}>
          <div style={{ maxWidth: '1100px', margin: '0 auto' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', marginBottom: '40px' }}>
              <div>
                <div className="section-label" style={{ color: 'var(--accent)' }}>featured</div>
                <h2 className="heading-serif" style={{ fontSize: 'clamp(20px,2.5vw,30px)', fontWeight: 700, letterSpacing: '-0.02em', fontFamily: 'var(--font-lora)' }}>
                  Top verified servers
                </h2>
              </div>
              <Link href="/registry" className="btn btn-ghost btn-sm" style={{ textDecoration: 'none' }}>
                View all
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M5 12h14M12 5l7 7-7 7"/>
                </svg>
              </Link>
            </div>
            <div className="grid-2">
              {featured.map(s => <ServerCard key={s.id} server={s} />)}
            </div>
          </div>
        </section>
      )}

      {/* ── OSS CTA ───────────────────────────────────────── */}
      <section style={{
        padding: isMobile ? '60px 24px' : '120px 80px',
        borderTop: '1px solid var(--border)',
        background: 'var(--bg-1)',
        position: 'relative',
        overflow: 'hidden',
      }}>
        {/* Background glow */}
        <div style={{
          position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%,-50%)',
          width: '700px', height: '500px',
          background: 'radial-gradient(ellipse, rgba(194,68,12,0.04) 0%, transparent 70%)',
          pointerEvents: 'none',
        }} />

        <div style={{ maxWidth: '760px', margin: '0 auto', textAlign: 'center', position: 'relative' }}>
          <div className="section-label" style={{ color: 'var(--accent)', justifyContent: 'center' }}>open ecosystem</div>
          <h2 className="heading-serif" style={{
            fontSize: 'clamp(26px,3.5vw,46px)',
            fontWeight: 700,
            letterSpacing: '-0.02em',
            marginBottom: '16px',
            lineHeight: 1.15,
            fontFamily: 'var(--font-lora)',
          }}>
            Built for the<br /><span style={{ color: 'var(--accent)' }}>open ecosystem</span>
          </h2>
          <p style={{ color: 'var(--text-2)', fontSize: '17px', lineHeight: 1.7, maxWidth: '440px', margin: '0 auto 56px' }}>
            Fully open source. No lock-in. Self-hostable. Developers keep 100% of everything.
          </p>

          <div className="grid-3" style={{ textAlign: 'left', marginBottom: '48px', maxWidth: '860px', margin: '0 auto 48px' }}>
            {OSS_FEATURES.map(f => (
              <div key={f.title} className="card-glass" style={{ padding: '28px 24px' }}>
                <div style={{
                  width: '44px', height: '44px', borderRadius: '12px',
                  background: `${f.color}12`,
                  border: `1px solid ${f.color}25`,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  color: f.color, marginBottom: '18px',
                }}>
                  {f.icon}
                </div>
                <div style={{ fontSize: '15px', fontWeight: 700, marginBottom: '10px', color: 'var(--text)' }}>{f.title}</div>
                <p style={{ fontSize: '13px', color: 'var(--text-2)', lineHeight: 1.65 }}>{f.desc}</p>
              </div>
            ))}
          </div>

          <div style={{ display: 'flex', gap: '12px', justifyContent: 'center' }}>
            <Link href="/publish" className="btn btn-primary btn-lg" style={{ textDecoration: 'none' }}>
              Publish your MCP server
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M5 12h14M12 5l7 7-7 7"/>
              </svg>
            </Link>
            <a
              href="https://github.com/the-17/openmcp"
              target="_blank" rel="noopener"
              className="btn btn-ghost btn-lg"
              style={{ textDecoration: 'none' }}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                <path d="M12 0C5.373 0 0 5.373 0 12c0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23A11.509 11.509 0 0 1 12 5.803c1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576C20.566 21.797 24 17.3 24 12c0-6.627-5.373-12-12-12z"/>
              </svg>
              View on GitHub
            </a>
          </div>
        </div>
      </section>

      {/* ── FOOTER ────────────────────────────────────────── */}
      <footer style={{ borderTop: '1px solid var(--border)', padding: isMobile ? '24px 20px' : '40px 80px' }}>
        <div style={{ maxWidth: '1100px', margin: '0 auto', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '20px' }}>
          {/* Logo */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <div style={{
            width: '24px', height: '24px',
            background: 'linear-gradient(135deg,#e8673a,#c9552e)',
            borderRadius: '6px',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: '12px',
            boxShadow: '0 0 12px rgba(232,103,58,0.25)',
          }}>⬡</div>
            <span style={{ fontWeight: 700, fontSize: '14px', letterSpacing: '-0.02em' }}>openMCP</span>
          </div>

          {/* Links */}
          <div style={{ display: 'flex', gap: '24px', alignItems: 'center' }}>
            {[
              { href: '/registry', label: 'Registry' },
              { href: '/publish', label: 'Publish' },
              { href: 'https://github.com/the-17/openmcp', label: 'GitHub', external: true },
            ].map(l => (
              <a
                key={l.label}
                href={l.href}
                target={l.external ? '_blank' : undefined}
                rel={l.external ? 'noopener' : undefined}
                style={{ fontSize: '13px', color: 'var(--text-3)', textDecoration: 'none', transition: 'color .15s' }}
                onMouseEnter={e => (e.currentTarget as HTMLElement).style.color = 'var(--text-2)'}
                onMouseLeave={e => (e.currentTarget as HTMLElement).style.color = 'var(--text-3)'}
              >{l.label}</a>
            ))}
          </div>

          {/* Legal */}
          <p
            style={{ fontSize: '12px', color: 'var(--text-3)' }}>
            MIT License · Built by <a href="https://github.com/the-17" style={{ color: 'var(--accent)', textDecoration: 'none' }}>The-17</a>
          </p>
        </div>
      </footer>
    </div>
  );
}
