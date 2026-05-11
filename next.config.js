/** @type {import('next').NextConfig} */
const { withSentryConfig } = require('@sentry/nextjs');

const isDev = process.env.NODE_ENV === 'development';

const CSP = [
  "default-src 'self'",
  isDev
    ? "script-src 'self' 'unsafe-eval' 'unsafe-inline'"
    : "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' https://fonts.gstatic.com",
  "img-src 'self' data: https:",
  "connect-src 'self' https://*.supabase.co wss://*.supabase.co https://api.anthropic.com https://o*.ingest.sentry.io",
  "object-src 'none'",
  "frame-ancestors 'none'",
  "upgrade-insecure-requests",
].join('; ');

const securityHeaders = [
  { key: 'X-Content-Type-Options',    value: 'nosniff' },
  { key: 'X-Frame-Options',           value: 'DENY' },
  { key: 'X-XSS-Protection',          value: '1; mode=block' },
  { key: 'Referrer-Policy',           value: 'strict-origin-when-cross-origin' },
  { key: 'Permissions-Policy',        value: 'camera=(), microphone=(), geolocation=(), payment=()' },
  ...(isDev ? [] : [{ key: 'Strict-Transport-Security', value: 'max-age=31536000; includeSubDomains' }]),
  { key: 'Content-Security-Policy',   value: CSP },
];

const nextConfig = {
  images: {
    formats: ['image/avif', 'image/webp'],
    minimumCacheTTL: 60 * 60 * 24 * 7,
    dangerouslyAllowSVG: true,
    contentSecurityPolicy: "default-src 'self'; script-src 'none'; sandbox;",
  },
  compiler: {
    removeConsole: process.env.NODE_ENV === 'production' ? { exclude: ['error', 'warn'] } : false,
  },
  async headers() {
    return [
      { source: '/(.*)',         headers: securityHeaders },
      { source: '/api/mcp-server', headers: [
        { key: 'Access-Control-Allow-Origin',  value: '*' },
        { key: 'Access-Control-Allow-Methods', value: 'GET, POST, OPTIONS' },
        { key: 'Access-Control-Allow-Headers', value: 'Content-Type, Authorization' },
      ]},
      { source: '/agents.md', headers: [
        { key: 'Access-Control-Allow-Origin', value: '*' },
        { key: 'Cache-Control',               value: 'public, max-age=300, stale-while-revalidate=60' },
      ]},
      { source: '/api/(.*)', headers: [
        { key: 'Cache-Control', value: 'no-store, max-age=0' },
      ]},
    ];
  },
  async redirects() {
    return [
      { source: '/home', destination: '/', permanent: true },
    ];
  },
  serverExternalPackages: ['@upstash/redis', '@upstash/ratelimit'],
  logging: { fetches: { fullUrl: isDev } },
  experimental: {
    instrumentationHook: true,
  },
};

module.exports = withSentryConfig(nextConfig, {
  // Sentry build-time config
  org:     process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT,

  // Only upload source maps in CI/production — skip in dev to keep builds fast
  silent: true,
  hideSourceMaps: true,
  // Automatic instrumentation of Next.js routes
  webpack: {
    autoInstrumentServerFunctions: true,
    autoInstrumentMiddleware: true,
    treeshake: {
      removeDebugLogging: true,
    },
  },

  // Tunnel Sentry requests through our own domain
  // Avoids ad-blockers blocking sentry.io requests
  tunnelRoute: '/monitoring',
});
