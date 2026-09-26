/**
 * Minimal fixed-window rate limiter for unauthenticated public endpoints.
 *
 * State is per server process (the app runs as a single container per
 * environment), so this is a containment control against bulk enumeration,
 * not a distributed quota.
 */

type Bucket = { count: number; resetAt: number }

const buckets = new Map<string, Bucket>()
const MAX_TRACKED_KEYS = 10_000

export type RateLimitResult = { allowed: true } | { allowed: false; retryAfterSeconds: number }

export function checkRateLimit(key: string, limit: number, windowMs: number, now = Date.now()): RateLimitResult {
  const bucket = buckets.get(key)

  if (!bucket || bucket.resetAt <= now) {
    if (buckets.size >= MAX_TRACKED_KEYS) {
      for (const [storedKey, stored] of buckets) {
        if (stored.resetAt <= now) buckets.delete(storedKey)
      }
      if (buckets.size >= MAX_TRACKED_KEYS) buckets.clear()
    }
    buckets.set(key, { count: 1, resetAt: now + windowMs })
    return { allowed: true }
  }

  if (bucket.count >= limit) {
    return { allowed: false, retryAfterSeconds: Math.max(1, Math.ceil((bucket.resetAt - now) / 1000)) }
  }

  bucket.count += 1
  return { allowed: true }
}

export function clientIpFromHeaders(headers: Headers): string {
  return (
    headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    headers.get('x-real-ip')?.trim() ||
    'unknown'
  )
}

export function resetRateLimitsForTests() {
  buckets.clear()
}
