/**
 * Base URL for the application.
 *
 * Server-side code can use SITE_URL (not exposed to browser).
 * Client-side code uses NEXT_PUBLIC_SITE_URL.
 *
 * Fallback is driven by BRAND.domain — change it once in brand.ts or via env.
 *
 * Usage:
 *   import { SITE_URL } from '@/lib/site';
 *   const url = `${SITE_URL}/api/mcp-server`;
 */
import { BRAND } from '@/lib/brand';

export const SITE_URL: string =
  process.env.NEXT_PUBLIC_SITE_URL ??
  process.env.SITE_URL ??
  `https://${BRAND.domain}`;
