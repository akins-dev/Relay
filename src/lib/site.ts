/**
 * Base URL for the application.
 *
 * Server-side code can use SITE_URL (not exposed to browser).
 * Client-side code uses NEXT_PUBLIC_SITE_URL.
 *
 * Both fall back to https://openmcp.dev in production if not set.
 *
 * Usage:
 *   import { SITE_URL } from '@/lib/site';
 *   const url = `${SITE_URL}/api/mcp-server`;
 */
export const SITE_URL: string =
  process.env.NEXT_PUBLIC_SITE_URL ??
  process.env.SITE_URL ??
  'https://openmcp.dev';
