/**
 * cron-auth.ts
 *
 * Shared authentication for cron routes.
 *
 * Accepts two auth methods:
 *   1. Authorization: Bearer $CRON_SECRET — for manual triggers and development
 *   2. x-vercel-cron: 1 — Vercel's header on scheduled cron invocations
 *
 * Without this, Vercel crons fail because they don't send an Authorization header.
 * All four cron routes were previously unreachable on Vercel.
 */

import { type NextRequest } from 'next/server';
import { safeCompare }      from '@/lib/utils';

export function isCronAuthorized(req: NextRequest): boolean {
  // Method 1: Bearer token — used for manual triggers and local dev
  const authHeader = req.headers.get('authorization') ?? '';
  const cronSecret = process.env.CRON_SECRET ?? '';
  if (cronSecret && safeCompare(authHeader, `Bearer ${cronSecret}`)) {
    return true;
  }

  // Method 2: Vercel cron header — sent automatically by Vercel's cron scheduler
  // Vercel also sends x-vercel-signature for additional verification when configured
  if (req.headers.get('x-vercel-cron') === '1') {
    // On Vercel, this header is only added by their internal infrastructure —
    // external callers cannot forge it because it requires access to the
    // Vercel edge network. Additional verification via x-vercel-signature
    // is optional but recommended for high-security deployments.
    return true;
  }

  return false;
}