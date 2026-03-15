'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useAuth } from '@/components/AuthProvider';

export default function PublishPage() {
  const { user, loading } = useAuth();
  const router = useRouter();
  const [form, setForm] = useState({ name: '', display_name: '', description: '', long_description: '', endpoint: '', version: '1.0.0', github_url: '', license: 'MIT', tags: '', tools: '' });
  const [result,     setResult]     = useState<any>(null);
  const [error,      setError]      = useState('');
  const [submitting, setSubmitting] = useState(false);

  function set(k: string, v: string) { setForm(f => ({ ...f, [k]: v })); }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!user) { router.push('/login'); return; }
    setSubmitting(true); setError('');
    try {
      const res = await fetch('/api/servers', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...form, tags: form.tags.split(',').map(t => t.trim()).filter(Boolean), tools: form.tools.split(',').map(t => t.trim()).filter(Boolean) }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Publish failed');
      setResult(data);
      if (data.status === 'active') setTimeout(() => router.push(`/registry/${form.name}`), 2000);
    } catch (e: any) { setError(e.message); }
    finally { setSubmitting(false); }
  }

  if (loading) return <div style={{ display: 'flex', justifyContent: 'center', padding: '80px' }}><div className="anim-spin" style={{ width: '24px', height: '24px', border: '2px solid var(--border)', borderTopColor: 'var(--green)', borderRadius: '50%' }} /></div>;
  if (!user) return <div className="page-xs" style={{ textAlign: 'center', paddingTop: '80px' }}><p style={{ color: 'var(--text-2)', marginBottom: '20px' }}>Sign in to publish a server.</p><Link href="/login" className="btn btn-primary" style={{ textDecoration: 'none' }}>Sign in →</Link></div>;

  if (result) return (
    <div className="page-sm">
      <div className="card" style={{ padding: '40px', textAlign: 'center' }}>
        <div style={{ width: '56px', height: '56px', borderRadius: '50%', background: result.status === 'active' ? 'var(--green-bg)' : 'var(--red-bg)', border: `2px solid ${result.status === 'active' ? 'var(--green)' : 'var(--red)'}`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '24px', margin: '0 auto 20px' }}>
          {result.status === 'active' ? '✓' : '✕'}
        </div>
        <h2 style={{ fontSize: '22px', fontWeight: 700, marginBottom: '10px' }}>{result.status === 'active' ? 'Server Published!' : 'Scan Failed'}</h2>
        <p style={{ color: 'var(--text-2)', fontSize: '14px', marginBottom: '24px' }}>{result.scan?.details}</p>
        {result.scan?.issues?.length > 0 && (
          <div style={{ textAlign: 'left', marginBottom: '24px', display: 'flex', flexDirection: 'column', gap: '6px' }}>
            {result.scan.issues.map((issue: any, i: number) => (
              <div key={i} style={{ padding: '8px 12px', borderRadius: '6px', fontSize: '12px', background: issue.severity === 'critical' ? 'var(--red-bg)' : 'var(--orange-bg)', border: `1px solid ${issue.severity === 'critical' ? '#7f1d1d' : '#7c2d12'}`, display: 'flex', gap: '8px' }}>
                <span style={{ fontFamily: 'var(--mono)', fontWeight: 700, fontSize: '10px', textTransform: 'uppercase', color: issue.severity === 'critical' ? 'var(--red)' : 'var(--orange)' }}>{issue.severity}</span>
                <span style={{ color: 'var(--text-2)' }}>{issue.description}</span>
              </div>
            ))}
          </div>
        )}
        <div style={{ display: 'flex', gap: '10px', justifyContent: 'center' }}>
          {result.status === 'active'
            ? <Link href={`/registry/${form.name}`} className="btn btn-primary" style={{ textDecoration: 'none' }}>View Server →</Link>
            : <button onClick={() => setResult(null)} className="btn btn-primary">Fix & Resubmit</button>
          }
          <button onClick={() => setResult(null)} className="btn btn-ghost">Publish Another</button>
        </div>
      </div>
    </div>
  );

  const fld = { display: 'flex' as const, flexDirection: 'column' as const, gap: '6px' };
  const lbl = { fontSize: '11px', color: 'var(--text-2)', fontWeight: 600, textTransform: 'uppercase' as const, letterSpacing: '0.06em' };

  return (
    <div className="page-sm">
      <div style={{ marginBottom: '36px' }}>
        <h1 style={{ fontSize: '32px', fontWeight: 800, letterSpacing: '-0.02em', marginBottom: '8px' }}>Publish a Server</h1>
        <p style={{ color: 'var(--text-2)', fontSize: '15px' }}>Your server will be scanned for security issues before going live.</p>
      </div>
      <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
        <div className="card" style={{ padding: '24px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
          <div style={{ fontSize: '11px', color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 700 }}>Basic Info</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px' }}>
            <div style={fld}><label style={lbl}>Server name *</label><input className="input" placeholder="my-mcp-server" value={form.name} onChange={e => set('name', e.target.value)} required pattern="[a-z0-9-]+" /><span style={{ fontSize: '11px', color: 'var(--text-3)' }}>Lowercase + hyphens only</span></div>
            <div style={fld}><label style={lbl}>Display name *</label><input className="input" placeholder="My MCP Server" value={form.display_name} onChange={e => set('display_name', e.target.value)} required /></div>
          </div>
          <div style={fld}><label style={lbl}>Short description * ({form.description.length}/500)</label><textarea className="input" placeholder="What does this server do? Be specific." rows={2} value={form.description} onChange={e => set('description', e.target.value)} required minLength={20} maxLength={500} /></div>
          <div style={fld}><label style={lbl}>Long description</label><textarea className="input" placeholder="Full description, use cases, examples…" rows={3} value={form.long_description} onChange={e => set('long_description', e.target.value)} /></div>
        </div>

        <div className="card" style={{ padding: '24px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
          <div style={{ fontSize: '11px', color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 700 }}>Technical</div>
          <div style={fld}><label style={lbl}>Endpoint URL *</label><input className="input" type="url" placeholder="https://your-server.example.com" value={form.endpoint} onChange={e => set('endpoint', e.target.value)} required /><span style={{ fontSize: '11px', color: 'var(--text-3)' }}>HTTPS required.</span></div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '14px' }}>
            <div style={fld}><label style={lbl}>Version</label><input className="input" placeholder="1.0.0" value={form.version} onChange={e => set('version', e.target.value)} /></div>
            <div style={fld}><label style={lbl}>License</label><select className="input" value={form.license} onChange={e => set('license', e.target.value)}>{['MIT','Apache-2.0','GPL-3.0','BSD-3-Clause','ISC','Proprietary'].map(l => <option key={l}>{l}</option>)}</select></div>
            <div style={fld}><label style={lbl}>GitHub URL</label><input className="input" type="url" placeholder="https://github.com/…" value={form.github_url} onChange={e => set('github_url', e.target.value)} /></div>
          </div>
        </div>

        <div className="card" style={{ padding: '24px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
          <div style={{ fontSize: '11px', color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 700 }}>Discoverability</div>
          <div style={fld}><label style={lbl}>Tags * (comma-separated)</label><input className="input" placeholder="payments, billing, stripe" value={form.tags} onChange={e => set('tags', e.target.value)} required /><span style={{ fontSize: '11px', color: 'var(--text-3)' }}>Agents search by these.</span></div>
          <div style={fld}><label style={lbl}>Tool names * (comma-separated)</label><input className="input" placeholder="charge_card, create_subscription, issue_refund" value={form.tools} onChange={e => set('tools', e.target.value)} required /><span style={{ fontSize: '11px', color: 'var(--text-3)' }}>Exact snake_case function names.</span></div>
        </div>

        <div style={{ padding: '14px 18px', background: 'var(--blue-bg)', border: '1px solid #1e3a5f', borderRadius: 'var(--radius)', display: 'flex', gap: '12px', alignItems: 'flex-start' }}>
          <span style={{ fontSize: '18px', flexShrink: 0 }}>🛡</span>
          <div><div style={{ fontSize: '13px', fontWeight: 600, color: 'var(--blue)', marginBottom: '4px' }}>12-layer security scan runs automatically</div><p style={{ fontSize: '12px', color: 'var(--text-3)', lineHeight: 1.5 }}>Prompt injection, typosquatting, exfiltration patterns, insecure endpoints. Schema is hashed and monitored for drift.</p></div>
        </div>

        {error && <div style={{ padding: '12px 16px', background: 'var(--red-bg)', border: '1px solid #7f1d1d', borderRadius: 'var(--radius)', fontSize: '13px', color: 'var(--red)' }}>{error}</div>}
        <button type="submit" className="btn btn-primary btn-lg" disabled={submitting} style={{ width: '100%', justifyContent: 'center', opacity: submitting ? .6 : 1 }}>
          {submitting ? 'Scanning & publishing…' : 'Publish Server →'}
        </button>
      </form>
    </div>
  );
}
