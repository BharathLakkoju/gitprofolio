/**
 * In-memory sliding-window rate limiter.
 *
 * NOTE: Serverless runtimes (e.g. Vercel) do not share memory across
 * function instances, so this provides best-effort protection within a
 * single warm instance. For cross-instance enforcement use a shared
 * store such as Redis / Vercel KV.
 */

interface RateRecord {
  timestamps: number[];
}

const store = new Map<string, RateRecord>();
let lastCleanup = Date.now();

/** Evict stale entries to prevent unbounded memory growth. */
function maybeCleanup(windowMs: number): void {
  const now = Date.now();
  if (now - lastCleanup < 60_000) return;
  lastCleanup = now;
  const cutoff = now - windowMs;
  for (const [key, record] of store.entries()) {
    record.timestamps = record.timestamps.filter((t) => t > cutoff);
    if (record.timestamps.length === 0) store.delete(key);
  }
}

/**
 * Returns true if `key` has exceeded `limit` requests within `windowMs`.
 * Counts the current request only when NOT rate-limited.
 */
export function isRateLimited(key: string, limit: number, windowMs: number): boolean {
  maybeCleanup(windowMs);
  const now = Date.now();
  const cutoff = now - windowMs;
  const record = store.get(key) ?? { timestamps: [] };
  record.timestamps = record.timestamps.filter((t) => t > cutoff);
  if (record.timestamps.length >= limit) {
    store.set(key, record);
    return true;
  }
  record.timestamps.push(now);
  store.set(key, record);
  return false;
}

/** Extract a best-effort client IP from a Request object. */
export function getClientIp(request: Request): string {
  // Vercel and most reverse proxies set x-forwarded-for.
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0].trim();
  return "unknown";
}
