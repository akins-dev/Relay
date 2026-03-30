import Link          from 'next/link';
import type { Metadata } from 'next';

export const metadata: Metadata = { title: '404 — Page Not Found' };

export default function NotFound() {
  return (
    <div className="flex min-h-[70vh] flex-col items-center justify-center gap-5 px-6 text-center">
      <span className="rounded-full border border-brand/20 bg-brand-bg px-3 py-1 font-mono text-xs font-semibold text-brand">
        404
      </span>
      <h1 className="font-serif text-3xl font-bold tracking-tight text-foreground">
        Page not found
      </h1>
      <p className="max-w-sm text-[15px] leading-relaxed text-muted-foreground">
        This page does not exist. If you followed a link from the registry, the server may have been removed or renamed.
      </p>
      <div className="flex gap-3">
        <Link href="/registry" className="rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-brand-dim">
          Browse Registry
        </Link>
        <Link href="/" className="rounded-lg border border-border px-4 py-2 text-sm text-muted-foreground hover:text-foreground">
          Go home
        </Link>
      </div>
    </div>
  );
}
