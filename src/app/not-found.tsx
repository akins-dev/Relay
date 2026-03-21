import Link from 'next/link';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: '404 — Page Not Found',
};

export default function NotFound() {
  return (
    <div style={{
      minHeight: '70vh', display: 'flex', alignItems: 'center', justifyContent: 'center',
      flexDirection: 'column', gap: '20px', padding: '40px', textAlign: 'center',
    }}>
      <div style={{
        fontSize: '13px', fontFamily: 'var(--mono)', color: 'var(--accent)',
        background: 'var(--accent-bg)', padding: '6px 14px', borderRadius: '20px',
        border: '1px solid rgba(194,68,12,0.2)',
      }}>404</div>
      <h1 style={{ fontSize: '28px', fontWeight: 700, letterSpacing: '-0.02em',
        fontFamily: 'var(--font-serif)', color: 'var(--text)' }}>
        Page not found
      </h1>
      <p style={{ color: 'var(--text-2)', fontSize: '15px', maxWidth: '400px', lineHeight: 1.7 }}>
        This page does not exist. If you followed a link from the registry,
        the server may have been removed or renamed.
      </p>
      <div style={{ display: 'flex', gap: '12px' }}>
        <Link href="/registry" className="btn btn-primary" style={{ textDecoration: 'none' }}>
          Browse Registry
        </Link>
        <Link href="/" className="btn btn-ghost" style={{ textDecoration: 'none' }}>
          Go home
        </Link>
      </div>
    </div>
  );
}
