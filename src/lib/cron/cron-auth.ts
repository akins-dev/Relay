import { type NextRequest } from 'next/server';
import { safeCompare } from '@/lib/utils';

export function isCronAuthorized(req: NextRequest): boolean {
  const cronSecret = process.env.CRON_SECRET ?? '';
  if (!cronSecret) return false;
  return safeCompare(req.headers.get('authorization') ?? '', `Bearer ${cronSecret}`);
}
