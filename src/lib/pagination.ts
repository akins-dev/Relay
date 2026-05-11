export type PaginationItem = number | '...';

export function clampPage(page: number, totalPages: number) {
  return Math.min(Math.max(1, page), Math.max(1, totalPages));
}

export function getPaginationItems(page: number, totalPages: number): PaginationItem[] {
  if (totalPages <= 7) return Array.from({ length: totalPages }, (_, i) => i + 1);

  const items: PaginationItem[] = [1];
  const start = Math.max(2, page - 1);
  const end = Math.min(totalPages - 1, page + 1);

  if (start > 2) items.push('...');
  for (let i = start; i <= end; i++) items.push(i);
  if (end < totalPages - 1) items.push('...');
  items.push(totalPages);

  return items;
}

export function paginateItems<T>(items: T[], page: number, pageSize: number) {
  const total = items.length;
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const safePage = clampPage(page, pages);
  const fromIndex = (safePage - 1) * pageSize;
  const toIndex = fromIndex + pageSize;

  return {
    items: items.slice(fromIndex, toIndex),
    total,
    page: safePage,
    pages,
    pageSize,
    from: total === 0 ? 0 : fromIndex + 1,
    to: Math.min(toIndex, total),
    hasPrev: safePage > 1,
    hasNext: safePage < pages,
  };
}
