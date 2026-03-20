'use client';
import { useEffect, useState, useCallback } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { ServerCard } from '@/components/registry/ServerCard';
import type { Server } from '@/types';

const TAGS = ['payments','security','database','git','email','browser','automation','devops','messaging','storage','ai','scraping'];
const SORTS = [
  { value: 'stars', label: '★ Stars' },
  { value: 'trust', label: '🛡 Trust' },
  { value: 'calls', label: '⚡ Usage' },
  { value: 'recent', label: '🕐 Recent' },
  { value: 'latency', label: '🚀 Fastest' },
];

export default function RegistryPage() {
  const router = useRouter();
  const sp = useSearchParams();

  const q        = sp.get('q') || '';
  const tag      = sp.get('tag') || '';
  const sort     = sp.get('sort') || 'stars';
  const verified = sp.get('verified') || '';
  const source   = sp.get('source') || '';
  const page     = parseInt(sp.get('page') || '1');

  const [searchInput, setSearchInput] = useState(q);
  const [servers, setServers] = useState<Server[]>([]);
  const [total, setTotal]   = useState(0);
  const [pages, setPages]   = useState(1);
  const [loading, setLoading] = useState(true);
  const [totalCalls, setTotalCalls] = useState<number | null>(null);

  function set(key: string, val: string) {
    const p = new URLSearchParams(sp.toString());
    if (val) p.set(key, val); else p.delete(key);
    p.delete('page');
    router.push(`/registry?${p.toString()}`);
  }

  const load = useCallback(async () => {
    setLoading(true);
    const p: Record<string, string> = { sort, page: String(page), limit: '12' };
    if (q) p.q = q;
    if (tag) p.tag = tag;
    if (verified) p.verified = verified;
    if (source)   p.source   = source;
    const qs = new URLSearchParams(p).toString();
    const res = await fetch(`/api/servers?${qs}`).then(r => r.json());
    setServers(res.servers || []);
    setTotal(res.total || 0);
    setPages(res.pages || 1);
    setLoading(false);
  }, [q, tag, sort, verified, page]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    fetch('/api/servers/stats').then(r => r.json()).then(d => setTotalCalls(d.calls_today)).catch(() => {});
  }, []);

  function handleSearch(e: React.FormEvent) {
    e.preventDefault();
    set('q', searchInput);
  }

  return (
    <div className="page">
      {/* Header */}
      <div style={{ marginBottom: '40px' }}>
        <h1 style={{ fontSize: '32px', fontWeight: 800, letterSpacing: '-0.02em', marginBottom: '6px' }}>openMCP</h1>
        <p style={{ color: 'var(--text-2)', fontSize: '14px' }}>
          {total > 0 ? `${total} server${total !== 1 ? 's' : ''} available` : 'Discover MCP servers'}
          {totalCalls ? ` · ${(totalCalls / 1000).toFixed(0)}K calls today` : ''}
        </p>
      </div>

      {/* Search + sort + verified */}
      <div style={{ display: 'flex', gap: '10px', marginBottom: '20px', flexWrap: 'wrap' }}>
        <form onSubmit={handleSearch} style={{ flex: 1, minWidth: '260px', display: 'flex', gap: '8px' }}>
          <input className="input" placeholder="Search by name, capability, or tag..." value={searchInput} onChange={e => setSearchInput(e.target.value)} style={{ flex: 1 }} />
          <button type="submit" className="btn btn-primary">Search</button>
        </form>
        <select className="input" value={sort} onChange={e => set('sort', e.target.value)} style={{ width: 'auto' }}>
          {SORTS.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
        </select>
        <button onClick={() => set('verified', verified ? '' : 'true')} className={`btn ${verified ? 'btn-primary' : 'btn-ghost'}`}>
          ✓ Verified
        </button>
        <select className="input" value={source} onChange={e => set('source', e.target.value)} style={{ width: 'auto' }}>
          <option value="">All sources</option>
          <option value="official">⬡ Official</option>
          <option value="github">◆ GitHub</option>
          <option value="smithery">◈ Smithery</option>
          <option value="direct">◉ Direct</option>
        </select>
      </div>

      {/* Tag pills */}
      <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', marginBottom: '28px' }}>
        <button onClick={() => set('tag', '')} className="btn btn-ghost btn-sm"
          style={{ borderColor: !tag ? 'var(--green)' : 'transparent', color: !tag ? 'var(--green)' : 'var(--text-3)', background: !tag ? 'var(--green-bg)' : 'transparent' }}>
          All
        </button>
        {TAGS.map(t => (
          <button key={t} onClick={() => set('tag', tag === t ? '' : t)} className="btn btn-ghost btn-sm"
            style={{ fontFamily: 'var(--mono)', borderColor: tag === t ? 'var(--green)' : 'transparent', color: tag === t ? 'var(--green)' : 'var(--text-3)', background: tag === t ? 'var(--green-bg)' : 'transparent' }}>
            {t}
          </button>
        ))}
      </div>

      {/* Active filters */}
      {(q || tag) && (
        <div style={{ display: 'flex', gap: '8px', marginBottom: '18px', alignItems: 'center', flexWrap: 'wrap' }}>
          <span style={{ fontSize: '12px', color: 'var(--text-3)' }}>Filtering:</span>
          {q && (
            <span style={{ background: 'var(--bg-2)', border: '1px solid var(--border-2)', borderRadius: '4px', padding: '2px 10px', fontSize: '12px', fontFamily: 'var(--mono)', display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
              "{q}" <button onClick={() => { setSearchInput(''); set('q', ''); }} style={{ background: 'none', border: 'none', color: 'var(--text-3)', cursor: 'pointer', fontSize: '16px', lineHeight: 1, padding: 0 }}>×</button>
            </span>
          )}
          {tag && (
            <span style={{ background: 'var(--green-bg)', border: '1px solid #166534', borderRadius: '4px', padding: '2px 10px', fontSize: '12px', fontFamily: 'var(--mono)', color: 'var(--green)', display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
              #{tag} <button onClick={() => set('tag', '')} style={{ background: 'none', border: 'none', color: 'var(--green)', cursor: 'pointer', fontSize: '16px', lineHeight: 1, padding: 0 }}>×</button>
            </span>
          )}
        </div>
      )}

      {/* Results */}
      {loading ? (
        <div className="grid-auto">
          {[...Array(6)].map((_, i) => (
            <div key={i} className="card" style={{ padding: '18px 20px', height: '140px' }}>
              {[['120px','14px'],['90%','12px'],['70%','12px']].map(([w,h],j) => (
                <div key={j} className="anim-pulse" style={{ height: h, width: w, background: 'var(--bg-3)', borderRadius: '4px', marginBottom: '10px' }} />
              ))}
            </div>
          ))}
        </div>
      ) : servers.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '80px 24px', color: 'var(--text-3)' }}>
          <div style={{ fontSize: '48px', marginBottom: '16px' }}>⬡</div>
          <div style={{ fontSize: '18px', marginBottom: '8px', color: 'var(--text-2)' }}>No servers found</div>
          <p style={{ fontSize: '14px' }}>Try a different query or <a href="/publish" style={{ color: 'var(--green)', textDecoration: 'none' }}>publish your own</a>.</p>
        </div>
      ) : (
        <>
          <div style={{ fontSize: '12px', color: 'var(--text-3)', marginBottom: '14px', fontFamily: 'var(--mono)' }}>{total} result{total !== 1 ? 's' : ''}</div>
          <div className="grid-auto">
            {servers.map(s => <ServerCard key={s.id} server={s} />)}
          </div>
          {pages > 1 && (
            <div style={{ display: 'flex', justifyContent: 'center', gap: '6px', marginTop: '40px' }}>
              {page > 1 && <button onClick={() => set('page', String(page - 1))} className="btn btn-ghost btn-sm">← Prev</button>}
              {[...Array(Math.min(pages, 7))].map((_, i) => (
                <button key={i} onClick={() => set('page', String(i + 1))}
                  className={`btn btn-sm ${i + 1 === page ? 'btn-primary' : 'btn-ghost'}`}
                  style={{ minWidth: '36px' }}>{i + 1}</button>
              ))}
              {page < pages && <button onClick={() => set('page', String(page + 1))} className="btn btn-ghost btn-sm">Next →</button>}
            </div>
          )}
        </>
      )}
    </div>
  );
}
