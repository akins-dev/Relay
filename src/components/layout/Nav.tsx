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
    <nav className="sticky top-0 z-50 border-b border-[rgba(0,0,0,0.06)] bg-[rgba(255,255,255,0.85)] backdrop-blur-xl">
      <div className="mx-auto flex h-16 max-w-[1280px] items-center justify-between px-6 sm:px-8">

        {/* Logo */}
        <Link href="/" className="flex shrink-0 items-center gap-3 no-underline">
          <div className="flex h-[30px] w-[30px] items-center justify-center rounded-full border border-[rgba(0,0,0,0.1)] bg-white text-[11px] font-black text-black shadow-sm">
            ⇢
          </div>
          <span className="font-display text-[22px] font-semibold tracking-tight text-foreground">
            Agentrail
          </span>
          <span className="hidden rounded-full border border-transparent bg-[rgba(0,0,0,0.05)] px-2 py-0.5 font-mono text-[10px] font-semibold uppercase tracking-widest text-muted-foreground sm:inline">
            remote beta
          </span>
        </Link>

        {/* Desktop links */}
        <div className="hidden items-center gap-1 sm:flex">
          {navLinks.map(l => (
            <Link
              key={l.href}
              href={l.href}
              className={cn(
                'rounded-full px-3.5 py-1.5 text-[13px] transition-colors',
                isActive(l.href)
                  ? 'bg-[rgba(0,0,0,0.05)] font-medium text-foreground'
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
              <Link href="/login?mode=register" className="rounded-full bg-black px-4 py-1.5 text-[13px] font-medium text-white transition-colors hover:bg-neutral-800">
                Get started
              </Link>
            </>
          )}
        </div>

        {/* Mobile hamburger */}
        <button
          onClick={() => setOpen(v => !v)}
          className="flex items-center justify-center rounded-full p-2 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground sm:hidden"
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
