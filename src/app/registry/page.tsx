'use client';
import { useEffect, useState, useCallback } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { cn } from '@/lib/cn';
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
    <div className="page pb-24">
      {/* Header */}
      <div className="mb-10 mt-6 lg:mt-10">
        <h1 className="heading-display mb-3 text-[2.5rem] font-medium tracking-tight text-[#0a0a0a]">
          Registry
        </h1>
        <p className="text-[15px] text-[#52525b]">
          {total > 0 ? `${total} server${total !== 1 ? 's' : ''} available` : 'Discover MCP servers'}
          {totalCalls ? ` · ${(totalCalls / 1000).toFixed(0)}K calls today` : ''}
        </p>
      </div>

      {/* Search + sort + verified */}
      <div className="mb-6 flex flex-wrap gap-3">
        <form onSubmit={handleSearch} className="flex min-w-[260px] flex-1 gap-2">
          <input className="input !bg-white !shadow-sm" placeholder="Search by name, capability, or tag..." value={searchInput} onChange={e => setSearchInput(e.target.value)} />
          <button type="submit" className="btn btn-primary">Search</button>
        </form>
        <select className="input !w-auto !bg-white !shadow-sm" value={sort} onChange={e => set('sort', e.target.value)}>
          {SORTS.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
        </select>
        <button onClick={() => set('verified', verified ? '' : 'true')} className={cn("btn", verified ? 'btn-primary' : 'btn-ghost !bg-white !shadow-sm')}>
          ✓ Verified
        </button>
        <select className="input !w-auto !bg-white !shadow-sm" value={source} onChange={e => set('source', e.target.value)}>
          <option value="">All sources</option>
          <option value="official">⬡ Official</option>
          <option value="github">◆ GitHub</option>
          <option value="smithery">◈ Smithery</option>
          <option value="direct">◉ Direct</option>
        </select>
      </div>

      {/* Tag pills */}
      <div className="mb-8 flex flex-wrap gap-2">
        <button onClick={() => set('tag', '')} className={cn("btn btn-sm rounded-full", !tag ? "bg-black text-white hover:bg-neutral-800" : "btn-ghost !bg-white")} style={{ fontFamily: 'var(--mono)' }}>
          All
        </button>
        {TAGS.map(t => (
          <button key={t} onClick={() => set('tag', tag === t ? '' : t)} className={cn("btn btn-sm rounded-full", tag === t ? "bg-black text-white hover:bg-neutral-800" : "btn-ghost !bg-white")} style={{ fontFamily: 'var(--mono)' }}>
            {t}
          </button>
        ))}
      </div>

      {/* Active filters */}
      {(q || tag) && (
        <div className="mb-6 flex flex-wrap items-center gap-2">
          <span className="text-[12px] text-[#a1a1aa] uppercase tracking-widest font-mono">Filtering:</span>
          {q && (
            <span className="inline-flex items-center gap-2 rounded-md border border-[rgba(0,0,0,0.1)] bg-white px-3 py-1 font-mono text-[12px]">
              "{q}" <button onClick={() => { setSearchInput(''); set('q', ''); }} className="text-[#a1a1aa] hover:text-black hover:scale-110 transition-transform">✕</button>
            </span>
          )}
          {tag && (
            <span className="inline-flex items-center gap-2 rounded-md border border-neutral-300 bg-neutral-100 px-3 py-1 font-mono text-[12px] text-neutral-800">
              #{tag} <button onClick={() => set('tag', '')} className="text-neutral-500 hover:text-black hover:scale-110 transition-transform">✕</button>
            </span>
          )}
        </div>
      )}

      {/* Results */}
      {loading ? (
        <div className="grid-auto">
          {[...Array(6)].map((_, i) => (
            <div key={i} className="card h-[140px] p-5 shadow-sm">
              <div className="anim-pulse mb-3 h-[14px] w-[120px] rounded-md bg-[rgba(0,0,0,0.05)]" />
              <div className="anim-pulse mb-3 h-[12px] w-[90%] rounded-md bg-[rgba(0,0,0,0.03)]" />
              <div className="anim-pulse h-[12px] w-[70%] rounded-md bg-[rgba(0,0,0,0.03)]" />
            </div>
          ))}
        </div>
      ) : servers.length === 0 ? (
        <div className="py-24 text-center">
          <div className="mb-4 text-5xl text-[#d4d4d8]">⬡</div>
          <div className="mb-2 text-xl font-medium text-[#0a0a0a]">No servers found</div>
          <p className="text-sm text-[#52525b]">Try a different query or <Link href="/publish" className="text-black underline">publish your own</Link>.</p>
        </div>
      ) : (
        <>
          <div className="mb-4 font-mono text-[11px] uppercase tracking-widest text-[#a1a1aa]">{total} result{total !== 1 ? 's' : ''}</div>
          <div className="grid-auto">
            {servers.map(s => <ServerCard key={s.id} server={s} />)}
          </div>
          {pages > 1 && (
            <div className="mt-12 flex justify-center gap-2">
              {page > 1 && <button onClick={() => set('page', String(page - 1))} className="btn btn-ghost btn-sm !bg-white">← Prev</button>}
              {[...Array(Math.min(pages, 7))].map((_, i) => (
                <button key={i} onClick={() => set('page', String(i + 1))}
                  className={cn("btn btn-sm min-w-[36px]", i + 1 === page ? "btn-primary" : "btn-ghost !bg-white")}>{i + 1}</button>
              ))}
              {page < pages && <button onClick={() => set('page', String(page + 1))} className="btn btn-ghost btn-sm !bg-white">Next →</button>}
            </div>
          )}
        </>
      )}
    </div>
  );
}
