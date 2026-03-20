/**
 * Simple in-memory rate limiter.
 * Uses a sliding window counter per key.
 * For production at scale, swap backing store to Upstash Redis.
 */

interface Window {
  count:      number;
  resetAt:    number;
}

const store = new Map<string, Window>();

export interface RateLimitConfig {
  limit:      number;  // max requests
  windowMs:   number;  // window in ms
}

export interface RateLimitResult {
  allowed:    boolean;
  remaining:  number;
  resetAt:    number;
}

export function rateLimit(key: string, config: RateLimitConfig): RateLimitResult {
  const now   = Date.now();
  const entry = store.get(key);

  if (!entry || now > entry.resetAt) {
    const resetAt = now + config.windowMs;
    store.set(key, { count: 1, resetAt });
    return { allowed: true, remaining: config.limit - 1, resetAt };
  }

  if (entry.count >= config.limit) {
    return { allowed: false, remaining: 0, resetAt: entry.resetAt };
  }

  entry.count++;
  return { allowed: true, remaining: config.limit - entry.count, resetAt: entry.resetAt };
}

// Cleanup old entries every 5 minutes (prevents memory leak)
if (typeof setInterval !== 'undefined') {
  setInterval(() => {
    const now = Date.now();
    for (const [key, entry] of store.entries()) {
      if (now > entry.resetAt) store.delete(key);
    }
  }, 5 * 60 * 1000);
}

// ── Preset configs ────────────────────────────────────────────────────────────
export const LIMITS = {
  // Public read endpoints
  search:    { limit: 60,  windowMs: 60_000 },  // 60/min per IP
  browse:    { limit: 120, windowMs: 60_000 },  // 120/min per IP

  // Proxy — most sensitive, must rate limit hard
  proxy:     { limit: 30,  windowMs: 60_000 },  // 30 calls/min per IP
  proxyAuth: { limit: 100, windowMs: 60_000 },  // 100/min for authed users

  // Write endpoints
  publish:   { limit: 10,  windowMs: 60_000 },  // 10 publishes/min per user
  auth:      { limit: 10,  windowMs: 60_000 },  // 10 auth attempts/min per IP
  apiKeys:   { limit: 20,  windowMs: 60_000 },  // 20 key ops/min per user
};
