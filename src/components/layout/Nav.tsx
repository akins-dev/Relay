'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useAuth } from '@/components/AuthProvider';

export function Nav() {
  const { user, loading, logout } = useAuth();
  const path = usePathname();
  const active = (href: string) => path.startsWith(href);

  return (
    <nav style={{ position: 'sticky', top: 0, zIndex: 100, background: 'rgba(8,8,8,0.92)', backdropFilter: 'blur(12px)', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 24px', height: '56px' }}>
      <Link href="/" style={{ textDecoration: 'none', display: 'flex', alignItems: 'center', gap: '10px' }}>
        <div style={{ width: '28px', height: '28px', background: 'linear-gradient(135deg,#22c55e,#16a34a)', borderRadius: '7px', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '14px', fontWeight: 800, color: '#000' }}>⬡</div>
        <span style={{ fontWeight: 700, fontSize: '15px', color: 'var(--text)', letterSpacing: '-0.02em' }}>
          mcp<span style={{ color: 'var(--green)' }}>registry</span>
        </span>
        <span className="badge badge-green" style={{ marginLeft: '2px' }}>v0.1</span>
      </Link>

      <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
        {[{ href: '/registry', label: 'Registry' }, { href: '/publish', label: 'Publish' }].map(({ href, label }) => (
          <Link key={href} href={href} className="btn btn-ghost btn-sm" style={{ textDecoration: 'none', color: active(href) ? 'var(--green)' : 'var(--text-2)', borderColor: active(href) ? 'var(--green)' : 'transparent', background: active(href) ? 'var(--green-bg)' : 'transparent' }}>{label}</Link>
        ))}
        <a href="https://github.com/the-17/mcp-registry" target="_blank" rel="noopener" className="btn btn-ghost btn-sm" style={{ textDecoration: 'none' }}>GitHub</a>

        <div style={{ width: '1px', height: '20px', background: 'var(--border)', margin: '0 8px' }} />

        {!loading && (user ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <Link href="/dashboard" style={{ textDecoration: 'none' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '5px 10px', border: '1px solid var(--border)', borderRadius: 'var(--radius)', cursor: 'pointer', transition: 'border-color .15s' }}
                onMouseEnter={e => (e.currentTarget.style.borderColor = 'var(--green)')}
                onMouseLeave={e => (e.currentTarget.style.borderColor = 'var(--border)')}>
                <div style={{ width: '20px', height: '20px', borderRadius: '50%', background: 'var(--green)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '10px', fontWeight: 800, color: '#000' }}>
                  {user.username[0].toUpperCase()}
                </div>
                <span style={{ fontSize: '13px', color: 'var(--text)' }}>{user.username}</span>
              </div>
            </Link>
            <button onClick={() => logout().then(() => window.location.href = '/')} className="btn btn-ghost btn-sm">Sign out</button>
          </div>
        ) : (
          <Link href="/login" className="btn btn-primary btn-sm" style={{ textDecoration: 'none' }}>Sign in</Link>
        ))}
      </div>
    </nav>
  );
}
