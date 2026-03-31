/**
 * openMCP — Rate Limiting
 *
 * Uses Upstash Redis when UPSTASH_REDIS_REST_URL is set (production).
 * Falls back to in-memory store for local development.
 *
 * Setup (free tier sufficient for launch):
 *   1. Create a database at console.upstash.com
 *   2. Add to .env.local:
 *      UPSTASH_REDIS_REST_URL=https://...
 *      UPSTASH_REDIS_REST_TOKEN=...
 */

// ── In-memory fallback (development only) ─────────────────────────────────────
const memStore = new Map<string, { count: number; resetAt: number }>();

function memRateLimit(key: string, limit: number, windowMs: number) {
  const now   = Date.now();
  const entry = memStore.get(key);
  if (!entry || now > entry.resetAt) {
    memStore.set(key, { count: 1, resetAt: now + windowMs });
    return { allowed: true, remaining: limit - 1, resetAt: now + windowMs };
  }
  if (entry.count >= limit) return { allowed: false, remaining: 0, resetAt: entry.resetAt };
  entry.count++;
  return { allowed: true, remaining: limit - entry.count, resetAt: entry.resetAt };
}

// Cleanup stale entries every 5 minutes
if (typeof setInterval !== 'undefined') {
  setInterval(() => {
    const now = Date.now();
    for (const [k, v] of memStore) if (now > v.resetAt) memStore.delete(k);
  }, 5 * 60 * 1000);
}

// ── Upstash Redis limiter (production) ────────────────────────────────────────
let upstashClient: any = null;
let upstashRatelimit: any = null;

// Cache Ratelimit instances by config key — creating per request is expensive
const limiterCache = new Map<string, any>();

async function getUpstash() {
  if (!process.env.UPSTASH_REDIS_REST_URL) return null;
  if (upstashRatelimit) return upstashRatelimit;
  try {
    const { Redis }     = await import('@upstash/redis');
    const { Ratelimit } = await import('@upstash/ratelimit');
    upstashClient = new Redis({
      url:   process.env.UPSTASH_REDIS_REST_URL!,
      token: process.env.UPSTASH_REDIS_REST_TOKEN!,
    });
    upstashRatelimit = { Redis, Ratelimit, redis: upstashClient };
    return upstashRatelimit;
  } catch {
    return null;
  }
}

// ── Public API ─────────────────────────────────────────────────────────────────
export interface RateLimitResult {
  allowed:   boolean;
  remaining: number;
  resetAt:   number;
}

export async function rateLimit(
  key:      string,
  config:   { limit: number; windowMs: number }
): Promise<RateLimitResult> {
  const upstash = await getUpstash();

  if (upstash) {
    // Cache limiter instances — creating new Ratelimit per request is expensive
    const cacheKey = `${config.limit}:${config.windowMs}`;
    if (!limiterCache.has(cacheKey)) {
      const { Ratelimit, redis } = upstash;
      limiterCache.set(cacheKey, new Ratelimit({
        redis,
        limiter: Ratelimit.slidingWindow(config.limit, `${config.windowMs}ms`),
        prefix:  'openmcp',
      }));
    }
    const limiter = limiterCache.get(cacheKey);
    const { success, remaining, reset } = await limiter.limit(key);
    return {
      allowed: success,
      remaining,
      resetAt: typeof reset === 'number' ? reset : Date.now() + config.windowMs,
    };
  }

  // In-memory fallback
  return memRateLimit(key, config.limit, config.windowMs);
}

// ── Preset configs ─────────────────────────────────────────────────────────────
export const LIMITS = {
  search:    { limit: 60,  windowMs: 60_000 },   // 60/min per IP
  browse:    { limit: 120, windowMs: 60_000 },   // 120/min per IP
  proxy:     { limit: 30,  windowMs: 60_000 },   // 30/min per IP (unauthenticated)
  proxyAuth: { limit: 200, windowMs: 60_000 },   // 200/min for authed users
  publish:   { limit: 10,  windowMs: 60_000 },   // 10 publishes/min per user
  auth:      { limit: 10,  windowMs: 60_000 },   // 10 auth attempts/min per IP
  mcpServer: { limit: 60,  windowMs: 60_000 },   // 60/min for MCP server calls
  ingest:    { limit: 5,   windowMs: 60_000 },   // 5 ingest triggers/min
};
