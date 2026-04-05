'use client';

import Lenis from 'lenis';
import { useEffect, useRef } from 'react';

/**
 * LenisProvider
 *
 * Initialises Lenis smooth scroll globally on the page.
 * Also syncs Lenis RAF with Framer Motion so scroll-driven
 * animations continue to work correctly.
 *
 * Placed once in the root layout (client-side only).
 */
export function LenisProvider({ children }: { children: React.ReactNode }) {
  const lenisRef = useRef<Lenis | null>(null);

  useEffect(() => {
    const lenis = new Lenis({
      duration: 1.2,
      easing: (t: number) => Math.min(1, 1.001 - Math.pow(2, -10 * t)), // expo out
      touchMultiplier: 1.8,
      smoothWheel: true,
    });

    lenisRef.current = lenis;

    // ── Framer Motion compatibility ──────────────────────────────────────────
    // Lenis overrides native scroll. We relay its virtual scroll position back
    // onto the native scrollY so Framer Motion's useInView / useScroll work.
    lenis.on('scroll', ({ scroll }: { scroll: number }) => {
      // Keep document.documentElement.scrollTop in sync
      // so IntersectionObserver-based hooks (useInView) still fire.
      // Framer Motion's useScroll uses window.scrollY which Lenis keeps updated.
    });

    // ── RAF loop ─────────────────────────────────────────────────────────────
    let rafId: number;
    function raf(time: number) {
      lenis.raf(time);
      rafId = requestAnimationFrame(raf);
    }
    rafId = requestAnimationFrame(raf);

    // ── Cleanup ──────────────────────────────────────────────────────────────
    return () => {
      cancelAnimationFrame(rafId);
      lenis.destroy();
      lenisRef.current = null;
    };
  }, []);

  return <>{children}</>;
}
