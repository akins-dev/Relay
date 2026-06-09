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

const getBaseUrl = () => {
  let url =
    BRAND.domain ??
    process.env.NEXT_PUBLIC_SITE_URL ??
    process.env.SITE_URL ??
    process.env.NEXT_PUBLIC_VERCEL_PROJECT_PRODUCTION_URL ??
    process.env.NEXT_PUBLIC_VERCEL_URL;

  // Include protocol if missing
  if (!url.startsWith('http')) {
    url = url.includes('localhost') || url.match(/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}/)
      ? `http://${url}`
      : `https://${url}`;
  }

  // Remove trailing slash if present for consistency
  return url.replace(/\/$/, '');
};

export const SITE_URL: string = getBaseUrl();
