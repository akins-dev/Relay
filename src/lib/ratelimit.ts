import { BRAND } from '@/lib/brand';

/**
 * Rate Limiting
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
    try {
      // Cache limiter instances — creating new Ratelimit per request is expensive
      const cacheKey = `${config.limit}:${config.windowMs}`;
      if (!limiterCache.has(cacheKey)) {
        const { Ratelimit, redis } = upstash;
        limiterCache.set(cacheKey, new Ratelimit({
          redis,
          limiter: Ratelimit.slidingWindow(config.limit, `${config.windowMs}ms`),
          prefix:  BRAND.slug,
        }));
      }
      const limiter = limiterCache.get(cacheKey);
      const { success, remaining, reset } = await limiter.limit(key);
      return {
        allowed: success,
        remaining,
        resetAt: typeof reset === 'number' ? reset : Date.now() + config.windowMs,
      };
    } catch (error: any) {
      // Development and some local environments may have stale or unreachable
      // Upstash credentials configured. Rate limiting should degrade gracefully.
      console.warn('[ratelimit] Upstash unavailable, falling back to in-memory limiter:', error?.message ?? 'unknown error');
      return memRateLimit(key, config.limit, config.windowMs);
    }
  }

  // In-memory fallback
  return memRateLimit(key, config.limit, config.windowMs);
}

// ── Preset configs (hardcoded defaults) ───────────────────────────────────────
// These are the fallback values used when the DB config is unavailable.
// In production, values in the rate_limit_config table override these.
// Admins can adjust live via the admin panel → Config tab.
export const LIMITS: Record<string, { limit: number; windowMs: number }> = {
  search:    { limit: 60,  windowMs: 60_000 },
  browse:    { limit: 120, windowMs: 60_000 },
  proxy:     { limit: 30,  windowMs: 60_000 },
  proxyAuth: { limit: 200, windowMs: 60_000 },
  publish:   { limit: 10,  windowMs: 60_000 },
  auth:      { limit: 10,  windowMs: 60_000 },
  mcpServer: { limit: 60,  windowMs: 60_000 },
  ingest:    { limit: 5,   windowMs: 60_000 },
};

// ── DB-driven rate limit config ────────────────────────────────────────────────
// Reads live config from rate_limit_config table (Migration 023).
// Cached for 5 minutes so admin changes take effect without restart.
// Falls back to LIMITS defaults if DB is unavailable or row missing.

let dbLimitsCache: Map<string, { limit: number; windowMs: number }> | null = null;
let dbLimitsCachedAt = 0;
const DB_LIMITS_TTL = 5 * 60 * 1000; // 5 minutes

async function getDbLimits(): Promise<Map<string, { limit: number; windowMs: number }>> {
  const now = Date.now();
  if (dbLimitsCache && now - dbLimitsCachedAt < DB_LIMITS_TTL) {
    return dbLimitsCache;
  }
  try {
    // Dynamic import to avoid circular deps at module load time
    const { createServiceClient } = await import('@/lib/supabase/server');
    const svc = createServiceClient();
    const { data } = await svc
      .from('rate_limit_config')
      .select('context, limit_count, window_ms')
      .eq('enabled', true);

    if (data && data.length > 0) {
      const map = new Map<string, { limit: number; windowMs: number }>();
      for (const row of data) {
        map.set(row.context, { limit: row.limit_count, windowMs: row.window_ms });
      }
      dbLimitsCache = map;
      dbLimitsCachedAt = now;
      return map;
    }
  } catch {
    // Non-fatal — fallback to hardcoded defaults
  }
  return new Map();
}

/**
 * Get effective rate limit config for a context.
 * Checks DB first (live admin config), falls back to LIMITS defaults.
 */
export async function getLimitConfig(context: keyof typeof LIMITS): Promise<{ limit: number; windowMs: number }> {
  const dbLimits = await getDbLimits();
  return dbLimits.get(context as string) ?? LIMITS[context];
}
