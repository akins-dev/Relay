'use client';
import { useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useAuth } from '@/components/AuthProvider';

export function Nav() {
  const { user, loading, logout } = useAuth();
  const path = usePathname();
  const active = (href: string) => path.startsWith(href);
  const [menuOpen, setMenuOpen] = useState(false);

  const navLinks = [
    { href: '/registry', label: 'Registry' },
    { href: '/connect',  label: 'Connect'  },
    { href: '/publish',  label: 'Publish'  },
  ];

  return (
    <nav style={{
      position: 'sticky', top: 0, zIndex: 100,
      background: 'rgba(19,17,16,0.92)',
      backdropFilter: 'blur(20px)',
      WebkitBackdropFilter: 'blur(20px)',
      borderBottom: '1px solid var(--border)',
    }}>
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '0 28px', height: '60px', maxWidth: '1200px', margin: '0 auto',
      }}>
        {/* Logo */}
        <Link href="/" style={{ textDecoration: 'none', display: 'flex', alignItems: 'center', gap: '10px', flexShrink: 0 }}>
          <div style={{
            width: '30px', height: '30px',
            background: 'linear-gradient(135deg,#e8673a,#c9552e)',
            borderRadius: '8px',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: '14px', fontWeight: 800, color: '#fff',
            boxShadow: '0 0 16px rgba(232,103,58,0.25)',
          }}>⬡</div>
          <span style={{ fontWeight: 700, fontSize: '15px', color: 'var(--text)', letterSpacing: '-0.03em' }}>
            open<span style={{ color: 'var(--accent)' }}>MCP</span>
          </span>
          <span className="badge badge-green" style={{ marginLeft: '2px', opacity: .8 }}>v0.1</span>
        </Link>

        {/* Desktop nav links */}
        <div className="nav-desktop" style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
          {navLinks.map(l => (
            <Link key={l.href} href={l.href} style={{
              textDecoration: 'none', padding: '6px 14px', borderRadius: '8px',
              fontSize: '13px', fontWeight: active(l.href) ? 600 : 400,
              color: active(l.href) ? 'var(--text)' : 'var(--text-3)',
              background: active(l.href) ? 'var(--bg-2)' : 'transparent',
              transition: 'color .15s, background .15s',
            }}
              onMouseEnter={e => { if (!active(l.href)) (e.currentTarget as HTMLElement).style.color = 'var(--text-2)'; }}
              onMouseLeave={e => { if (!active(l.href)) (e.currentTarget as HTMLElement).style.color = 'var(--text-3)'; }}
            >{l.label}</Link>
          ))}

          {/* GitHub */}
          <a href="https://github.com/the-17/openmcp" target="_blank" rel="noopener"
            style={{ textDecoration: 'none', padding: '6px 14px', borderRadius: '8px', fontSize: '13px', color: 'var(--text-3)', transition: 'color .15s' }}
            onMouseEnter={e => (e.currentTarget as HTMLElement).style.color = 'var(--text-2)'}
            onMouseLeave={e => (e.currentTarget as HTMLElement).style.color = 'var(--text-3)'}
          >GitHub</a>
        </div>

        {/* Desktop auth */}
        <div className="nav-desktop" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          {!loading && (
            user ? (
              <>
                <Link href="/dashboard" className="btn btn-ghost btn-sm" style={{ textDecoration: 'none' }}>Dashboard</Link>
                <button onClick={() => logout().then(() => window.location.href = '/')} className="btn btn-ghost btn-sm">Sign out</button>
              </>
            ) : (
              <>
                <Link href="/login" className="btn btn-ghost btn-sm" style={{ textDecoration: 'none' }}>Sign in</Link>
                <Link href="/publish" className="btn btn-primary btn-sm" style={{ textDecoration: 'none' }}>Publish</Link>
              </>
            )
          )}
        </div>

        {/* Mobile hamburger */}
        <button className="nav-mobile" onClick={() => setMenuOpen(m => !m)} style={{
          background: 'none', border: '1px solid var(--border)', borderRadius: '8px',
          padding: '8px 10px', cursor: 'pointer', color: 'var(--text-2)',
          display: 'none', // shown via CSS
        }}>
          {menuOpen ? '✕' : '☰'}
        </button>
      </div>

      {/* Mobile dropdown */}
      {menuOpen && (
        <div style={{
          borderTop: '1px solid var(--border)',
          background: 'var(--bg-1)',
          padding: '12px 20px 20px',
          display: 'flex', flexDirection: 'column', gap: '4px',
        }}>
          {navLinks.map(l => (
            <Link key={l.href} href={l.href}
              onClick={() => setMenuOpen(false)}
              style={{
                textDecoration: 'none', padding: '10px 12px', borderRadius: '8px',
                fontSize: '14px', fontWeight: active(l.href) ? 600 : 400,
                color: active(l.href) ? 'var(--text)' : 'var(--text-2)',
                background: active(l.href) ? 'var(--bg-2)' : 'transparent',
              }}
            >{l.label}</Link>
          ))}
          <a href="https://github.com/the-17/openmcp" target="_blank" rel="noopener"
            style={{ textDecoration: 'none', padding: '10px 12px', fontSize: '14px', color: 'var(--text-3)' }}
          >GitHub</a>
          <div style={{ height: '1px', background: 'var(--border)', margin: '8px 0' }} />
          {!loading && (user
            ? <button onClick={() => { logout(); setMenuOpen(false); }} className="btn btn-ghost btn-sm">Sign out</button>
            : <Link href="/login" onClick={() => setMenuOpen(false)} className="btn btn-primary btn-sm" style={{ textDecoration: 'none', textAlign: 'center' }}>Sign in</Link>
          )}
        </div>
      )}
    </nav>
  );
}
