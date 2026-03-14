'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { ServerCard } from '@/components/registry/ServerCard';
import type { Server, GlobalStats } from '@/types';

/* ── Animated Terminal ─────────────────────────────────── */
const LINES = [
  { t: '// host system prompt — the entire MCP config', c: '#333', d: 0 },
  { t: '', c: '', d: 400 },
  { t: 'You have access to the MCP Registry.', c: '#a0a0a0', d: 700 },
  { t: 'When you need any capability, query it first:', c: '#a0a0a0', d: 1100 },
  { t: '  GET /api/servers/search?q={intent}', c: '#22c55e', d: 1500 },
  { t: '', c: '', d: 1900 },
  { t: '> Agent: "charge the user $49 for their plan"', c: '#f0f0f0', d: 2200 },
  { t: '→ search("payments charge subscription")...', c: '#555', d: 2900 },
  { t: '← stripe-payments  trust:97  latency:42ms', c: '#555', d: 3500 },
  { t: '→ connecting via secure proxy...', c: '#555', d: 4100 },
  { t: '← tools ready: charge_card, create_subscription +4', c: '#22c55e', d: 4700 },
  { t: '→ charge_card({ amount: 4900, currency: "usd" })', c: '#22c55e', d: 5300 },
  { t: '', c: '', d: 5800 },
  { t: '✓ ch_3Qx9Av... · $49.00 charged · 44ms', c: '#22c55e', d: 6100 },
];

function Terminal() {
  const [vis, setVis] = useState<number[]>([]);
  const [cur, setCur] = useState(true);

  useEffect(() => {
    let timers: ReturnType<typeof setTimeout>[] = [];
    function start() {
      setVis([]);
      timers = LINES.map((l, i) => setTimeout(() => setVis(v => [...v, i]), l.d));
      timers.push(setTimeout(start, LINES[LINES.length - 1].d + 3000));
    }
    const t = setTimeout(start, 300);
    const blink = setInterval(() => setCur(c => !c), 530);
    return () => { timers.forEach(clearTimeout); clearTimeout(t); clearInterval(blink); };
  }, []);

  return (
    <div style={{ background: '#060606', border: '1px solid #1a1a1a', borderRadius: '12px', overflow: 'hidden', boxShadow: '0 0 80px rgba(34,197,94,.07), 0 32px 64px rgba(0,0,0,.6)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '12px 16px', borderBottom: '1px solid #141414', background: '#080808' }}>
        {['#ef4444','#eab308','#22c55e'].map(c => <div key={c} style={{ width: '10px', height: '10px', borderRadius: '50%', background: c }} />)}
        <span style={{ marginLeft: '10px', fontSize: '11px', color: '#333', fontFamily: 'var(--mono)' }}>agent-runtime · mcp-registry · live</span>
        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: '4px' }}>
          <div className="anim-pulse" style={{ width: '6px', height: '6px', borderRadius: '50%', background: '#22c55e' }} />
          <span style={{ fontSize: '10px', color: '#22c55e', fontFamily: 'var(--mono)' }}>connected</span>
        </div>
      </div>
      <div style={{ padding: '20px 24px', minHeight: '280px', fontFamily: 'var(--mono)', fontSize: '12.5px', lineHeight: 1.9 }}>
        {LINES.map((line, i) => (
          <div key={i} style={{ opacity: vis.includes(i) ? 1 : 0, transition: 'opacity .3s', color: line.c || 'transparent', height: line.t === '' ? '10px' : 'auto' }}>
            {line.t}
          </div>
        ))}
        <span style={{ opacity: cur ? 1 : 0, color: '#22c55e', transition: 'opacity .1s' }}>▋</span>
      </div>
      {vis.includes(LINES.length - 1) && (
        <div style={{ margin: '0 24px 20px', padding: '10px 14px', background: '#052e16', border: '1px solid #166534', borderRadius: '6px', fontFamily: 'var(--mono)', fontSize: '12px', color: '#86efac', animation: 'fadeIn .3s ease' }}>
          ✓ Payment processed · agent never saw the API key · fully audited
        </div>
      )}
    </div>
  );
}

/* ── Flow Diagram ───────────────────────────────────────── */
const FLOW = [
  { icon: '⬡', label: 'Agent', sub: 'Has task', color: '#a0a0a0' },
  { icon: '🔍', label: 'Registry', sub: 'Search by intent', color: '#22c55e' },
  { icon: '🛡', label: 'Security', sub: 'Scan · Trust · Proxy', color: '#3b82f6' },
  { icon: '⚡', label: 'Invoke', sub: 'Audited call', color: '#f97316' },
  { icon: '✓', label: 'Done', sub: 'Zero config', color: '#22c55e' },
];

function FlowDiagram() {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', flexWrap: 'wrap' }}>
      {FLOW.map((step, i) => (
        <div key={i} style={{ display: 'flex', alignItems: 'center' }}>
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '8px', padding: '0 8px' }}>
            <div style={{ width: '52px', height: '52px', borderRadius: '12px', border: `1px solid ${step.color}44`, background: `${step.color}11`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '20px' }}>{step.icon}</div>
            <div style={{ textAlign: 'center' }}>
              <div style={{ fontSize: '13px', fontWeight: 700, color: step.color }}>{step.label}</div>
              <div style={{ fontSize: '11px', color: 'var(--text-3)', maxWidth: '80px', lineHeight: 1.3 }}>{step.sub}</div>
            </div>
          </div>
          {i < FLOW.length - 1 && (
            <div style={{ display: 'flex', alignItems: 'center', marginBottom: '34px', color: 'var(--text-3)' }}>
              <div style={{ width: '20px', height: '1px', background: 'var(--border-2)' }} />
              <span style={{ fontSize: '12px' }}>→</span>
              <div style={{ width: '20px', height: '1px', background: 'var(--border-2)' }} />
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

/* ── Security layers ─────────────────────────────────────── */
const SEC = [
  { num: 'L1', title: 'Static Scan', desc: 'Tool descriptions scanned for prompt injection, exfiltration patterns, and hidden instructions before listing.', color: '#ef4444' },
  { num: 'L2', title: 'WASM Sandbox', desc: 'Sandboxed pre-listing execution catches runtime behaviors static analysis misses — deferred payloads, error-channel attacks.', color: '#f97316' },
  { num: 'L3', title: 'Schema Pinning', desc: 'Tool schemas hashed at publish. Any mutation triggers auto-suspension and re-scan. Rug-pull attacks blocked.', color: '#a855f7' },
  { num: 'L4', title: 'Proxy DLP', desc: 'All invocations route through our proxy. Real-time DLP scanning of payloads. Credentials never touch agent memory.', color: '#3b82f6' },
  { num: 'L5', title: 'Trust Score', desc: 'Dynamic per-server score from scan history, uptime, schema stability, and community signals returned on every search.', color: '#22c55e' },
];

/* ── Main ───────────────────────────────────────────────── */
export function HomeClient({ stats, featured }: { stats: GlobalStats; featured: Server[] }) {
  return (
    <div style={{ overflowX: 'hidden' }}>

      {/* ── HERO ─────────────────────────────────────────── */}
      <section style={{ position: 'relative', minHeight: '88vh', display: 'flex', alignItems: 'center' }}>
        {/* Grid bg */}
        <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none', backgroundImage: 'linear-gradient(rgba(34,197,94,.04) 1px,transparent 1px),linear-gradient(90deg,rgba(34,197,94,.04) 1px,transparent 1px)', backgroundSize: '40px 40px', maskImage: 'radial-gradient(ellipse at 50% 0%,black 30%,transparent 80%)' }} />
        <div style={{ position: 'absolute', top: '-200px', left: '50%', transform: 'translateX(-50%)', width: '800px', height: '600px', background: 'radial-gradient(ellipse,rgba(34,197,94,.07) 0%,transparent 70%)', pointerEvents: 'none' }} />

        <div className="page" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '64px', alignItems: 'center', position: 'relative', zIndex: 1 }}>
          <div>
            {/* Badge */}
            <div style={{ display: 'inline-flex', alignItems: 'center', gap: '8px', padding: '6px 14px', background: 'var(--green-bg)', border: '1px solid #166534', borderRadius: '20px', marginBottom: '28px' }}>
              <div className="anim-pulse" style={{ width: '6px', height: '6px', borderRadius: '50%', background: 'var(--green)' }} />
              <span style={{ fontSize: '12px', color: 'var(--green)', fontFamily: 'var(--mono)' }}>open source · free forever · MIT</span>
            </div>

            <h1 style={{ fontWeight: 800, fontSize: 'clamp(36px,5vw,58px)', lineHeight: 1.05, letterSpacing: '-0.03em', marginBottom: '24px' }}>
              The universal<br />
              <span style={{ color: 'var(--green)', textShadow: '0 0 40px rgba(34,197,94,.3)' }}>MCP registry</span><br />
              for AI agents.
            </h1>

            <p style={{ fontSize: '17px', color: 'var(--text-2)', lineHeight: 1.65, marginBottom: '36px', maxWidth: '460px' }}>
              Publish your MCP server once. Let any AI agent discover and invoke it at runtime — zero hardcoded connections, built-in security scanning.
            </p>

            <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
              <Link href="/registry" className="btn btn-primary btn-lg" style={{ textDecoration: 'none' }}>Browse Registry →</Link>
              <Link href="/publish" className="btn btn-ghost btn-lg" style={{ textDecoration: 'none' }}>Publish your MCP</Link>
            </div>

            {/* Live stats */}
            <div style={{ display: 'flex', gap: '32px', marginTop: '48px', flexWrap: 'wrap' }}>
              {[
                { v: stats.active_servers?.toLocaleString() ?? '—', l: 'Active Servers' },
                { v: stats.calls_today ? `${(stats.calls_today / 1000).toFixed(0)}K` : '—', l: 'Calls Today' },
                { v: stats.verified_servers?.toLocaleString() ?? '—', l: 'Verified' },
              ].map(s => (
                <div key={s.l}>
                  <div style={{ fontSize: '26px', fontWeight: 800, color: 'var(--green)', fontFamily: 'var(--mono)', letterSpacing: '-0.02em' }}>{s.v}</div>
                  <div style={{ fontSize: '11px', color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '0.08em', marginTop: '2px' }}>{s.l}</div>
                </div>
              ))}
            </div>
          </div>

          <div className="anim-float"><Terminal /></div>
        </div>
      </section>

      {/* ── HOW IT WORKS ──────────────────────────────────── */}
      <section style={{ padding: '80px 24px', borderTop: '1px solid var(--border)' }}>
        <div style={{ maxWidth: '900px', margin: '0 auto' }}>
          <div style={{ textAlign: 'center', marginBottom: '56px' }}>
            <div style={{ fontSize: '11px', color: 'var(--green)', fontFamily: 'var(--mono)', textTransform: 'uppercase', letterSpacing: '0.15em', marginBottom: '12px' }}>how it works</div>
            <h2 style={{ fontSize: '36px', fontWeight: 800, letterSpacing: '-0.02em' }}>One prompt. Every tool.</h2>
            <p style={{ color: 'var(--text-2)', marginTop: '12px', fontSize: '15px' }}>Agents discover and invoke any MCP server dynamically — no pre-configuration needed.</p>
          </div>
          <FlowDiagram />

          {/* Prompt snippet */}
          <div style={{ marginTop: '56px' }} className="codeblock">
            <div className="codeblock-header">
              <span style={{ fontSize: '11px', color: 'var(--text-3)', fontFamily: 'var(--mono)' }}>AGENTS.md · your complete MCP configuration</span>
              <span style={{ fontSize: '11px', color: 'var(--green)', fontFamily: 'var(--mono)' }}>2 lines</span>
            </div>
            <pre>{`## MCP Tools

You have access to the MCP Registry at https://registry.the-17.dev.
When you need any capability, search: `}<span style={{ color: '#22c55e' }}>GET /api/servers/search?q={'{'+'intent'+'}'}</span>{`
Then invoke via:                       `}<span style={{ color: '#22c55e' }}>POST /api/proxy/{'{serverName}'}/{'{toolName}'}</span>{`

Never assume a tool doesn't exist. Always search first.`}</pre>
          </div>
        </div>
      </section>

      {/* ── SECURITY ──────────────────────────────────────── */}
      <section style={{ padding: '80px 24px', background: 'var(--bg-1)', borderTop: '1px solid var(--border)', borderBottom: '1px solid var(--border)' }}>
        <div style={{ maxWidth: '1100px', margin: '0 auto' }}>
          <div style={{ textAlign: 'center', marginBottom: '48px' }}>
            <div style={{ fontSize: '11px', color: 'var(--red)', fontFamily: 'var(--mono)', textTransform: 'uppercase', letterSpacing: '0.15em', marginBottom: '12px' }}>security first</div>
            <h2 style={{ fontSize: '36px', fontWeight: 800, letterSpacing: '-0.02em' }}>5-layer protection stack</h2>
            <p style={{ color: 'var(--text-2)', marginTop: '12px', fontSize: '15px', maxWidth: '500px', margin: '12px auto 0' }}>
              1 in 3 public MCP servers have critical vulnerabilities. Every server is scanned, sandboxed, and continuously monitored.
            </p>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5,1fr)', gap: '12px' }}>
            {SEC.map(l => (
              <div key={l.num} className="card" style={{ padding: '20px 16px', position: 'relative', overflow: 'hidden' }}>
                <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: '2px', background: l.color }} />
                <div style={{ fontSize: '22px', fontWeight: 800, color: l.color, fontFamily: 'var(--mono)', marginBottom: '10px' }}>{l.num}</div>
                <div style={{ fontSize: '13px', fontWeight: 700, marginBottom: '8px' }}>{l.title}</div>
                <p style={{ fontSize: '12px', color: 'var(--text-3)', lineHeight: 1.5 }}>{l.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── FEATURED ──────────────────────────────────────── */}
      {featured.length > 0 && (
        <section style={{ padding: '80px 24px' }}>
          <div style={{ maxWidth: '1100px', margin: '0 auto' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', marginBottom: '32px' }}>
              <div>
                <div style={{ fontSize: '11px', color: 'var(--green)', fontFamily: 'var(--mono)', textTransform: 'uppercase', letterSpacing: '0.15em', marginBottom: '8px' }}>featured</div>
                <h2 style={{ fontSize: '28px', fontWeight: 800, letterSpacing: '-0.02em' }}>Top verified servers</h2>
              </div>
              <Link href="/registry" className="btn btn-ghost btn-sm" style={{ textDecoration: 'none' }}>View all →</Link>
            </div>
            <div className="grid-2">
              {featured.map(s => <ServerCard key={s.id} server={s} />)}
            </div>
          </div>
        </section>
      )}

      {/* ── OSS CTA ───────────────────────────────────────── */}
      <section style={{ padding: '80px 24px', borderTop: '1px solid var(--border)', background: 'var(--bg-1)' }}>
        <div style={{ maxWidth: '860px', margin: '0 auto', textAlign: 'center' }}>
          <h2 style={{ fontSize: '36px', fontWeight: 800, letterSpacing: '-0.02em', marginBottom: '16px' }}>Built for the open ecosystem</h2>
          <p style={{ color: 'var(--text-2)', fontSize: '16px', marginBottom: '48px', lineHeight: 1.65 }}>
            Fully open source. No lock-in. Self-hostable. Developers keep 100% of everything.
          </p>
          <div className="grid-3" style={{ textAlign: 'left', marginBottom: '40px' }}>
            {[
              { icon: '📦', title: 'Open source', desc: 'MIT licensed. Full source on GitHub. Fork it, self-host it, contribute.' },
              { icon: '🔓', title: 'Free forever', desc: 'No freemium traps. The core registry, search, and proxy are always free.' },
              { icon: '⚡', title: 'Agent-native', desc: 'Designed for machine consumption. Clean JSON, semantic search, trust scores on every result.' },
            ].map(f => (
              <div key={f.title} className="card" style={{ padding: '24px' }}>
                <div style={{ fontSize: '28px', marginBottom: '12px' }}>{f.icon}</div>
                <div style={{ fontSize: '15px', fontWeight: 700, marginBottom: '8px' }}>{f.title}</div>
                <p style={{ fontSize: '13px', color: 'var(--text-2)', lineHeight: 1.55 }}>{f.desc}</p>
              </div>
            ))}
          </div>
          <div style={{ display: 'flex', gap: '12px', justifyContent: 'center' }}>
            <Link href="/publish" className="btn btn-primary btn-lg" style={{ textDecoration: 'none' }}>Publish your MCP server →</Link>
            <a href="https://github.com/the-17/mcp-registry" target="_blank" rel="noopener" className="btn btn-ghost btn-lg" style={{ textDecoration: 'none' }}>View on GitHub</a>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer style={{ borderTop: '1px solid var(--border)', padding: '32px 24px', textAlign: 'center' }}>
        <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '10px', marginBottom: '12px' }}>
          <div style={{ width: '22px', height: '22px', background: 'linear-gradient(135deg,#22c55e,#16a34a)', borderRadius: '5px', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '11px' }}>⬡</div>
          <span style={{ fontWeight: 700 }}>mcpregistry</span>
        </div>
        <p style={{ fontSize: '12px', color: 'var(--text-3)' }}>
          Open source · Built by <a href="https://github.com/the-17" style={{ color: 'var(--green)', textDecoration: 'none' }}>The-17</a> · MIT License
        </p>
      </footer>
    </div>
  );
}
