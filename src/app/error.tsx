'use client';
import { useEffect } from 'react';
import Link from 'next/link';
import { AlertTriangle } from 'lucide-react';
import * as Sentry from '@sentry/nextjs';

export default function GlobalError({ error, reset }: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);

  return (
    <div className="flex min-h-[75vh] flex-col items-center justify-center gap-6 px-6 text-center relative overflow-hidden">
      {/* Background glow */}
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[400px] h-[400px] bg-red-500 opacity-[0.05] blur-[100px] rounded-full pointer-events-none" />

      <div className="relative z-10 flex flex-col items-center gap-5">
        <div className="flex h-14 w-14 items-center justify-center rounded-2xl border border-red-500/20 bg-red-500/10">
          <AlertTriangle className="h-7 w-7 text-red-400" />
        </div>

        <h2 className="heading-display text-[2.5rem] font-medium text-white">
          Something went wrong
        </h2>

        <p className="max-w-md text-[15px] leading-relaxed text-brand-steel">
          An unexpected error occurred. The team has been notified.
          {error.digest && (
            <span className="mt-2 block font-mono text-xs text-brand-steel/50">
              ID: {error.digest}
            </span>
          )}
        </p>

        <div className="flex gap-3 mt-2">
          <button onClick={reset} className="btn btn-primary">
            Try again
          </button>
          <Link href="/" className="btn btn-ghost">
            Go home
          </Link>
        </div>
      </div>
    </div>
  );
}
