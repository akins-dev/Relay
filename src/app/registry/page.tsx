'use client';
import { useEffect, useState, useCallback } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { Search, SlidersHorizontal, ShieldCheck, Star, Zap, ChevronLeft, ChevronRight } from 'lucide-react';
import { cn } from '@/lib/cn';
import { ServerCard } from '@/components/registry/ServerCard';
import type { Server } from '@/types';

const TAGS = ['payments','security','database','git','email','browser','automation','devops','messaging','storage','ai','scraping'];
const SORTS = [
  { value: 'stars',   label: 'Stars' },
  { value: 'trust',   label: 'Trust' },
  { value: 'calls',   label: 'Usage' },
  { value: 'recent',  label: 'Recent' },
  { value: 'latency', label: 'Fastest' },
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
    <div className="overflow-x-hidden pb-24">
      {/* ── Page Header ── */}
      <div className="page pt-10 pb-6 border-b border-white/5">
        <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4">
          <div>
            <div className="font-mono text-[11px] uppercase tracking-[0.18em] text-brand-signal mb-3">
              — MCP Registry
            </div>
            <h1 className="heading-display text-[2.5rem] sm:text-[3.5rem] font-medium leading-[1.05] text-white">
              Registry
            </h1>
            <p className="mt-2 text-brand-steel text-[15px]">
              {total > 0 ? `${total} server${total !== 1 ? 's' : ''}` : 'Discover MCP servers'}
              {totalCalls ? ` · ${(totalCalls / 1000).toFixed(0)}K calls today` : ''}
            </p>
          </div>
          <Link href="/publish" className="btn btn-primary self-start sm:self-auto">
            Publish a server →
          </Link>
        </div>
      </div>

      <div className="page pt-8">
        {/* ── Search + Controls ── */}
        <form onSubmit={handleSearch} className="flex gap-2 mb-5">
          <div className="relative flex-1">
            <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-brand-steel pointer-events-none" />
            <input
              className="input pl-10 w-full"
              placeholder="Search by name, capability, or tag…"
              value={searchInput}
              onChange={e => setSearchInput(e.target.value)}
            />
          </div>
          <button type="submit" className="btn btn-primary px-5">Search</button>
        </form>

        {/* Filters row */}
        <div className="flex flex-wrap gap-2 mb-5">
          <select
            className="input !w-auto text-sm"
            value={sort}
            onChange={e => set('sort', e.target.value)}
          >
            {SORTS.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
          </select>

          <button
            onClick={() => set('verified', verified ? '' : 'true')}
            className={cn('btn btn-sm gap-1.5', verified ? 'btn-primary' : 'btn-ghost')}
          >
            <ShieldCheck className="h-3.5 w-3.5" /> Verified
          </button>

          <select
            className="input !w-auto text-sm"
            value={source}
            onChange={e => set('source', e.target.value)}
          >
            <option value="">All sources</option>
            <option value="official">Official</option>
            <option value="github">GitHub</option>
            <option value="smithery">Smithery</option>
            <option value="direct">Direct</option>
          </select>
        </div>

        {/* Tag pills */}
        <div className="flex flex-wrap gap-2 mb-8">
          <button
            onClick={() => set('tag', '')}
            className={cn('btn btn-sm rounded-full font-mono text-[11px]', !tag ? 'btn-primary' : 'btn-ghost')}
          >
            All
          </button>
          {TAGS.map(t => (
            <button
              key={t}
              onClick={() => set('tag', tag === t ? '' : t)}
              className={cn('btn btn-sm rounded-full font-mono text-[11px]', tag === t ? 'btn-primary' : 'btn-ghost')}
            >
              {t}
            </button>
          ))}
        </div>

        {/* Active filters */}
        {(q || tag) && (
          <div className="mb-6 flex flex-wrap items-center gap-2">
            <span className="text-[11px] text-brand-steel uppercase tracking-widest font-mono">Filtering:</span>
            {q && (
              <span className="inline-flex items-center gap-2 rounded-lg border border-white/10 bg-white/5 px-3 py-1 font-mono text-[12px] text-white">
                "{q}"
                <button onClick={() => { setSearchInput(''); set('q', ''); }} className="text-brand-steel hover:text-white transition-colors">✕</button>
              </span>
            )}
            {tag && (
              <span className="inline-flex items-center gap-2 rounded-lg border border-white/10 bg-white/5 px-3 py-1 font-mono text-[12px] text-brand-signal">
                #{tag}
                <button onClick={() => set('tag', '')} className="text-brand-steel hover:text-white transition-colors">✕</button>
              </span>
            )}
          </div>
        )}

        {/* Results */}
        {loading ? (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {[...Array(6)].map((_, i) => (
              <div key={i} className="rounded-2xl border border-white/5 bg-white/[0.02] h-[160px] p-5 animate-pulse">
                <div className="mb-3 h-3 w-[120px] rounded-md bg-white/10" />
                <div className="mb-3 h-2.5 w-[90%] rounded-md bg-white/5" />
                <div className="h-2.5 w-[70%] rounded-md bg-white/5" />
              </div>
            ))}
          </div>
        ) : servers.length === 0 ? (
          <div className="py-24 text-center">
            <div className="mb-4 text-5xl opacity-20">⬡</div>
            <div className="mb-2 text-xl font-medium text-white">No servers found</div>
            <p className="text-sm text-brand-steel">
              Try a different query or{' '}
              <Link href="/publish" className="text-white underline underline-offset-2 hover:text-brand-signal transition-colors">
                publish your own
              </Link>.
            </p>
          </div>
        ) : (
          <>
            <div className="mb-4 font-mono text-[11px] uppercase tracking-widest text-brand-steel">
              {total} result{total !== 1 ? 's' : ''}
            </div>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {servers.map(s => <ServerCard key={s.id} server={s} />)}
            </div>
            {pages > 1 && (
              <div className="mt-12 flex justify-center items-center gap-2">
                {page > 1 && (
                  <button onClick={() => set('page', String(page - 1))} className="btn btn-ghost btn-sm gap-1">
                    <ChevronLeft className="h-4 w-4" /> Prev
                  </button>
                )}
                {[...Array(Math.min(pages, 7))].map((_, i) => (
                  <button
                    key={i}
                    onClick={() => set('page', String(i + 1))}
                    className={cn('btn btn-sm min-w-[36px]', i + 1 === page ? 'btn-primary' : 'btn-ghost')}
                  >
                    {i + 1}
                  </button>
                ))}
                {page < pages && (
                  <button onClick={() => set('page', String(page + 1))} className="btn btn-ghost btn-sm gap-1">
                    Next <ChevronRight className="h-4 w-4" />
                  </button>
                )}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
