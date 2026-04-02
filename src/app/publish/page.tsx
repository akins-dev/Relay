'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useAuth } from '@/components/AuthProvider';
import { cn } from '@/lib/cn';

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

  if (loading) return <div className="flex justify-center p-20"><div className="anim-spin h-6 w-6 rounded-full border-2 border-[rgba(0,0,0,0.1)] border-t-black" /></div>;
  if (!user) return (
    <div className="page-xs pt-24 text-center">
      <p className="mb-6 text-[#52525b]">Sign in to publish a server.</p>
      <Link href="/login" className="btn btn-primary">Sign in →</Link>
    </div>
  );

  if (result) return (
    <div className="page-sm py-20 pb-24">
      <div className="card p-10 text-center shadow-sm">
        <div className={cn("mx-auto mb-6 flex h-14 w-14 items-center justify-center rounded-full text-2xl font-bold border-2", result.status === 'active' ? 'border-green-500 bg-green-50 text-green-600' : 'border-red-500 bg-red-50 text-red-600')}>
          {result.status === 'active' ? '✓' : '✕'}
        </div>
        <h2 className="mb-3 font-display text-2xl font-semibold text-[#0a0a0a]">{result.status === 'active' ? 'Server Published!' : 'Scan Failed'}</h2>
        <p className="mb-6 text-sm text-[#52525b]">{result.scan?.details}</p>
        
        {result.scan?.issues?.length > 0 && (
          <div className="mb-8 flex flex-col gap-2 text-left">
            {result.scan.issues.map((issue: any, i: number) => (
              <div key={i} className={cn("flex items-start gap-3 rounded-md border p-3 text-xs", issue.severity === 'critical' ? 'border-red-200 bg-red-50' : 'border-orange-200 bg-orange-50')}>
                <span className={cn("mt-0.5 font-mono text-[10px] font-bold uppercase", issue.severity === 'critical' ? 'text-red-700' : 'text-orange-700')}>
                  {issue.severity}
                </span>
                <span className="text-[#52525b]">{issue.description}</span>
              </div>
            ))}
          </div>
        )}
        
        <div className="flex justify-center gap-3">
          {result.status === 'active'
            ? <Link href={`/registry/${form.name}`} className="btn btn-primary">View Server →</Link>
            : <button onClick={() => setResult(null)} className="btn btn-primary">Fix & Resubmit</button>
          }
          <button onClick={() => setResult(null)} className="btn btn-ghost !bg-white">Publish Another</button>
        </div>
      </div>
    </div>
  );

  const fld = "flex flex-col gap-1.5";
  const lbl = "text-[11px] font-semibold text-[#a1a1aa] uppercase tracking-[0.06em]";

  return (
    <div className="page-sm py-16 pb-24">
      <div className="mb-10 text-center">
        <h1 className="heading-display mb-3 text-[2rem] font-medium tracking-tight text-[#0a0a0a] sm:text-[2.5rem]">Publish a Server</h1>
        <p className="text-[15px] text-[#52525b]">Your server will be scanned for security issues before going live.</p>
      </div>

      <form onSubmit={handleSubmit} className="flex flex-col gap-6">
        <div className="card flex flex-col gap-5 p-6 shadow-sm sm:p-8">
          <div className="font-mono text-[11px] font-bold uppercase tracking-[0.08em] text-[#a1a1aa]">Basic Info</div>
          
          <div className="grid gap-4 sm:grid-cols-2">
            <div className={fld}>
              <label className={lbl}>Server name *</label>
              <input className="input !bg-[#fafafa]" placeholder="my-mcp-server" value={form.name} onChange={e => set('name', e.target.value)} required pattern="[a-z0-9-]+" />
              <span className="text-[11px] text-[#a1a1aa]">Lowercase + hyphens only</span>
            </div>
            <div className={fld}>
              <label className={lbl}>Display name *</label>
              <input className="input !bg-[#fafafa]" placeholder="My MCP Server" value={form.display_name} onChange={e => set('display_name', e.target.value)} required />
            </div>
          </div>
          
          <div className={fld}>
            <label className={lbl}>Short description * ({form.description.length}/500)</label>
            <textarea className="input !bg-[#fafafa]" placeholder="What does this server do? Be specific." rows={2} value={form.description} onChange={e => set('description', e.target.value)} required minLength={20} maxLength={500} />
          </div>
          
          <div className={fld}>
            <label className={lbl}>Long description</label>
            <textarea className="input !bg-[#fafafa]" placeholder="Full description, use cases, examples…" rows={3} value={form.long_description} onChange={e => set('long_description', e.target.value)} />
          </div>
        </div>

        <div className="card flex flex-col gap-5 p-6 shadow-sm sm:p-8">
          <div className="font-mono text-[11px] font-bold uppercase tracking-[0.08em] text-[#a1a1aa]">Technical</div>
          
          <div className={fld}>
            <label className={lbl}>Endpoint URL *</label>
            <input className="input !bg-[#fafafa]" type="url" placeholder="https://your-server.example.com" value={form.endpoint} onChange={e => set('endpoint', e.target.value)} required />
            <span className="text-[11px] text-[#a1a1aa]">HTTPS required.</span>
          </div>
          
          <div className="grid gap-4 sm:grid-cols-3">
            <div className={fld}>
              <label className={lbl}>Version</label>
              <input className="input !bg-[#fafafa]" placeholder="1.0.0" value={form.version} onChange={e => set('version', e.target.value)} />
            </div>
            <div className={fld}>
              <label className={lbl}>License</label>
              <select className="input !bg-[#fafafa]" value={form.license} onChange={e => set('license', e.target.value)}>
                {['MIT','Apache-2.0','GPL-3.0','BSD-3-Clause','ISC','Proprietary'].map(l => <option key={l}>{l}</option>)}
              </select>
            </div>
            <div className={fld}>
              <label className={lbl}>GitHub URL</label>
              <input className="input !bg-[#fafafa]" type="url" placeholder="https://github.com/…" value={form.github_url} onChange={e => set('github_url', e.target.value)} />
            </div>
          </div>
        </div>

        <div className="card flex flex-col gap-5 p-6 shadow-sm sm:p-8">
          <div className="font-mono text-[11px] font-bold uppercase tracking-[0.08em] text-[#a1a1aa]">Discoverability</div>
          <div className={fld}>
            <label className={lbl}>Tags * (comma-separated)</label>
            <input className="input !bg-[#fafafa]" placeholder="payments, billing, stripe" value={form.tags} onChange={e => set('tags', e.target.value)} required />
            <span className="text-[11px] text-[#a1a1aa]">Agents search by these.</span>
          </div>
          <div className={fld}>
            <label className={lbl}>Tool names * (comma-separated)</label>
            <input className="input !bg-[#fafafa]" placeholder="charge_card, create_subscription, issue_refund" value={form.tools} onChange={e => set('tools', e.target.value)} required />
            <span className="text-[11px] text-[#a1a1aa]">Exact snake_case function names.</span>
          </div>
        </div>

        <div className="flex items-start gap-4 rounded-[16px] border border-blue-100 bg-blue-50 p-5">
          <span className="shrink-0 text-[18px]">🛡</span>
          <div>
            <div className="mb-1 text-[13px] font-semibold text-blue-800">12-layer security scan runs automatically</div>
            <p className="text-[12px] leading-relaxed text-blue-600/80">Prompt injection, typosquatting, exfiltration patterns, insecure endpoints. Schema is hashed and monitored for drift.</p>
          </div>
        </div>

        {error && (
          <div className="rounded-[16px] border border-red-200 bg-red-50 p-4 text-[13px] text-red-600">
            {error}
          </div>
        )}
        
        <button type="submit" className="btn btn-primary btn-lg mt-2 w-full justify-center transition-opacity" disabled={submitting} style={{ opacity: submitting ? 0.6 : 1 }}>
          {submitting ? 'Scanning & publishing…' : 'Publish Server →'}
        </button>
      </form>
    </div>
  );
}
