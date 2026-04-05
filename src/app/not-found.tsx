import Link from 'next/link';
import type { Metadata } from 'next';

export const metadata: Metadata = { title: '404 — Page Not Found' };

export default function NotFound() {
  return (
    <div className="flex min-h-[75vh] flex-col items-center justify-center gap-6 px-6 text-center relative overflow-hidden">
      {/* Background glow */}
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[400px] h-[400px] bg-brand-DEFAULT opacity-[0.06] blur-[100px] rounded-full pointer-events-none" />

      <div className="relative z-10 flex flex-col items-center gap-5">
        <span className="font-mono text-[11px] uppercase tracking-[0.2em] text-brand-signal px-3 py-1 rounded-full border border-brand-signal/20 bg-brand-signal/10">
          404
        </span>

        <h1 className="heading-display text-[3rem] sm:text-[4rem] font-medium text-white leading-tight">
          Page not found
        </h1>

        <p className="max-w-md text-[15px] leading-relaxed text-brand-steel">
          This page does not exist. If you followed a link from the registry, the server may have been removed or renamed.
        </p>

        <div className="flex gap-3 mt-2">
          <Link href="/registry" className="btn btn-primary">
            Browse Registry
          </Link>
          <Link href="/" className="btn btn-ghost">
            Go home
          </Link>
        </div>
      </div>
    </div>
  );
}
