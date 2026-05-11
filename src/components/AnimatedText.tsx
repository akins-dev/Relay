'use client';

import { motion, useInView, Variants } from 'framer-motion';
import { useRef, ReactNode } from 'react';

// ─── Shared variants ────────────────────────────────────────────────────────

const WORD_VARIANTS: Variants = {
  hidden: { opacity: 0, y: 24, filter: 'blur(6px)' },
  visible: (i: number) => ({
    opacity: 1,
    y: 0,
    filter: 'blur(0px)',
    transition: {
      delay: i * 0.075,
      duration: 0.55,
      ease: [0.22, 1, 0.36, 1],
    },
  }),
};

const FADE_UP_VARIANTS: Variants = {
  hidden: { opacity: 0, y: 20 },
  visible: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.6, ease: [0.22, 1, 0.36, 1] },
  },
};

const FADE_IN_VARIANTS: Variants = {
  hidden: { opacity: 0, y: 16 },
  visible: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.7, ease: [0.22, 1, 0.36, 1] },
  },
};

// ─── AnimatedHeading ────────────────────────────────────────────────────────
// Animates each word individually, revealing blur-to-sharp on scroll entry.

interface AnimatedHeadingProps {
  children: string;
  className?: string;
  as?: 'h1' | 'h2' | 'h3';
  delay?: number;
  once?: boolean;
}

export function AnimatedHeading({
  children,
  className,
  as: Tag = 'h2',
  delay = 0,
  once = true,
}: AnimatedHeadingProps) {
  const ref = useRef<HTMLHeadingElement>(null);
  const isInView = useInView(ref as React.RefObject<Element>, { once, margin: '-80px' });

  // Split into lines then words while preserving newlines
  const segments = children.split('\n');
  let wordIndex = 0;

  return (
    <Tag ref={ref as any} className={className} aria-label={children}>
      {segments.map((line, li) => (
        <span key={li} className="block">
          {line.split(' ').map((word, wi) => {
            const idx = wordIndex++;
            return (
              <motion.span
                key={`${li}-${wi}`}
                custom={idx + delay / 0.075}
                variants={WORD_VARIANTS}
                initial="hidden"
                animate={isInView ? 'visible' : 'hidden'}
                className="inline-block mr-[0.25em]"
                aria-hidden
              >
                {word}
              </motion.span>
            );
          })}
        </span>
      ))}
    </Tag>
  );
}

// ─── AnimatedParagraph ──────────────────────────────────────────────────────
// Simple fade-up for body copy.

interface AnimatedParagraphProps {
  children: ReactNode;
  className?: string;
  delay?: number;
  once?: boolean;
}

export function AnimatedParagraph({
  children,
  className,
  delay = 0,
  once = true,
}: AnimatedParagraphProps) {
  const ref = useRef<HTMLParagraphElement>(null);
  const isInView = useInView(ref as React.RefObject<Element>, { once, margin: '-60px' });

  return (
    <motion.p
      ref={ref}
      className={className}
      variants={FADE_UP_VARIANTS}
      initial="hidden"
      animate={isInView ? 'visible' : 'hidden'}
      transition={{ delay, duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
    >
      {children}
    </motion.p>
  );
}

// ─── AnimatedSection ────────────────────────────────────────────────────────
// Wraps any children in a fade-in-up on scroll.

interface AnimatedSectionProps {
  children: ReactNode;
  className?: string;
  delay?: number;
  once?: boolean;
  as?: keyof JSX.IntrinsicElements;
}

export function AnimatedSection({
  children,
  className,
  delay = 0,
  once = true,
  as: Tag = 'div',
}: AnimatedSectionProps) {
  const ref = useRef<HTMLDivElement>(null);
  const isInView = useInView(ref as React.RefObject<Element>, { once, margin: '-60px' });

  const MotionTag = motion[Tag as keyof typeof motion] as typeof motion.div;

  return (
    <MotionTag
      ref={ref}
      className={className}
      initial={{ opacity: 0, y: 16 }}
      animate={isInView ? { opacity: 1, y: 0 } : { opacity: 0, y: 16 }}
      transition={{ delay, duration: 0.7, ease: [0.22, 1, 0.36, 1] }}
    >
      {children}
    </MotionTag>
  );
}

// ─── AnimatedLabel ──────────────────────────────────────────────────────────
// For the small pill/badge labels above headings.

interface AnimatedLabelProps {
  children: ReactNode;
  className?: string;
  delay?: number;
  once?: boolean;
}

export function AnimatedLabel({
  children,
  className,
  delay = 0,
  once = true,
}: AnimatedLabelProps) {
  const ref = useRef<HTMLDivElement>(null);
  const isInView = useInView(ref as React.RefObject<Element>, { once, margin: '-40px' });

  return (
    <motion.div
      ref={ref}
      className={className}
      initial={{ opacity: 0, scale: 0.9, y: 10 }}
      animate={isInView ? { opacity: 1, scale: 1, y: 0 } : { opacity: 0, scale: 0.9, y: 10 }}
      transition={{ delay, duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
    >
      {children}
    </motion.div>
  );
}
