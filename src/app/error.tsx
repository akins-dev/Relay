'use client';
import { useEffect } from 'react';
import Link          from 'next/link';
import * as Sentry   from '@sentry/nextjs';

export default function GlobalError({ error, reset }: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);

  return (
    <div className="flex min-h-[70vh] flex-col items-center justify-center gap-5 px-6 text-center">
      <div className="text-3xl">⚠</div>
      <h2 className="text-xl font-bold tracking-tight text-foreground">Something went wrong</h2>
      <p className="max-w-sm text-[15px] leading-relaxed text-muted-foreground">
        An unexpected error occurred. The team has been notified.
        {error.digest && (
          <span className="mt-2 block font-mono text-xs text-muted-foreground/60">
            ID: {error.digest}
          </span>
        )}
      </p>
      <div className="flex gap-3">
        <button onClick={reset} className="rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-brand-dim">
          Try again
        </button>
        <Link href="/" className="rounded-lg border border-border px-4 py-2 text-sm text-muted-foreground hover:text-foreground">
          Go home
        </Link>
      </div>
    </div>
  );
}
