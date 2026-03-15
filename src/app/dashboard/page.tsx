'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useAuth } from '@/components/AuthProvider';

export default function DashboardPage() {
  const { user, loading: authLoading, logout } = useAuth();
  const router = useRouter();
  const [data,        setData]        = useState<any>(null);
  const [tab,         setTab]         = useState<'servers'|'keys'|'account'>('servers');
  const [keyName,     setKeyName]     = useState('');
  const [createdKey,  setCreatedKey]  = useState('');
  const [pageLoading, setPageLoading] = useState(true);

  useEffect(() => {
    if (authLoading) return;
    if (!user) { router.push('/login'); return; }
    load();
  }, [user, authLoading]);

  async function load() {
    setPageLoading(true);
    const res = await fetch('/api/auth/me').then(r => r.json());
    setData(res);
    setPageLoading(false);
  }

  async function createKey() {
    if (!keyName.trim()) return;
    const res = await fetch('/api/auth/api-keys', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: keyName }) }).then(r => r.json());
    setCreatedKey(res.key);
    setKeyName('');
    load();
  }

  async function deleteKey(id: string) {
    await fetch(`/api/auth/api-keys?id=${id}`, { method: 'DELETE' });
    load();
  }

  if (authLoading || pageLoading || !data) return (
    <div style={{ display: 'flex', justifyContent: 'center', padding: '80px' }}>
      <div className="anim-spin" style={{ width: '24px', height: '24px', border: '2px solid var(--border)', borderTopColor: 'var(--green)', borderRadius: '50%' }} />
    </div>
  );

  const totalStars = data.servers?.reduce((a: number, s: any) => a + (s.stars || 0), 0) ?? 0;
  const totalCalls = data.servers?.reduce((a: number, s: any) => a + (s.total_calls || 0), 0) ?? 0;

  return (
    <div className="page" style={{ maxWidth: '960px' }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '36px', flexWrap: 'wrap', gap: '16px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
          <div style={{ width: '44px', height: '44px', borderRadius: '50%', background: 'var(--green)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '20px', fontWeight: 800, color: '#000' }}>
            {data.user?.username?.[0]?.toUpperCase()}
          </div>
          <div>
            <h1 style={{ fontSize: '22px', fontWeight: 800, letterSpacing: '-0.02em' }}>{data.user?.username}</h1>
            <div style={{ fontSize: '12px', color: 'var(--text-3)' }}>{data.user?.email}</div>
          </div>
        </div>
        <div style={{ display: 'flex', gap: '8px' }}>
          <Link href="/publish" className="btn btn-primary btn-sm" style={{ textDecoration: 'none' }}>+ Publish</Link>
          <button onClick={() => logout().then(() => router.push('/'))} className="btn btn-ghost btn-sm">Sign out</button>
        </div>
      </div>

      {/* Stats */}
      <div className="grid-3" style={{ marginBottom: '36px' }}>
        {[
          { v: data.servers?.length ?? 0, l: 'Servers' },
          { v: totalStars.toLocaleString(), l: 'Total Stars' },
          { v: `${(totalCalls / 1000).toFixed(1)}K`, l: 'Total Calls' },
        ].map(s => (
          <div key={s.l} className="card" style={{ padding: '20px 24px' }}>
            <div style={{ fontSize: '26px', fontWeight: 800, fontFamily: 'var(--mono)', color: 'var(--green)', letterSpacing: '-0.02em' }}>{s.v}</div>
            <div style={{ fontSize: '11px', color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '0.08em', marginTop: '4px' }}>{s.l}</div>
          </div>
        ))}
      </div>

      {/* Tabs */}
      <div style={{ borderBottom: '1px solid var(--border)', marginBottom: '28px', display: 'flex' }}>
        {(['servers','keys','account'] as const).map(t => (
          <button key={t} onClick={() => setTab(t)} style={{ background: 'none', border: 'none', borderBottom: tab === t ? '2px solid var(--green)' : '2px solid transparent', color: tab === t ? 'var(--text)' : 'var(--text-3)', padding: '10px 18px', cursor: 'pointer', fontSize: '13px', fontFamily: 'var(--font)', fontWeight: tab === t ? 600 : 400 }}>
            {t === 'keys' ? 'API Keys' : t.charAt(0).toUpperCase() + t.slice(1)}
          </button>
        ))}
      </div>

      {/* Servers */}
      {tab === 'servers' && (
        data.servers?.length === 0
          ? <div style={{ textAlign: 'center', padding: '60px', color: 'var(--text-3)' }}>
              <div style={{ fontSize: '40px', marginBottom: '16px' }}>⬡</div>
              <p style={{ marginBottom: '16px', fontSize: '14px' }}>No servers yet.</p>
              <Link href="/publish" className="btn btn-primary" style={{ textDecoration: 'none' }}>Publish your first server →</Link>
            </div>
          : <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {data.servers.map((s: any) => (
                <Link key={s.id} href={`/registry/${s.name}`} style={{ textDecoration: 'none' }}>
                  <div className="card" style={{ padding: '16px 20px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}
                    onMouseEnter={e => (e.currentTarget as HTMLElement).style.borderColor = 'var(--border-2)'}
                    onMouseLeave={e => (e.currentTarget as HTMLElement).style.borderColor = 'var(--border)'}>
                    <div>
                      <div style={{ fontFamily: 'var(--mono)', fontWeight: 600, marginBottom: '4px' }}>{s.name}</div>
                      <div style={{ fontSize: '12px', color: 'var(--text-3)' }}>{s.display_name}</div>
                    </div>
                    <div style={{ display: 'flex', gap: '16px', alignItems: 'center' }}>
                      <div style={{ textAlign: 'right' }}>
                        <div style={{ fontSize: '12px', fontFamily: 'var(--mono)', color: 'var(--text-2)' }}>★ {s.stars}</div>
                        <div style={{ fontSize: '11px', color: 'var(--text-3)' }}>{((s.total_calls||0)/1000).toFixed(1)}K calls</div>
                      </div>
                      <span className={`badge ${s.status === 'active' ? 'badge-green' : 'badge-red'}`}>{s.status}</span>
                    </div>
                  </div>
                </Link>
              ))}
            </div>
      )}

      {/* API Keys */}
      {tab === 'keys' && (
        <div>
          {createdKey && (
            <div style={{ padding: '16px', background: 'var(--green-bg)', border: '1px solid #166534', borderRadius: 'var(--radius)', marginBottom: '18px' }}>
              <div style={{ fontSize: '12px', color: 'var(--green)', marginBottom: '8px', fontWeight: 600 }}>✓ Copy this key now — it will not be shown again</div>
              <div style={{ fontFamily: 'var(--mono)', fontSize: '12px', padding: '10px 14px', background: '#060606', borderRadius: '6px', color: 'var(--green)', wordBreak: 'break-all', cursor: 'pointer' }} onClick={() => navigator.clipboard?.writeText(createdKey)}>{createdKey}</div>
            </div>
          )}
          <div className="card" style={{ padding: '18px', marginBottom: '16px', display: 'flex', gap: '8px' }}>
            <input className="input" placeholder="Key name (e.g. Production)" value={keyName} onChange={e => setKeyName(e.target.value)} style={{ flex: 1 }} onKeyDown={e => e.key === 'Enter' && createKey()} />
            <button onClick={createKey} className="btn btn-primary">Create Key</button>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {data.apiKeys?.length === 0
              ? <div style={{ textAlign: 'center', padding: '40px', color: 'var(--text-3)', fontSize: '14px' }}>No API keys yet.</div>
              : data.apiKeys?.map((key: any) => (
                  <div key={key.id} className="card" style={{ padding: '14px 20px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div>
                      <div style={{ fontSize: '13px', fontWeight: 600, marginBottom: '4px' }}>{key.name}</div>
                      <div style={{ fontFamily: 'var(--mono)', fontSize: '12px', color: 'var(--text-3)' }}>{key.key_prefix}••••••••••••</div>
                    </div>
                    <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
                      <span style={{ fontSize: '11px', color: 'var(--text-3)' }}>{key.last_used_at ? `Used ${new Date(key.last_used_at).toLocaleDateString()}` : 'Never used'}</span>
                      <button onClick={() => deleteKey(key.id)} className="btn btn-danger btn-sm">Delete</button>
                    </div>
                  </div>
                ))
            }
          </div>
        </div>
      )}

      {/* Account */}
      {tab === 'account' && (
        <div className="card" style={{ padding: '24px', maxWidth: '440px' }}>
          <h3 style={{ fontSize: '14px', fontWeight: 700, marginBottom: '18px' }}>Account Details</h3>
          {[['Username', data.user?.username], ['Email', data.user?.email], ['Member since', new Date(data.user?.created_at).toLocaleDateString()]].map(([l, v]) => (
            <div key={l} style={{ display: 'flex', justifyContent: 'space-between', padding: '10px 0', borderBottom: '1px solid var(--border)', fontSize: '13px' }}>
              <span style={{ color: 'var(--text-3)' }}>{l}</span><span>{v}</span>
            </div>
          ))}
          <button onClick={() => logout().then(() => router.push('/'))} className="btn btn-danger" style={{ marginTop: '24px', width: '100%', justifyContent: 'center' }}>Sign out</button>
        </div>
      )}
    </div>
  );
}
