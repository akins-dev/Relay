'use client';
import { useEffect, useState, useCallback, useRef } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { ShieldCheck, Cloud, Terminal } from 'lucide-react';
import { cn } from '@/lib/cn';
import { ServerCard } from '@/components/registry/ServerCard';
import { SearchSpotlight } from '@/components/registry/SearchSpotlight';
import { PaginationControls } from '@/components/ui/pagination-controls';
import type { Server } from '@/types';

// ── Filter constants matching actual data ─────────────────────────────────────
const TAGS = [
  'general', 'ai', 'database', 'devops', 'security', 'email',
  'browser', 'automation', 'messaging', 'storage', 'git',
  'payments', 'scraping', 'official', 'reference',
];
const SORTS = [
  { value: 'trust',   label: 'Trust Score' },
  { value: 'stars',   label: 'Stars'       },
  { value: 'calls',   label: 'Usage'       },
  { value: 'recent',  label: 'Recent'      },
  { value: 'latency', label: 'Fastest'     },
];
const SOURCES = [
  { value: '',          label: 'All sources' },
  { value: 'official',  label: 'Official'    },
  { value: 'smithery',  label: 'Smithery'    },
  { value: 'glama',     label: 'Glama'       },
  { value: 'github',    label: 'GitHub'      },
  { value: 'direct',    label: 'Direct'      },
];
const TRANSPORTS = [
  { value: '',      label: 'All types',   icon: null           },
  { value: 'cloud', label: 'Cloud-ready', icon: Cloud          },
  { value: 'stdio', label: 'Local (CLI)', icon: Terminal       },
];
const PAGE_SIZES = [12, 24, 48, 96];

export default function RegistryPage() {
  const router = useRouter();
  const sp = useSearchParams();

  const q         = sp.get('q')         || '';
  const tag       = sp.get('tag')       || '';
  const sort      = sp.get('sort')      || 'trust';
  const verified  = sp.get('verified')  || '';
  const source    = sp.get('source')    || '';
  const transport = sp.get('transport') || '';
  const page      = parseInt(sp.get('page') || '1');
  const rawPageSize = parseInt(sp.get('page_size') || '12');
  const pageSize  = rawPageSize > 0 ? rawPageSize : 12;

  const [servers,    setServers]    = useState<Server[]>([]);
  const [total,      setTotal]      = useState(0);
  const [pages,      setPages]      = useState(1);
  const [loading,    setLoading]    = useState(true);
  const [totalCalls, setTotalCalls] = useState<number | null>(null);
  const [range,      setRange]      = useState({ from: 0, to: 0, hasPrev: false, hasNext: false });
  const cacheRef = useRef(new Map<string, any>());

  // Push a single filter key/value to the URL (clears page)
  function set(key: string, val: string) {
    const p = new URLSearchParams(sp.toString());
    if (val) p.set(key, val); else p.delete(key);
    if (key !== 'page') p.delete('page'); // reset to page 1 on filter change
    router.push(`/registry?${p.toString()}`);
  }

  useEffect(() => {
    if (PAGE_SIZES.includes(rawPageSize) || rawPageSize > 0) return;
    const p = new URLSearchParams(sp.toString());
    p.set('page_size', '12');
    router.replace(`/registry?${p.toString()}`);
  }, [rawPageSize, router, sp]);

  const load = useCallback(() => {
    const p: Record<string, string> = { sort, page: String(page), page_size: String(pageSize) };
    if (q)         p.q         = q;
    if (tag)       p.tag       = tag;
    if (verified)  p.verified  = verified;
    if (source)    p.source    = source;
    if (transport) p.transport = transport;
    const key = new URLSearchParams(p).toString();
    const cached = cacheRef.current.get(key);

    if (cached) {
      setServers(cached.servers || []);
      setTotal(cached.total || 0);
      setPages(cached.pages || 1);
      setRange({
        from: cached.meta?.from || 0,
        to: cached.meta?.to || 0,
        hasPrev: cached.meta?.has_prev || false,
        hasNext: cached.meta?.has_next || false,
      });
      setLoading(false);
      return;
    }

    const controller = new AbortController();
    setLoading(true);

    fetch(`/api/servers?${key}`, { signal: controller.signal })
      .then(r => r.json())
      .then(res => {
        cacheRef.current.set(key, res);
        setServers(res.servers || []);
        setTotal(res.total || 0);
        setPages(res.pages || 1);
        setRange({
          from: res.meta?.from || 0,
          to: res.meta?.to || 0,
          hasPrev: res.meta?.has_prev || false,
          hasNext: res.meta?.has_next || false,
        });
      })
      .catch(err => {
        if (err?.name !== 'AbortError') {
          setServers([]);
          setTotal(0);
          setPages(1);
          setRange({ from: 0, to: 0, hasPrev: false, hasNext: false });
        }
      })
      .finally(() => setLoading(false));

    return () => controller.abort();
  }, [page, pageSize, q, source, sort, tag, transport, verified]);

  useEffect(() => {
    const cleanup = load();
    return () => {
      if (typeof cleanup === 'function') cleanup();
    };
  }, [load]);
  useEffect(() => {
    fetch('/api/servers/stats')
      .then(r => r.json())
      .then(d => setTotalCalls(d.calls_today))
      .catch(() => {});
  }, []);

  useEffect(() => {
    const queryFor = (targetPage: number) => {
      if (targetPage < 1 || targetPage > pages) return null;
      const p = new URLSearchParams();
      p.set('sort', sort);
      p.set('page', String(targetPage));
      p.set('page_size', String(pageSize));
      if (q)         p.set('q', q);
      if (tag)       p.set('tag', tag);
      if (verified)  p.set('verified', verified);
      if (source)    p.set('source', source);
      if (transport) p.set('transport', transport);
      return p.toString();
    };

    const candidates = [page - 1, page + 1]
      .map(queryFor)
      .filter((value): value is string => Boolean(value));

    for (const key of candidates) {
      if (cacheRef.current.has(key)) continue;
      fetch(`/api/servers?${key}`)
        .then(r => r.json())
        .then(res => cacheRef.current.set(key, res))
        .catch(() => {});
    }
  }, [page, pages, pageSize, q, source, sort, tag, transport, verified]);

  // ── Count active filters ──────────────────────────────────────────────────
  const activeFilterCount = [q, tag, verified, source, transport].filter(Boolean).length;

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
              {total > 0 ? `${total.toLocaleString()} active server${total !== 1 ? 's' : ''}` : 'Discover MCP servers'}
              {totalCalls ? ` · ${(totalCalls / 1000).toFixed(0)}K calls today` : ''}
            </p>
          </div>
          <Link href="/publish" className="btn btn-primary self-start sm:self-auto">
            Publish a server →
          </Link>
        </div>
      </div>

      <div className="page pt-8">
        {/* ── Search spotlight ── */}
        <div className="mb-5">
          <SearchSpotlight
            defaultValue={q}
            onSearch={(val) => set('q', val)}
          />
        </div>

        {/* ── Filters row ── */}
        <div className="flex flex-wrap gap-2 mb-5 items-center">
          {/* Sort */}
          <select
            className="input !w-auto text-sm"
            value={sort}
            onChange={e => set('sort', e.target.value)}
          >
            {SORTS.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
          </select>

          {/* Source */}
          <select
            className="input !w-auto text-sm"
            value={source}
            onChange={e => set('source', e.target.value)}
          >
            {SOURCES.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
          </select>

          {/* Transport toggle */}
          <div className="flex rounded-lg border border-white/10 overflow-hidden">
            {TRANSPORTS.map(t => (
              <button
                key={t.value}
                onClick={() => set('transport', transport === t.value ? '' : t.value)}
                className={cn(
                  'px-3 py-1.5 text-[12px] font-mono flex items-center gap-1.5 transition-colors',
                  transport === t.value
                    ? 'bg-brand-DEFAULT/20 text-brand-signal'
                    : 'text-brand-steel hover:text-white hover:bg-white/5'
                )}
              >
                {t.icon && <t.icon className="h-3 w-3" />}
                {t.label}
              </button>
            ))}
          </div>

          {/* Verified */}
          <button
            onClick={() => set('verified', verified ? '' : 'true')}
            className={cn('btn btn-sm gap-1.5', verified ? 'btn-primary' : 'btn-ghost')}
          >
            <ShieldCheck className="h-3.5 w-3.5" /> Verified
          </button>

          {/* Clear all */}
          {activeFilterCount > 1 && (
            <button
              onClick={() => router.push('/registry')}
              className="btn btn-sm btn-ghost text-brand-steel hover:text-white"
            >
              Clear all
            </button>
          )}
        </div>

        {/* ── Tag pills ── */}
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

        {/* ── Active filters chips ── */}
        {(q || tag || source || transport) && (
          <div className="mb-6 flex flex-wrap items-center gap-2">
            <span className="text-[11px] text-brand-steel uppercase tracking-widest font-mono">Filtering:</span>
            {q && (
              <span className="inline-flex items-center gap-2 rounded-lg border border-white/10 bg-white/5 px-3 py-1 font-mono text-[12px] text-white">
                &quot;{q}&quot;
                <button onClick={() => set('q', '')} className="text-brand-steel hover:text-white transition-colors">✕</button>
              </span>
            )}
            {tag && (
              <span className="inline-flex items-center gap-2 rounded-lg border border-white/10 bg-white/5 px-3 py-1 font-mono text-[12px] text-brand-signal">
                #{tag}
                <button onClick={() => set('tag', '')} className="text-brand-steel hover:text-white transition-colors">✕</button>
              </span>
            )}
            {source && (
              <span className="inline-flex items-center gap-2 rounded-lg border border-white/10 bg-white/5 px-3 py-1 font-mono text-[12px] text-white">
                {source}
                <button onClick={() => set('source', '')} className="text-brand-steel hover:text-white transition-colors">✕</button>
              </span>
            )}
            {transport && (
              <span className="inline-flex items-center gap-2 rounded-lg border border-white/10 bg-white/5 px-3 py-1 font-mono text-[12px] text-white">
                {transport === 'cloud' ? '☁ Cloud-ready' : '⌘ Local CLI'}
                <button onClick={() => set('transport', '')} className="text-brand-steel hover:text-white transition-colors">✕</button>
              </span>
            )}
          </div>
        )}

        {/* ── Results ── */}
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
              {range.from > 0
                ? `Showing ${range.from.toLocaleString()}-${range.to.toLocaleString()} of ${total.toLocaleString()}`
                : `${total.toLocaleString()} result${total !== 1 ? 's' : ''}`
              }
              {pages > 1 && ` · page ${page} of ${pages}`}
              {` · ${pageSize}/page`}
            </div>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {servers.map(s => <ServerCard key={s.id} server={s} query={q} />)}
            </div>

            <PaginationControls
              className="mt-10"
              page={page}
              pages={pages}
              from={range.from}
              to={range.to}
              total={total}
              pageSize={pageSize}
              pageSizeOptions={PAGE_SIZES}
              onPageChange={(nextPage) => set('page', String(nextPage))}
              onPageSizeChange={(nextSize) => set('page_size', String(nextSize))}
            />
          </>
        )}
      </div>
    </div>
  );
}
