'use client';

import { ChevronLeft, ChevronRight, MoreHorizontal } from 'lucide-react';
import { cn } from '@/lib/cn';
import { getPaginationItems } from '@/lib/pagination';

interface PaginationControlsProps {
  page: number;
  pages: number;
  onPageChange: (page: number) => void;
  from?: number;
  to?: number;
  total?: number;
  pageSize?: number;
  pageSizeOptions?: number[];
  onPageSizeChange?: (pageSize: number) => void;
  className?: string;
  align?: 'between' | 'center';
}

export function PaginationControls({
  page,
  pages,
  onPageChange,
  from = 0,
  to = 0,
  total = 0,
  pageSize,
  pageSizeOptions,
  onPageSizeChange,
  className,
  align = 'between',
}: PaginationControlsProps) {
  if (pages <= 1 && !onPageSizeChange) return null;

  const items = getPaginationItems(page, pages);

  return (
    <div
      className={cn(
        'flex flex-col gap-3 rounded-2xl border border-white/10 bg-white/[0.03] p-3 backdrop-blur-sm sm:flex-row sm:items-center',
        align === 'between' ? 'sm:justify-between' : 'sm:justify-center',
        className
      )}
    >
      <div className="flex flex-wrap items-center gap-3 text-[11px] font-mono uppercase tracking-[0.12em] text-brand-steel">
        {total > 0 ? <span>{from.toLocaleString()}-{to.toLocaleString()} of {total.toLocaleString()}</span> : <span>0 results</span>}
        {pageSize ? <span>{pageSize}/page</span> : null}
        {onPageSizeChange && pageSizeOptions?.length ? (
          <label className="flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.03] px-3 py-1 text-[10px] text-brand-steel">
            <span>Size</span>
            <select
              className="bg-transparent text-white outline-none"
              value={String(pageSize)}
              onChange={(e) => onPageSizeChange(Number(e.target.value))}
              aria-label="Page size"
            >
              {pageSizeOptions.map((option) => (
                <option key={option} value={option} className="bg-slate-900 text-white">
                  {option}
                </option>
              ))}
            </select>
          </label>
        ) : null}
      </div>

      {pages > 1 && (
        <div className="flex flex-wrap items-center justify-center gap-1">
          <button
            type="button"
            onClick={() => onPageChange(page - 1)}
            disabled={page <= 1}
            className={cn('btn btn-ghost btn-sm gap-1', page <= 1 && 'opacity-30 pointer-events-none')}
          >
            <ChevronLeft className="h-4 w-4" /> Prev
          </button>

          {items.map((item, index) => (
            item === '...'
              ? (
                <span key={`ellipsis-${index}`} className="px-2 text-brand-steel">
                  <MoreHorizontal className="h-4 w-4" />
                </span>
              )
              : (
                <button
                  key={item}
                  type="button"
                  onClick={() => onPageChange(item)}
                  className={cn('btn btn-sm min-w-[38px]', item === page ? 'btn-primary' : 'btn-ghost')}
                >
                  {item}
                </button>
              )
          ))}

          <button
            type="button"
            onClick={() => onPageChange(page + 1)}
            disabled={page >= pages}
            className={cn('btn btn-ghost btn-sm gap-1', page >= pages && 'opacity-30 pointer-events-none')}
          >
            Next <ChevronRight className="h-4 w-4" />
          </button>
        </div>
      )}
    </div>
  );
}
