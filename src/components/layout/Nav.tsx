'use client';
import { useState }        from 'react';
import Link                from 'next/link';
import { usePathname }     from 'next/navigation';
import { useAuth }         from '@/components/AuthProvider';
import { cn }              from '@/lib/cn';
import { Menu, X }         from 'lucide-react';

const navLinks = [
  { href: '/registry', label: 'Registry' },
  { href: '/connect',  label: 'Connect'  },
  { href: '/docs',     label: 'Docs'     },
  { href: '/publish',  label: 'Publish'  },
];

export function Nav() {
  const { user, loading, logout } = useAuth();
  const path = usePathname();
  const isActive = (href: string) => path.startsWith(href);
  const [open, setOpen] = useState(false);

  return (
    <nav className="sticky top-0 z-50 border-b border-border bg-[rgba(253,252,251,0.95)] backdrop-blur-xl">
      <div className="mx-auto flex h-15 max-w-[1200px] items-center justify-between px-6 sm:px-8">

        {/* Logo */}
        <Link href="/" className="flex shrink-0 items-center gap-2.5 no-underline">
          <div className="flex h-[30px] w-[30px] items-center justify-center rounded-lg bg-gradient-to-br from-[#e8673a] to-[#c9552e] text-sm font-black text-white shadow-[0_0_16px_rgba(232,103,58,0.25)]">
            ⬡
          </div>
          <span className="text-[15px] font-bold tracking-tight text-foreground">
            open<span className="text-brand">MCP</span>
          </span>
          <span className="hidden rounded-full border border-brand/20 bg-brand-bg px-1.5 py-0.5 font-mono text-[10px] font-semibold text-brand sm:inline">
            v0.1
          </span>
        </Link>

        {/* Desktop links */}
        <div className="hidden items-center gap-1 sm:flex">
          {navLinks.map(l => (
            <Link
              key={l.href}
              href={l.href}
              className={cn(
                'rounded-lg px-3.5 py-1.5 text-[13px] transition-colors',
                isActive(l.href)
                  ? 'bg-muted font-semibold text-foreground'
                  : 'font-normal text-muted-foreground hover:text-foreground'
              )}
            >
              {l.label}
            </Link>
          ))}
        </div>

        {/* Desktop auth */}
        <div className="hidden items-center gap-2 sm:flex">
          {loading ? null : user ? (
            <>
              <Link href="/dashboard" className="rounded-lg px-3.5 py-1.5 text-[13px] text-muted-foreground transition-colors hover:text-foreground">
                Dashboard
              </Link>
              <button onClick={logout} className="rounded-lg px-3.5 py-1.5 text-[13px] text-muted-foreground transition-colors hover:text-foreground">
                Sign out
              </button>
            </>
          ) : (
            <>
              <Link href="/login" className="rounded-lg px-3.5 py-1.5 text-[13px] text-muted-foreground transition-colors hover:text-foreground">
                Sign in
              </Link>
              <Link href="/login?mode=register" className="rounded-lg bg-brand px-4 py-1.5 text-[13px] font-medium text-white transition-colors hover:bg-brand-dim">
                Get started
              </Link>
            </>
          )}
        </div>

        {/* Mobile hamburger */}
        <button
          onClick={() => setOpen(v => !v)}
          className="flex items-center justify-center rounded-lg p-2 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground sm:hidden"
          aria-label="Toggle menu"
        >
          {open ? <X size={20} /> : <Menu size={20} />}
        </button>
      </div>

      {/* Mobile drawer */}
      {open && (
        <div className="border-t border-border bg-background px-6 py-4 sm:hidden">
          <div className="flex flex-col gap-1">
            {navLinks.map(l => (
              <Link
                key={l.href}
                href={l.href}
                onClick={() => setOpen(false)}
                className={cn(
                  'rounded-lg px-3 py-2.5 text-sm transition-colors',
                  isActive(l.href)
                    ? 'bg-muted font-semibold text-foreground'
                    : 'text-muted-foreground hover:text-foreground'
                )}
              >
                {l.label}
              </Link>
            ))}
            <div className="my-2 h-px bg-border" />
            {!loading && (user ? (
              <>
                <Link href="/dashboard" onClick={() => setOpen(false)} className="rounded-lg px-3 py-2.5 text-sm text-muted-foreground">Dashboard</Link>
                <button onClick={() => { logout(); setOpen(false); }} className="rounded-lg px-3 py-2.5 text-left text-sm text-muted-foreground">Sign out</button>
              </>
            ) : (
              <>
                <Link href="/login" onClick={() => setOpen(false)} className="rounded-lg px-3 py-2.5 text-sm text-muted-foreground">Sign in</Link>
                <Link href="/login?mode=register" onClick={() => setOpen(false)} className="rounded-lg bg-brand px-3 py-2.5 text-sm font-medium text-white">Get started</Link>
              </>
            ))}
          </div>
        </div>
      )}
    </nav>
  );
}
