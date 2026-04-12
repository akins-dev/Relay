/**
 * Shared utilities
 * Timing-safe comparison, HMAC signing, response size guards
 */
import { createHmac, timingSafeEqual } from 'crypto';

// ── Timing-safe string comparison ─────────────────────────────────────────────
// Prevents timing attacks on secret comparisons.
// Use this instead of === for any secret/token comparison.
export function safeCompare(a: string, b: string): boolean {
  try {
    const ba = Buffer.from(a);
    const bb = Buffer.from(b);
    if (ba.length !== bb.length) {
      // Still run comparison to prevent length-based timing leak
      timingSafeEqual(ba, Buffer.alloc(ba.length));
      return false;
    }
    return timingSafeEqual(ba, bb);
  } catch {
    return false;
  }
}

// ── HMAC-signed tokens ────────────────────────────────────────────────────────
// Use this for any server-issued token (confirm tokens, state params, etc.)
// Never use plain base64 — it's forgeable.
// In production this MUST be set. An unset TOKEN_SECRET makes confirm tokens forgeable.
// Add TOKEN_SECRET to your Vercel env vars: openssl rand -hex 32
const TOKEN_SECRET = (() => {
  const s = process.env.TOKEN_SECRET ?? process.env.CRON_SECRET;
  if (!s && process.env.NODE_ENV === 'production') {
    // Throw at startup — better a crash than silent HMAC weakness
    throw new Error('[registry] TOKEN_SECRET or CRON_SECRET must be set in production');
  }
  return s ?? 'dev-only-fallback-never-use-in-production';
})();

export function signToken(payload: object, expiresInMs = 300_000): string {
  const data = JSON.stringify({ ...payload, exp: Date.now() + expiresInMs });
  const sig  = createHmac('sha256', TOKEN_SECRET).update(data).digest('hex');
  return Buffer.from(JSON.stringify({ data, sig })).toString('base64url');
}

export function verifyToken<T = any>(token: string): T | null {
  try {
    const { data, sig } = JSON.parse(Buffer.from(token, 'base64url').toString());
    const expected = createHmac('sha256', TOKEN_SECRET).update(data).digest('hex');
    if (!safeCompare(sig, expected)) return null;
    const parsed = JSON.parse(data);
    if (parsed.exp < Date.now()) return null; // expired
    return parsed as T;
  } catch {
    return null;
  }
}

// ── SSRF guard — allowlist for external fetches ───────────────────────────────
// Used by ingest to validate URLs before fetching.
// Blocks private IP ranges, localhost, metadata endpoints.
const BLOCKED_PATTERNS = [
  /^https?:\/\/localhost/i,
  /^https?:\/\/127\./,
  /^https?:\/\/0\./,
  /^https?:\/\/10\./,
  /^https?:\/\/172\.(1[6-9]|2[0-9]|3[0-1])\./,
  /^https?:\/\/192\.168\./,
  /^https?:\/\/169\.254\./,               // AWS IMDS v1
  /^https?:\/\/100\.64\./,               // Carrier-grade NAT
  // IPv6 — comprehensive coverage
  /^https?:\/\/\[::1\]/,                 // loopback
  /^https?:\/\/\[::ffff:127\./,          // IPv4-mapped loopback
  /^https?:\/\/\[::ffff:0:127\./,        // IPv4-mapped loopback (alt)
  /^https?:\/\/\[fe80:/i,                // link-local
  /^https?:\/\/\[fc/i,                   // unique-local fc00::/7
  /^https?:\/\/\[fd/i,                   // unique-local fd00::/8
  /^https?:\/\/\[0:0:0:0:0:0:0:1\]/,    // ::1 expanded form
  /metadata\.google\.internal/i,
  /metadata\.amazonaws\.com/i,
  /169\.254\.169\.254/,                  // AWS IMDS (catch without protocol)
];

export function isSafeUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return false;
    for (const pattern of BLOCKED_PATTERNS) {
      if (pattern.test(url)) return false;
    }
    return true;
  } catch {
    return false;
  }
}

// ── Response size guard ────────────────────────────────────────────────────────
// Prevents unbounded memory allocation from large upstream responses.
// Default: 10MB max. Configurable per call.
export const MAX_RESPONSE_BYTES = 10 * 1024 * 1024; // 10MB

export async function readBoundedResponse(
  response: Response,
  maxBytes = MAX_RESPONSE_BYTES
): Promise<{ body: string; truncated: boolean }> {
  const reader  = response.body?.getReader();
  if (!reader) return { body: await response.text(), truncated: false };

  const chunks: Uint8Array[] = [];
  let total = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.length;
    if (total > maxBytes) {
      reader.cancel();
      return {
        body:      new TextDecoder().decode(Buffer.concat(chunks)),
        truncated: true,
      };
    }
    chunks.push(value);
  }

  return {
    body:      new TextDecoder().decode(Buffer.concat(chunks)),
    truncated: false,
  };
}

// ── CORS helper for proxy routes ─────────────────────────────────────────────
// Explicit CORS policy for the proxy API routes.
// We never use * — that would allow any website to call the proxy with
// the user's session cookies, which is a CSRF/session-hijack risk.
// Instead we allow only the production origin and localhost for development.
const ALLOWED_ORIGINS = new Set([
  process.env.NEXT_PUBLIC_APP_URL ?? 'https://openmcp.io',
  'http://localhost:3000',
  'http://localhost:3001',
]);

export function corsHeaders(requestOrigin: string | null): Record<string, string> {
  const origin = requestOrigin && ALLOWED_ORIGINS.has(requestOrigin)
    ? requestOrigin
    : (process.env.NEXT_PUBLIC_APP_URL ?? 'https://openmcp.io');
  return {
    'Access-Control-Allow-Origin':      origin,
    'Access-Control-Allow-Methods':     'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers':     'Content-Type, Authorization, X-Confirm-Token',
    'Access-Control-Allow-Credentials': 'true',
    'Access-Control-Max-Age':           '86400',
    'Vary':                              'Origin',
  };
}
