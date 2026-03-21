/** @type {import('next').NextConfig} */

const isDev = process.env.NODE_ENV === 'development';

// ── Content Security Policy ───────────────────────────────────────────────────
// Tightened for production. 'unsafe-eval' only in dev (React DevTools, HMR).
const CSP = [
  "default-src 'self'",
  // Scripts: self + Vercel analytics
  isDev
    ? "script-src 'self' 'unsafe-eval' 'unsafe-inline'"
    : "script-src 'self' 'unsafe-inline'",
  // Styles: self + Google Fonts
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  // Fonts: Google Fonts CDN
  "font-src 'self' https://fonts.gstatic.com",
  // Images: self + data URIs for SVG
  "img-src 'self' data: https:",
  // API calls: self only (agents call from their own environments)
  "connect-src 'self' https://*.supabase.co wss://*.supabase.co https://api.anthropic.com",
  // No plugins, no object embeds
  "object-src 'none'",
  // Prevent clickjacking via frame embedding
  "frame-ancestors 'none'",
  // Upgrade HTTP to HTTPS
  "upgrade-insecure-requests",
].join('; ');

const securityHeaders = [
  // ── Prevent MIME sniffing ─────────────────────────────────────────────────
  { key: 'X-Content-Type-Options',    value: 'nosniff' },
  // ── Clickjacking protection ───────────────────────────────────────────────
  { key: 'X-Frame-Options',           value: 'DENY' },
  // ── XSS filter (legacy browsers) ─────────────────────────────────────────
  { key: 'X-XSS-Protection',          value: '1; mode=block' },
  // ── Referrer policy ───────────────────────────────────────────────────────
  { key: 'Referrer-Policy',           value: 'strict-origin-when-cross-origin' },
  // ── Permissions policy — disable unused browser APIs ─────────────────────
  { key: 'Permissions-Policy',        value: 'camera=(), microphone=(), geolocation=(), payment=()' },
  // ── HSTS — force HTTPS for 1 year (only in prod) ─────────────────────────
  ...(isDev ? [] : [{
    key:   'Strict-Transport-Security',
    value: 'max-age=31536000; includeSubDomains',
  }]),
  // ── Content Security Policy ───────────────────────────────────────────────
  { key: 'Content-Security-Policy',   value: CSP },
];

const nextConfig = {
  // ── Image optimisation ────────────────────────────────────────────────────
  images: {
    formats:          ['image/avif', 'image/webp'],
    minimumCacheTTL:  60 * 60 * 24 * 7, // 7 days
    dangerouslyAllowSVG: true,
    contentSecurityPolicy: "default-src 'self'; script-src 'none'; sandbox;",
  },

  // ── Compiler options ──────────────────────────────────────────────────────
  compiler: {
    // Strip console.log in production (keep error/warn)
    removeConsole: process.env.NODE_ENV === 'production'
      ? { exclude: ['error', 'warn'] }
      : false,
  },

  // ── HTTP headers ──────────────────────────────────────────────────────────
  async headers() {
    return [
      {
        // Apply security headers to all routes
        source: '/(.*)',
        headers: securityHeaders,
      },
      {
        // CORS for the native MCP server — agents connect from anywhere
        source: '/api/mcp-server',
        headers: [
          { key: 'Access-Control-Allow-Origin',  value: '*' },
          { key: 'Access-Control-Allow-Methods', value: 'GET, POST, OPTIONS' },
          { key: 'Access-Control-Allow-Headers', value: 'Content-Type, Authorization' },
        ],
      },
      {
        // openmcp.md is fetched by agents from any origin
        source: '/openmcp.md',
        headers: [
          { key: 'Access-Control-Allow-Origin', value: '*' },
          { key: 'Cache-Control',               value: 'public, max-age=300, stale-while-revalidate=60' },
        ],
      },
      {
        // API routes — no caching by default
        source: '/api/(.*)',
        headers: [
          { key: 'Cache-Control', value: 'no-store, max-age=0' },
        ],
      },
    ];
  },

  // ── Redirects ─────────────────────────────────────────────────────────────
  async redirects() {
    return [
      // Canonical URL normalisation
      {
        source:      '/home',
        destination: '/',
        permanent:   true,
      },
    ];
  },

  // ── External packages (runs on server, not bundled for client) ───────────
  serverExternalPackages: ['@upstash/redis', '@upstash/ratelimit'],

  // ── Logging ───────────────────────────────────────────────────────────────
  logging: {
    fetches: {
      fullUrl: isDev,
    },
  },
};

module.exports = nextConfig;
