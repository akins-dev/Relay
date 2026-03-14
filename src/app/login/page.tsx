'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useAuth } from '@/components/AuthProvider';

export default function LoginPage() {
  const { setAuth } = useAuth();
  const router = useRouter();
  const [mode, setMode] = useState<'login'|'register'>('login');
  const [form, setForm] = useState({ username: '', email: '', password: '' });
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  function set(k: string, v: string) { setForm(f => ({ ...f, [k]: v })); }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault(); setLoading(true); setError('');
    try {
      const url = mode === 'login' ? '/api/auth/login' : '/api/auth/register';
      const body = mode === 'login' ? { email: form.email, password: form.password } : form;
      const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Auth failed');
      const me = await fetch('/api/auth/me', { headers: { Authorization: `Bearer ${data.token}` } }).then(r => r.json());
      setAuth(data.token, me.user);
      router.push('/dashboard');
    } catch (e: any) { setError(e.message); }
    setLoading(false);
  }

  return (
    <div style={{ minHeight: 'calc(100vh - 56px)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '24px' }}>
      <div style={{ width: '100%', maxWidth: '400px' }}>
        <div style={{ textAlign: 'center', marginBottom: '36px' }}>
          <Link href="/" style={{ textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: '8px' }}>
            <div style={{ width: '34px', height: '34px', background: 'linear-gradient(135deg,#22c55e,#16a34a)', borderRadius: '9px', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '17px' }}>⬡</div>
            <span style={{ fontWeight: 700, fontSize: '18px' }}>mcpregistry</span>
          </Link>
        </div>

        <div className="card" style={{ padding: '32px' }}>
          {/* Toggle */}
          <div style={{ display: 'flex', background: 'var(--bg-2)', borderRadius: 'var(--radius)', padding: '3px', marginBottom: '24px' }}>
            {(['login','register'] as const).map(m => (
              <button key={m} onClick={() => setMode(m)} style={{ flex: 1, padding: '7px', background: mode === m ? 'var(--bg-3)' : 'transparent', border: 'none', borderRadius: 'calc(var(--radius) - 2px)', color: mode === m ? 'var(--text)' : 'var(--text-3)', fontFamily: 'var(--font)', fontSize: '13px', fontWeight: mode === m ? 600 : 400, cursor: 'pointer', textTransform: 'capitalize' }}>
                {m === 'login' ? 'Sign in' : 'Create account'}
              </button>
            ))}
          </div>

          <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
            {mode === 'register' && (
              <div>
                <label style={{ fontSize: '12px', color: 'var(--text-2)', fontWeight: 600, display: 'block', marginBottom: '6px' }}>Username</label>
                <input className="input" placeholder="your-username" value={form.username} onChange={e => set('username', e.target.value)} required minLength={3} />
              </div>
            )}
            <div>
              <label style={{ fontSize: '12px', color: 'var(--text-2)', fontWeight: 600, display: 'block', marginBottom: '6px' }}>Email</label>
              <input className="input" type="email" placeholder="you@example.com" value={form.email} onChange={e => set('email', e.target.value)} required />
            </div>
            <div>
              <label style={{ fontSize: '12px', color: 'var(--text-2)', fontWeight: 600, display: 'block', marginBottom: '6px' }}>Password</label>
              <input className="input" type="password" placeholder="••••••••" value={form.password} onChange={e => set('password', e.target.value)} required minLength={8} />
            </div>
            {error && <div style={{ padding: '10px 14px', background: 'var(--red-bg)', border: '1px solid #7f1d1d', borderRadius: 'var(--radius)', fontSize: '13px', color: 'var(--red)' }}>{error}</div>}
            <button type="submit" className="btn btn-primary" disabled={loading} style={{ marginTop: '6px', width: '100%', justifyContent: 'center', padding: '11px', fontSize: '14px', opacity: loading ? .6 : 1 }}>
              {loading ? '...' : mode === 'login' ? 'Sign in' : 'Create account'}
            </button>
          </form>
        </div>
        <p style={{ textAlign: 'center', marginTop: '18px', fontSize: '12px', color: 'var(--text-3)' }}>
          <Link href="/" style={{ color: 'var(--green)', textDecoration: 'none' }}>← Back to home</Link>
        </p>
      </div>
    </div>
  );
}
