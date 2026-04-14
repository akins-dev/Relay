import { Redis } from '@upstash/redis';

// ── In-Memory LRU Cache Fallback ──────────────────────────────────────────────
class MemLRU {
  private cache = new Map<string, { value: any; expiresAt: number }>();
  private readonly maxSize: number;

  constructor(maxSize = 1000) {
    this.maxSize = maxSize;
  }

  get(key: string): any | null {
    const entry = this.cache.get(key);
    if (!entry) return null;
    if (Date.now() > entry.expiresAt) {
      this.cache.delete(key);
      return null;
    }
    // Refresh position for LRU
    this.cache.delete(key);
    this.cache.set(key, entry);
    return entry.value;
  }

  set(key: string, value: any, ttlSeconds: number) {
    if (this.cache.size >= this.maxSize) {
      // Delete oldest entry
      const firstKey = this.cache.keys().next().value;
      if (firstKey) this.cache.delete(firstKey);
    }
    this.cache.set(key, { value, expiresAt: Date.now() + ttlSeconds * 1000 });
  }

  // Clear expired automatically occasionally
  cleanup() {
    const now = Date.now();
    for (const [k, v] of this.cache) {
      if (now > v.expiresAt) this.cache.delete(k);
    }
  }
}

// ── Edge Cache Abstraction ──────────────────────────────────────────────────
let redisClient: Redis | null = null;
let initialized = false;
const memCache = new MemLRU(5000); // Max 5000 items

function initRedis() {
  if (initialized) return redisClient;
  initialized = true;
  if (process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN) {
    redisClient = new Redis({
      url: process.env.UPSTASH_REDIS_REST_URL,
      token: process.env.UPSTASH_REDIS_REST_TOKEN,
    });
  }
  
  // Cleanup task for memCache if no Redis
  if (!redisClient && typeof setInterval !== 'undefined') {
    setInterval(() => memCache.cleanup(), 60_000).unref();
  }
  
  return redisClient;
}

/**
 * Universal get/set cache that seamlessly uses Upstash Redis if configured,
 * otherwise falls back to a fast in-memory LRU map.
 */
export async function getCache<T>(key: string): Promise<T | null> {
  const redis = initRedis();
  if (redis) {
    try {
      return (await redis.get(key)) as T | null;
    } catch {
      return memCache.get(key);
    }
  }
  return memCache.get(key);
}

export async function setCache(key: string, value: any, ttlSeconds: number = 300): Promise<void> {
  const redis = initRedis();
  if (redis) {
    try {
      await redis.set(key, value, { ex: ttlSeconds });
    } catch {
      memCache.set(key, value, ttlSeconds);
    }
  } else {
    memCache.set(key, value, ttlSeconds);
  }
}

/**
 * Fetch with Cache wrapper.
 * Will fetch using the getter and populate cache if missing.
 */
export async function withCache<T>(
  key: string, 
  ttlSeconds: number, 
  getter: () => Promise<T>
): Promise<T> {
  const cached = await getCache<T>(key);
  if (cached !== null && cached !== undefined) return cached;

  const value = await getter();
  if (value !== null && value !== undefined) {
    // Fire & forget cache population
    setCache(key, value, ttlSeconds).catch(() => {});
  }
  return value;
}
