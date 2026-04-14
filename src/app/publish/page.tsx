'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { motion } from 'framer-motion';
import { ShieldCheck, AlertCircle, CheckCircle2 } from 'lucide-react';
import { useAuth } from '@/components/AuthProvider';
import { cn } from '@/lib/cn';
import { AnimatedHeading, AnimatedParagraph, AnimatedLabel } from '@/components/AnimatedText';

export default function PublishPage() {
  const { user, loading } = useAuth();
  const router = useRouter();
  const [form, setForm] = useState({
    name: '', display_name: '', description: '', long_description: '',
    endpoint: '', version: '1.0.0', github_url: '', license: 'MIT', tags: '', tools: '',
  });
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
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...form,
          tags:  form.tags.split(',').map(t => t.trim()).filter(Boolean),
          tools: form.tools.split(',').map(t => t.trim()).filter(Boolean),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Publish failed');
      setResult(data);
      if (data.status === 'active') setTimeout(() => router.push(`/registry/${form.name}`), 2000);
    } catch (e: any) { setError(e.message); }
    finally { setSubmitting(false); }
  }

  // Loading state
  if (loading) return (
    <div className="flex justify-center items-center p-20">
      <div className="relative flex items-center justify-center">
        <div className="h-10 w-10 rounded-full border border-white/10 animate-[spin_2s_linear_infinite] border-t-white/60" />
        <div className="absolute h-2 w-2 rounded-full bg-brand-signal animate-[pulse_1.5s_ease-in-out_infinite]" />
      </div>
    </div>
  );

  // Not logged in
  if (!user) return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center gap-5 px-6 text-center">
      <div className="flex h-16 w-16 items-center justify-center rounded-2xl border border-white/10 bg-white/5 text-brand-signal">
        <ShieldCheck className="h-8 w-8" />
      </div>
      <h1 className="heading-display text-2xl font-medium text-white">Sign in to publish</h1>
      <p className="text-brand-steel max-w-sm">You need an account to submit a server to the registry.</p>
      <Link href="/login" className="btn btn-primary">Sign in →</Link>
    </div>
  );

  // Result screen
  if (result) return (
    <div className="page py-20 pb-24 max-w-2xl">
      <motion.div
        className="rounded-2xl border border-white/10 bg-white/[0.03] p-10 text-center backdrop-blur-md"
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
      >
        <div className={cn(
          "mx-auto mb-6 flex h-16 w-16 items-center justify-center rounded-full border-2 text-2xl",
          result.status === 'active'
            ? 'border-green-500/40 bg-green-500/10 text-green-400'
            : 'border-red-500/40 bg-red-500/10 text-red-400'
        )}>
          {result.status === 'active' ? <CheckCircle2 className="h-8 w-8" /> : <AlertCircle className="h-8 w-8" />}
        </div>
        <h2 className="mb-3 font-display text-2xl font-semibold text-white">
          {result.status === 'active' ? 'Server Published!' : 'Scan Failed'}
        </h2>
        <p className="mb-6 text-sm text-brand-steel">{result.scan?.details}</p>

        {result.scan?.issues?.length > 0 && (
          <div className="mb-8 flex flex-col gap-2 text-left">
            {result.scan.issues.map((issue: any, i: number) => (
              <div key={i} className={cn(
                'flex items-start gap-3 rounded-xl border p-3 text-xs',
                issue.severity === 'critical'
                  ? 'border-red-500/20 bg-red-500/10'
                  : 'border-orange-500/20 bg-orange-500/10'
              )}>
                <span className={cn('mt-0.5 font-mono text-[10px] font-bold uppercase shrink-0',
                  issue.severity === 'critical' ? 'text-red-400' : 'text-orange-400'
                )}>
                  {issue.severity}
                </span>
                <span className="text-brand-steel">{issue.description}</span>
              </div>
            ))}
          </div>
        )}

        <div className="flex justify-center gap-3">
          {result.status === 'active'
            ? <Link href={`/registry/${form.name}`} className="btn btn-primary">View Server →</Link>
            : <button onClick={() => setResult(null)} className="btn btn-primary">Fix & Resubmit</button>
          }
          <button onClick={() => setResult(null)} className="btn btn-ghost">Publish Another</button>
        </div>
      </motion.div>
    </div>
  );

  const fld = 'flex flex-col gap-1.5';
  const lbl = 'text-[11px] font-semibold text-brand-steel uppercase tracking-[0.06em]';

  return (
    <div className="overflow-x-hidden pb-24">
      {/* Header */}
      <div className="page pt-10 pb-8 border-b border-white/5">
        <AnimatedLabel className="inline-flex items-center gap-2 mb-4 px-3 py-1 rounded-full border border-brand-signal/20 bg-brand-signal/10">
          <ShieldCheck className="h-3.5 w-3.5 text-brand-signal" />
          <span className="font-mono text-[11px] uppercase tracking-[0.2em] text-brand-signal">Registry submission</span>
        </AnimatedLabel>
        <AnimatedHeading as="h1" className="heading-display text-[2.5rem] sm:text-[3.5rem] font-medium leading-[1.05] text-white">
          Publish a Server
        </AnimatedHeading>
        <AnimatedParagraph className="mt-3 text-brand-steel text-[15px]" delay={0.1}>
          Your server will be scanned for security issues before going live.
        </AnimatedParagraph>
      </div>

      <div className="page pt-8 max-w-3xl">
        <form onSubmit={handleSubmit} className="flex flex-col gap-5">

          {/* Basic info */}
          <div className="rounded-2xl border border-white/8 bg-white/[0.02] p-6 sm:p-8 flex flex-col gap-5">
            <div className="font-mono text-[11px] font-bold uppercase tracking-[0.12em] text-brand-steel">Basic Info</div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className={fld}>
                <label className={lbl}>Server name *</label>
                <input className="input" placeholder="my-mcp-server" value={form.name} onChange={e => set('name', e.target.value)} required pattern="[a-z0-9-]+" />
                <span className="text-[11px] text-brand-steel/60">Lowercase + hyphens only</span>
              </div>
              <div className={fld}>
                <label className={lbl}>Display name *</label>
                <input className="input" placeholder="My MCP Server" value={form.display_name} onChange={e => set('display_name', e.target.value)} required />
              </div>
            </div>
            <div className={fld}>
              <label className={lbl}>Short description * ({form.description.length}/500)</label>
              <textarea className="input" placeholder="What does this server do? Be specific." rows={2} value={form.description} onChange={e => set('description', e.target.value)} required minLength={20} maxLength={500} />
            </div>
            <div className={fld}>
              <label className={lbl}>Long description</label>
              <textarea className="input" placeholder="Full description, use cases, examples…" rows={3} value={form.long_description} onChange={e => set('long_description', e.target.value)} />
            </div>
          </div>

          {/* Technical */}
          <div className="rounded-2xl border border-white/8 bg-white/[0.02] p-6 sm:p-8 flex flex-col gap-5">
            <div className="font-mono text-[11px] font-bold uppercase tracking-[0.12em] text-brand-steel">Technical</div>
            <div className={fld}>
              <label className={lbl}>Endpoint URL *</label>
              <input className="input" type="url" placeholder="https://your-server.example.com" value={form.endpoint} onChange={e => set('endpoint', e.target.value)} required />
              <span className="text-[11px] text-brand-steel/60">HTTPS required.</span>
            </div>
            <div className="grid gap-4 sm:grid-cols-3">
              <div className={fld}>
                <label className={lbl}>Version</label>
                <input className="input" placeholder="1.0.0" value={form.version} onChange={e => set('version', e.target.value)} />
              </div>
              <div className={fld}>
                <label className={lbl}>License</label>
                <select className="input" value={form.license} onChange={e => set('license', e.target.value)}>
                  {['MIT','Apache-2.0','GPL-3.0','BSD-3-Clause','ISC','Proprietary'].map(l => <option key={l}>{l}</option>)}
                </select>
              </div>
              <div className={fld}>
                <label className={lbl}>GitHub URL</label>
                <input className="input" type="url" placeholder="https://github.com/…" value={form.github_url} onChange={e => set('github_url', e.target.value)} />
              </div>
            </div>
          </div>

          {/* Discoverability */}
          <div className="rounded-2xl border border-white/8 bg-white/[0.02] p-6 sm:p-8 flex flex-col gap-5">
            <div className="font-mono text-[11px] font-bold uppercase tracking-[0.12em] text-brand-steel">Discoverability</div>
            <div className={fld}>
              <label className={lbl}>Tags * (comma-separated)</label>
              <input className="input" placeholder="payments, billing, stripe" value={form.tags} onChange={e => set('tags', e.target.value)} required />
              <span className="text-[11px] text-brand-steel/60">Agents search by these.</span>
            </div>
            <div className={fld}>
              <label className={lbl}>Tool names * (comma-separated)</label>
              <input className="input" placeholder="charge_card, create_subscription, issue_refund" value={form.tools} onChange={e => set('tools', e.target.value)} required />
              <span className="text-[11px] text-brand-steel/60">Exact snake_case function names.</span>
            </div>
          </div>

          {/* Security notice */}
          <div className="flex items-start gap-4 rounded-2xl border border-brand-signal/20 bg-brand-signal/5 p-5">
            <ShieldCheck className="h-5 w-5 text-brand-signal shrink-0 mt-0.5" />
            <div>
              <div className="mb-1 text-[13px] font-semibold text-white">12-layer security scan runs automatically</div>
              <p className="text-[12px] leading-relaxed text-brand-steel">
                Prompt injection, typosquatting, exfiltration patterns, insecure endpoints. Schema is hashed and monitored for drift.
              </p>
            </div>
          </div>

          {error && (
            <div className="rounded-xl border border-red-500/20 bg-red-500/10 p-4 text-[13px] text-red-400">
              {error}
            </div>
          )}

          <button
            type="submit"
            className="btn btn-primary btn-lg mt-2 w-full justify-center"
            disabled={submitting}
            style={{ opacity: submitting ? 0.6 : 1 }}
          >
            {submitting ? 'Scanning & publishing…' : 'Publish Server →'}
          </button>
        </form>
      </div>
    </div>
  );
}
