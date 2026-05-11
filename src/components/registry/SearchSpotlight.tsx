'use client';
import { useState, useEffect, useRef, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { Search, Shield, Star, X, ArrowRight } from 'lucide-react';
import { highlight } from '@/lib/highlight';
import { cn } from '@/lib/cn';

interface Hit {
  name:         string;
  display_name: string;
  description:  string;
  trust_score:  number;
  verified:     boolean;
  stars:        number;
  tags:         string[];
}

interface SearchSpotlightProps {
  /** Called when the user commits a search (Enter key or explicit search) */
  onSearch: (q: string) => void;
  /** Initial value (from URL ?q= param) */
  defaultValue?: string;
}

function useDebounce<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(t);
  }, [value, delay]);
  return debounced;
}

export function SearchSpotlight({ onSearch, defaultValue = '' }: SearchSpotlightProps) {
  const router = useRouter();
  const inputRef   = useRef<HTMLInputElement>(null);
  const panelRef   = useRef<HTMLDivElement>(null);

  const [query,   setQuery]   = useState(defaultValue);
  const [hits,    setHits]    = useState<Hit[]>([]);
  const [loading, setLoading] = useState(false);
  const [open,    setOpen]    = useState(false);
  const [active,  setActive]  = useState(-1); // keyboard-selected index

  const debouncedQuery = useDebounce(query.trim(), 260);

  // ── Fetch instant hits ────────────────────────────────────────────────────
  useEffect(() => {
    if (!debouncedQuery) {
      setHits([]);
      setOpen(false);
      setLoading(false);
      return;
    }

    let cancelled = false;
    setLoading(true);

    // Reuse the /api/servers endpoint (already paginated, same data shape)
    fetch(`/api/servers?q=${encodeURIComponent(debouncedQuery)}&limit=6&sort=stars`)
      .then(r => r.json())
      .then(d => {
        if (cancelled) return;
        setHits(d.servers?.slice(0, 6) ?? []);
        setOpen(true);
        setActive(-1);
      })
      .catch(() => {
        if (!cancelled) setHits([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => { cancelled = true; };
  }, [debouncedQuery]);

  // ── Close on outside click ────────────────────────────────────────────────
  useEffect(() => {
    function onPointerDown(e: PointerEvent) {
      if (
        panelRef.current && !panelRef.current.contains(e.target as Node) &&
        inputRef.current && !inputRef.current.contains(e.target as Node)
      ) {
        setOpen(false);
      }
    }
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, []);

  // ── Keyboard navigation ───────────────────────────────────────────────────
  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (!open || !hits.length) {
      if (e.key === 'Enter') {
        e.preventDefault();
        commit();
      }
      return;
    }

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive(i => Math.min(i + 1, hits.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive(i => Math.max(i - 1, -1));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (active >= 0 && hits[active]) {
        navigate(hits[active].name);
      } else {
        commit();
      }
    } else if (e.key === 'Escape') {
      setOpen(false);
      setActive(-1);
    }
  }

  function commit() {
    setOpen(false);
    onSearch(query.trim());
  }

  function navigate(serverName: string) {
    setOpen(false);
    router.push(`/registry/${serverName}`);
  }

  function clear() {
    setQuery('');
    setHits([]);
    setOpen(false);
    onSearch('');
    inputRef.current?.focus();
  }

  const hasQuery = query.trim().length > 0;

  return (
    <div className="relative w-full">
      {/* Input */}
      <div className="relative flex items-center">
        <Search
          className={cn(
            'absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 pointer-events-none transition-colors',
            loading ? 'text-white/60 animate-pulse' : 'text-[#94a3b8]'
          )}
        />
        <input
          ref={inputRef}
          className="input pl-10 pr-10 w-full"
          placeholder="Search by name, capability, or tag…"
          value={query}
          onChange={e => setQuery(e.target.value)}
          onFocus={() => { if (hits.length) setOpen(true); }}
          onKeyDown={onKeyDown}
          autoComplete="off"
          spellCheck={false}
          aria-label="Search servers"
          role="combobox"
          aria-expanded={open}
          aria-controls={open ? "spotlight-listbox" : undefined}
          aria-haspopup="listbox"
        />
        {hasQuery && (
          <button
            type="button"
            onClick={clear}
            className="absolute right-3 top-1/2 -translate-y-1/2 rounded p-0.5 text-[#94a3b8] hover:text-white transition-colors"
            aria-label="Clear search"
          >
            <X size={14} />
          </button>
        )}
      </div>

      {/* Spotlight panel */}
      {open && hits.length > 0 && (
        <div
          ref={panelRef}
          id="spotlight-listbox"
          role="listbox"
          aria-label="Search results"
          className="absolute left-0 right-0 top-[calc(100%+6px)] z-50 overflow-hidden rounded-xl border border-white/10 bg-[rgba(15,23,42,0.96)] shadow-2xl backdrop-blur-xl"
        >
          <ul className="divide-y divide-white/5">
            {hits.map((hit, i) => (
              <li key={hit.name} role="option" aria-selected={active === i}>
                <button
                  type="button"
                  onClick={() => navigate(hit.name)}
                  onMouseEnter={() => setActive(i)}
                  className={cn(
                    'w-full text-left px-4 py-3 transition-colors flex items-start gap-3 group',
                    active === i ? 'bg-white/5' : 'hover:bg-white/[0.03]'
                  )}
                >
                  {/* Icon / trust indicator */}
                  <div className={cn(
                    'mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-[11px] font-bold',
                    hit.trust_score >= 85
                      ? 'bg-green-500/10 text-green-400'   // verified + proven reliability
                      : hit.trust_score >= 65
                        ? 'bg-amber-400/10 text-amber-400' // new/clean — Bayesian prior range
                        : 'bg-white/5 text-[#94a3b8]'      // active issues or very low signal
                  )}>
                    {hit.trust_score}
                  </div>

                  {/* Text */}
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5 mb-0.5">
                      <span className="font-mono text-[13px] font-semibold text-white">
                        {highlight(hit.name, debouncedQuery)}
                      </span>
                      {hit.verified && (
                        <Shield size={11} className="shrink-0 text-green-500" />
                      )}
                    </div>
                    {hit.display_name !== hit.name && (
                      <p className="text-[12px] text-[#94a3b8] font-medium mb-0.5">
                        {highlight(hit.display_name, debouncedQuery)}
                      </p>
                    )}
                    <p className="line-clamp-1 text-[12px] text-[#64748b]">
                      {highlight(hit.description, debouncedQuery)}
                    </p>

                    {/* Tags */}
                    {hit.tags?.length > 0 && (
                      <div className="mt-1.5 flex flex-wrap gap-1">
                        {hit.tags.slice(0, 3).map(tag => {
                          const isMatch = tag.toLowerCase().includes(debouncedQuery.toLowerCase());
                          return (
                            <span
                              key={tag}
                              className={cn(
                                'rounded px-1.5 py-0.5 text-[10px] font-mono',
                                isMatch
                                  ? 'bg-[#22d3ee]/10 text-[#22d3ee]'
                                  : 'bg-white/5 text-[#64748b]'
                              )}
                            >
                              {highlight(tag, debouncedQuery)}
                            </span>
                          );
                        })}
                      </div>
                    )}
                  </div>

                  {/* Star count + arrow */}
                  <div className="flex shrink-0 flex-col items-end gap-1 pt-0.5">
                    <span className="flex items-center gap-1 text-[11px] text-[#64748b]">
                      <Star size={10} />
                      {hit.stars?.toLocaleString() ?? 0}
                    </span>
                    <ArrowRight
                      size={14}
                      className={cn(
                        'transition-all',
                        active === i
                          ? 'opacity-100 translate-x-0 text-[#22d3ee]'
                          : 'opacity-0 -translate-x-1'
                      )}
                    />
                  </div>
                </button>
              </li>
            ))}
          </ul>

          {/* Footer: "See all results" */}
          <div className="border-t border-white/5 px-4 py-2.5">
            <button
              type="button"
              onClick={commit}
              className="flex w-full items-center justify-between text-[12px] text-[#94a3b8] hover:text-white transition-colors"
            >
              <span>
                See all results for{' '}
                <span className="font-semibold text-white">&quot;{debouncedQuery}&quot;</span>
              </span>
              <span className="flex items-center gap-1">
                Press Enter <kbd className="ml-1 rounded border border-white/10 bg-white/5 px-1.5 py-0.5 font-mono text-[10px]">↵</kbd>
              </span>
            </button>
          </div>
        </div>
      )}

      {/* No results nudge */}
      {open && !loading && hits.length === 0 && debouncedQuery && (
        <div className="absolute left-0 right-0 top-[calc(100%+6px)] z-50 rounded-xl border border-white/10 bg-[rgba(15,23,42,0.96)] px-4 py-4 text-center shadow-2xl backdrop-blur-xl">
          <p className="text-[13px] text-[#64748b]">
            No results for <span className="font-semibold text-white">&quot;{debouncedQuery}&quot;</span> — press Enter to search the full registry.
          </p>
        </div>
      )}
    </div>
  );
}
