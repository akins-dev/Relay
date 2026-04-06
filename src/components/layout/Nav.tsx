'use client';
import { useState }    from 'react';
import Link            from 'next/link';
import { usePathname } from 'next/navigation';
import { useRouter }   from 'next/navigation';
import { useAuth }     from '@/components/AuthProvider';
import { cn }          from '@/lib/cn';
import { Menu, X }     from 'lucide-react';
import { BRAND }       from '@/lib/brand';

const navLinks = [
  { href: '/registry', label: 'Registry' },
  { href: '/connect',  label: 'Connect'  },
  { href: '/docs',     label: 'Docs'     },
  { href: '/publish',  label: 'Publish'  },
];

export function Nav() {
  const { user, loading, logout } = useAuth();
  const path   = usePathname();
  const router = useRouter();
  const isActive = (href: string) => path.startsWith(href);
  const [open, setOpen] = useState(false);

  async function handleLogout() {
    await logout();
    setOpen(false);
    router.push('/');
  }

  return (
    <nav className="sticky top-0 z-50 border-b border-[rgba(255,255,255,0.05)] bg-[rgba(15,23,42,0.6)] backdrop-blur-xl">
      <div className="mx-auto flex h-16 max-w-[1280px] items-center justify-between px-6 sm:px-8">

        {/* Logo */}
        <Link href="/" className="flex shrink-0 items-center gap-3 no-underline">
          <div className="flex h-[30px] w-[30px] items-center justify-center rounded-full border border-[rgba(255,255,255,0.2)] bg-transparent text-[11px] font-black text-white shadow-sm">
            ⇢
          </div>
          <span className="font-display text-[22px] font-semibold tracking-tight text-white">
            {BRAND.name}
          </span>
          <span className="hidden rounded-full border border-transparent bg-[rgba(255,255,255,0.05)] px-2 py-0.5 font-mono text-[10px] font-semibold uppercase tracking-widest text-[#94a3b8] sm:inline">
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
                  ? 'bg-[rgba(255,255,255,0.08)] font-medium text-white'
                  : 'font-normal text-[#94a3b8] hover:text-white hover:bg-[rgba(255,255,255,0.03)]'
              )}
            >
              {l.label}
            </Link>
          ))}
        </div>

        {/* Desktop auth */}
        <div className="hidden items-center gap-2 sm:flex min-w-[160px] justify-end">
          {loading ? (
            // Skeleton prevents layout shift while session resolves
            <div className="flex items-center gap-2">
              <div className="h-7 w-20 animate-pulse rounded-lg bg-white/5" />
              <div className="h-7 w-24 animate-pulse rounded-full bg-white/5" />
            </div>
          ) : user ? (
            <>
              <Link
                href="/dashboard"
                className={cn(
                  'rounded-lg px-3.5 py-1.5 text-[13px] transition-colors',
                  isActive('/dashboard')
                    ? 'text-white font-medium'
                    : 'text-[#94a3b8] hover:text-white'
                )}
              >
                Dashboard
              </Link>
              <button
                onClick={handleLogout}
                className="rounded-full border border-white/10 px-4 py-1.5 text-[13px] font-medium text-[#94a3b8] transition-colors hover:border-white/20 hover:text-white"
              >
                Sign out
              </button>
            </>
          ) : (
            <>
              <Link
                href="/login"
                className="rounded-lg px-3.5 py-1.5 text-[13px] text-[#94a3b8] transition-colors hover:text-white"
              >
                Sign in
              </Link>
              <Link
                href="/login?mode=register"
                className="rounded-full bg-white px-4 py-1.5 text-[13px] font-medium text-[#0F172A] transition-colors hover:bg-neutral-200"
              >
                Get started
              </Link>
            </>
          )}
        </div>

        {/* Mobile hamburger */}
        <button
          onClick={() => setOpen(v => !v)}
          className="flex items-center justify-center rounded-full p-2 text-[#94a3b8] transition-colors hover:bg-white/5 hover:text-white sm:hidden"
          aria-label="Toggle menu"
        >
          {open ? <X size={20} /> : <Menu size={20} />}
        </button>
      </div>

      {/* Mobile drawer */}
      {open && (
        <div className="border-t border-white/5 bg-[rgba(15,23,42,0.95)] px-6 py-4 sm:hidden">
          <div className="flex flex-col gap-1">
            {navLinks.map(l => (
              <Link
                key={l.href}
                href={l.href}
                onClick={() => setOpen(false)}
                className={cn(
                  'rounded-lg px-3 py-2.5 text-sm transition-colors',
                  isActive(l.href)
                    ? 'bg-white/5 font-semibold text-white'
                    : 'text-[#94a3b8] hover:text-white'
                )}
              >
                {l.label}
              </Link>
            ))}
            <div className="my-2 h-px bg-white/5" />
            {loading ? (
              // Skeleton for mobile too
              <div className="flex flex-col gap-1">
                <div className="h-9 w-full animate-pulse rounded-lg bg-white/5" />
                <div className="h-9 w-full animate-pulse rounded-lg bg-white/5" />
              </div>
            ) : user ? (
              <>
                <Link
                  href="/dashboard"
                  onClick={() => setOpen(false)}
                  className={cn(
                    'rounded-lg px-3 py-2.5 text-sm transition-colors',
                    isActive('/dashboard') ? 'text-white font-semibold' : 'text-[#94a3b8]'
                  )}
                >
                  Dashboard
                </Link>
                <button
                  onClick={handleLogout}
                  className="rounded-lg px-3 py-2.5 text-left text-sm text-[#94a3b8] transition-colors hover:text-white"
                >
                  Sign out
                </button>
              </>
            ) : (
              <>
                <Link
                  href="/login"
                  onClick={() => setOpen(false)}
                  className="rounded-lg px-3 py-2.5 text-sm text-[#94a3b8]"
                >
                  Sign in
                </Link>
                <Link
                  href="/login?mode=register"
                  onClick={() => setOpen(false)}
                  className="rounded-lg bg-white px-3 py-2.5 text-center text-sm font-medium text-[#0F172A]"
                >
                  Get started
                </Link>
              </>
            )}
          </div>
        </div>
      )}
    </nav>
  );
}
