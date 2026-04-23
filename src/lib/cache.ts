/**
 * In-memory TTL cache.
 *
 * NOTE: Same serverless caveat as rate-limiter.ts — entries are local to
 * the function instance and not shared across invocations. Provides
 * meaningful deduplication when the function is warm (same instance
 * serves repeated requests within the TTL window).
 */

interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}

// biome-ignore lint/suspicious/noExplicitAny: generic cache value
const store = new Map<string, CacheEntry<any>>();

export function cacheGet<T>(key: string): T | null {
  const entry = store.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    store.delete(key);
    return null;
  }
  return entry.value as T;
}

export function cacheSet<T>(key: string, value: T, ttlMs: number): void {
  store.set(key, { value, expiresAt: Date.now() + ttlMs });
}
