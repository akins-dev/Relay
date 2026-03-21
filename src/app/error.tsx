'use client';
import { useEffect } from 'react';
import Link from 'next/link';

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Log to error tracking (console in dev, Sentry/similar in prod)
    console.error('[openMCP] Unhandled error:', error);
  }, [error]);

  return (
    <div style={{
      minHeight: '70vh', display: 'flex', alignItems: 'center', justifyContent: 'center',
      flexDirection: 'column', gap: '20px', padding: '40px', textAlign: 'center',
    }}>
      <div style={{ fontSize: '32px' }}>⚠</div>
      <h2 style={{ fontSize: '20px', fontWeight: 700, color: 'var(--text)' }}>
        Something went wrong
      </h2>
      <p style={{ color: 'var(--text-2)', fontSize: '15px', maxWidth: '400px', lineHeight: 1.7 }}>
        An unexpected error occurred. The team has been notified.
        {error.digest && (
          <span style={{ display: 'block', fontFamily: 'var(--mono)', fontSize: '12px',
            color: 'var(--text-3)', marginTop: '8px' }}>
            Error ID: {error.digest}
          </span>
        )}
      </p>
      <div style={{ display: 'flex', gap: '12px' }}>
        <button onClick={reset} className="btn btn-primary">Try again</button>
        <Link href="/" className="btn btn-ghost" style={{ textDecoration: 'none' }}>Go home</Link>
      </div>
    </div>
  );
}
