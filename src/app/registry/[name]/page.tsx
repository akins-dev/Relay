'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useAuth } from '@/components/AuthProvider';
import type { Server } from '@/types';

export default function ServerDetailPage() {
  const { name } = useParams<{ name: string }>();
  const { user } = useAuth();  // no token — Supabase uses cookies
  const [server,  setServer]  = useState<Server | null>(null);
  const [scans,   setScans]   = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [starred, setStarred] = useState(false);
  const [tab,     setTab]     = useState<'overview'|'tools'|'security'|'integrate'>('overview');
  const [copied,  setCopied]  = useState('');

  useEffect(() => {
    // cookies sent automatically — no Authorization header needed
    fetch(`/api/servers/${name}`)
      .then(r => r.json())
      .then(d => { setServer(d); setScans(d.scans || []); setStarred(d.starred); setLoading(false); })
      .catch(() => setLoading(false));
  }, [name]);

  async function toggleStar() {
    if (!user || !server) return;
    const res = await fetch(`/api/servers/${server.name}/star`, { method: 'POST' }).then(r => r.json());
    setStarred(res.starred);
    setServer(s => s ? { ...s, stars: s.stars + (res.starred ? 1 : -1) } : s);
  }

  function copy(text: string, key: string) {
    navigator.clipboard?.writeText(text);
    setCopied(key);
    setTimeout(() => setCopied(''), 2000);
  }

  if (loading) return (
    <div style={{ display: 'flex', justifyContent: 'center', padding: '80px' }}>
      <div className="anim-spin" style={{ width: '24px', height: '24px', border: '2px solid var(--border)', borderTopColor: 'var(--green)', borderRadius: '50%' }} />
    </div>
  );
  if (!server) return (
    <div className="page-sm" style={{ textAlign: 'center', paddingTop: '80px', color: 'var(--text-2)' }}>
      Server not found. <Link href="/registry" style={{ color: 'var(--green)' }}>Back to registry</Link>
    </div>
  );

  const trustColor = server.trust_score >= 90 ? 'var(--green)' : server.trust_score >= 70 ? 'var(--yellow)' : 'var(--red)';
  const authorName = (server as any).profiles?.username ?? (server as any).author_name ?? 'unknown';

  const promptSnippet = `## MCP Tools — ${server.display_name}

POST /api/proxy/${server.name}/{toolName}
Available tools: ${server.tools.join(', ')}

Or auto-discover: GET /api/servers/search?q=${server.tags?.[0] ?? server.name}`;

  const curlSnippet = `curl -X POST https://registry.the-17.dev/api/proxy/${server.name}/${server.tools[0] ?? 'tool_name'} \\
  -H "Content-Type: application/json" \\
  -d '{"param": "value"}'`;

  return (
    <div className="page" style={{ maxWidth: '960px' }}>
      {/* Breadcrumb */}
      <div style={{ fontSize: '12px', color: 'var(--text-3)', marginBottom: '24px', fontFamily: 'var(--mono)', display: 'flex', gap: '8px' }}>
        <Link href="/registry" style={{ color: 'var(--text-3)', textDecoration: 'none' }}>registry</Link>
        <span>/</span>
        <span style={{ color: 'var(--text)' }}>{server.name}</span>
      </div>

      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '28px', flexWrap: 'wrap', gap: '16px' }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '8px', flexWrap: 'wrap' }}>
            <h1 style={{ fontSize: '28px', fontWeight: 800, letterSpacing: '-0.02em', fontFamily: 'var(--mono)' }}>{server.name}</h1>
            {server.verified && <span className="badge badge-green">✓ verified</span>}
            <span style={{ fontSize: '12px', color: 'var(--text-3)', fontFamily: 'var(--mono)' }}>v{server.version}</span>
          </div>
          <p style={{ color: 'var(--text-2)', fontSize: '15px', maxWidth: '540px', lineHeight: 1.6 }}>{server.description}</p>
          <div style={{ display: 'flex', gap: '6px', marginTop: '12px', flexWrap: 'wrap' }}>
            {server.tags.map(t => (
              <Link key={t} href={`/registry?tag=${t}`} style={{ textDecoration: 'none' }}>
                <span className="tag tag-default">{t}</span>
              </Link>
            ))}
          </div>
        </div>
        <div style={{ display: 'flex', gap: '8px' }}>
          <button onClick={toggleStar} className={`btn ${starred ? 'btn-primary' : 'btn-ghost'}`}>
            ★ {server.stars?.toLocaleString()}
          </button>
          {server.github_url && (
            <a href={server.github_url} target="_blank" rel="noopener" className="btn btn-ghost" style={{ textDecoration: 'none' }}>GitHub →</a>
          )}
        </div>
      </div>

      {/* Stats bar */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5,1fr)', gap: '1px', background: 'var(--border)', border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)', overflow: 'hidden', marginBottom: '32px' }}>
        {[
          { label: 'Trust',   value: `${Math.round(server.trust_score)}`,                  unit: '/100', color: trustColor },
          { label: 'Latency', value: `${server.latency_ms ?? '—'}`,                        unit: 'ms' },
          { label: 'Uptime',  value: `${Number(server.uptime_pct)?.toFixed(2) ?? '—'}`,    unit: '%' },
          { label: 'Today',   value: `${((server.calls_today ?? 0) / 1000).toFixed(1)}`,   unit: 'K calls' },
          { label: 'Total',   value: `${((server.total_calls ?? 0) / 1000).toFixed(0)}`,   unit: 'K calls' },
        ].map(s => (
          <div key={s.label} style={{ background: 'var(--bg-1)', padding: '16px 20px', textAlign: 'center' }}>
            <div style={{ fontSize: '22px', fontWeight: 800, fontFamily: 'var(--mono)', color: (s as any).color ?? 'var(--text)', letterSpacing: '-0.02em' }}>
              {s.value}<span style={{ fontSize: '12px', color: 'var(--text-3)', fontWeight: 400 }}>{s.unit}</span>
            </div>
            <div style={{ fontSize: '10px', color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '0.08em', marginTop: '4px' }}>{s.label}</div>
          </div>
        ))}
      </div>

      {/* Tabs */}
      <div style={{ borderBottom: '1px solid var(--border)', marginBottom: '28px', display: 'flex' }}>
        {(['overview','tools','security','integrate'] as const).map(t => (
          <button key={t} onClick={() => setTab(t)} style={{ background: 'none', border: 'none', borderBottom: tab === t ? '2px solid var(--green)' : '2px solid transparent', color: tab === t ? 'var(--text)' : 'var(--text-3)', padding: '10px 18px', cursor: 'pointer', fontSize: '13px', fontFamily: 'var(--font)', fontWeight: tab === t ? 600 : 400, textTransform: 'capitalize', transition: 'color .15s' }}>
            {t}
          </button>
        ))}
      </div>

      {/* Overview */}
      {tab === 'overview' && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 270px', gap: '20px' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            {server.long_description && (
              <div className="card" style={{ padding: '22px' }}>
                <div style={{ fontSize: '11px', color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '12px' }}>About</div>
                <p style={{ fontSize: '14px', lineHeight: 1.7, color: 'var(--text-2)' }}>{server.long_description}</p>
              </div>
            )}
            <div className="card" style={{ padding: '22px' }}>
              <div style={{ fontSize: '11px', color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '14px' }}>Tools ({server.tools.length})</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
                {server.tools.map(t => (
                  <span key={t} style={{ background: 'var(--bg-3)', border: '1px solid var(--border)', borderRadius: '6px', padding: '4px 12px', fontFamily: 'var(--mono)', fontSize: '12px', color: 'var(--green)' }}>
                    fn {t}()
                  </span>
                ))}
              </div>
            </div>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
            <div className="card" style={{ padding: '18px' }}>
              <div style={{ fontSize: '11px', color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '12px' }}>Details</div>
              {[['Author', authorName], ['License', server.license], ['Version', server.version]].map(([l, v]) => (
                <div key={l} style={{ display: 'flex', justifyContent: 'space-between', padding: '7px 0', borderBottom: '1px solid var(--border)', fontSize: '12px' }}>
                  <span style={{ color: 'var(--text-3)' }}>{l}</span><span>{v}</span>
                </div>
              ))}
            </div>
            <div className="card" style={{ padding: '18px' }}>
              <div style={{ fontSize: '11px', color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '10px' }}>Scan</div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <div style={{ width: '8px', height: '8px', borderRadius: '50%', background: server.scan_status === 'passed' ? 'var(--green)' : 'var(--red)' }} />
                <span style={{ fontSize: '13px', fontFamily: 'var(--mono)', color: server.scan_status === 'passed' ? 'var(--green)' : 'var(--red)' }}>{server.scan_status}</span>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Tools */}
      {tab === 'tools' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {server.tools.map(tool => (
            <div key={tool} className="card" style={{ padding: '16px 20px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div style={{ fontFamily: 'var(--mono)', fontSize: '14px' }}>
                <span style={{ color: 'var(--green)' }}>fn </span>{tool}()
              </div>
              <button onClick={() => copy(`POST /api/proxy/${server.name}/${tool}`, tool)} className="btn btn-ghost btn-sm" style={{ fontFamily: 'var(--mono)', fontSize: '11px' }}>
                {copied === tool ? '✓ copied' : 'copy endpoint'}
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Security */}
      {tab === 'security' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          {scans.length === 0
            ? <div style={{ textAlign: 'center', padding: '40px', color: 'var(--text-3)' }}>No scan data available</div>
            : scans.map((scan, i) => (
                <div key={i} className="card" style={{ padding: '20px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
                    <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                      <span style={{ fontFamily: 'var(--mono)', fontSize: '12px', color: 'var(--text-3)' }}>{scan.scan_type}</span>
                      <span className={`badge ${scan.passed ? 'badge-green' : 'badge-red'}`}>{scan.passed ? 'passed' : 'failed'}</span>
                      {scan.score != null && <span style={{ fontSize: '11px', color: 'var(--text-3)', fontFamily: 'var(--mono)' }}>score: {scan.score}/100</span>}
                    </div>
                    {/* Supabase returns ISO strings, not Unix timestamps */}
                    <span style={{ fontSize: '11px', color: 'var(--text-3)', fontFamily: 'var(--mono)' }}>
                      {new Date(scan.created_at).toLocaleDateString()}
                    </span>
                  </div>
                  {scan.details && <p style={{ fontSize: '13px', color: 'var(--text-2)', marginBottom: scan.issues?.length ? '12px' : 0 }}>{scan.details}</p>}
                  {(scan.issues ?? []).map((issue: any, j: number) => (
                    <div key={j} style={{ padding: '8px 12px', marginTop: '6px', borderRadius: '6px', fontSize: '12px', background: issue.severity === 'critical' ? 'var(--red-bg)' : 'var(--orange-bg)', border: `1px solid ${issue.severity === 'critical' ? '#7f1d1d' : '#7c2d12'}`, display: 'flex', gap: '8px' }}>
                      <span style={{ fontFamily: 'var(--mono)', fontWeight: 700, fontSize: '10px', textTransform: 'uppercase', color: issue.severity === 'critical' ? 'var(--red)' : 'var(--orange)', flexShrink: 0 }}>{issue.severity}</span>
                      <span style={{ color: 'var(--text-2)' }}>{issue.description}</span>
                    </div>
                  ))}
                </div>
              ))
          }
        </div>
      )}

      {/* Integrate */}
      {tab === 'integrate' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '18px' }}>
          {[
            { title: 'System Prompt / AGENTS.md', key: 'prompt', code: promptSnippet, color: 'var(--text-2)' },
            { title: 'cURL',                      key: 'curl',   code: curlSnippet,   color: 'var(--green)' },
          ].map(({ title, key, code, color }) => (
            <div key={key} className="codeblock">
              <div className="codeblock-header">
                <span style={{ fontSize: '13px', fontWeight: 600 }}>{title}</span>
                <button onClick={() => copy(code, key)} className="btn btn-ghost btn-sm">{copied === key ? '✓ Copied' : 'Copy'}</button>
              </div>
              <pre style={{ color }}>{code}</pre>
            </div>
          ))}
          <div className="card" style={{ padding: '22px' }}>
            <div style={{ fontSize: '13px', fontWeight: 700, marginBottom: '14px' }}>Endpoint Reference</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {server.tools.map(t => (
                <div key={t} style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '10px 14px', background: 'var(--bg-2)', borderRadius: '6px', border: '1px solid var(--border)' }}>
                  <span style={{ fontSize: '10px', fontFamily: 'var(--mono)', color: '#000', background: 'var(--green)', padding: '2px 6px', borderRadius: '3px', fontWeight: 700 }}>POST</span>
                  <span style={{ fontFamily: 'var(--mono)', fontSize: '13px' }}>/api/proxy/{server.name}/{t}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
