export interface RateLimitOptions {
  limit: number;
  windowMs: number;
  now?: () => number;
}

export interface RateLimitDecision {
  allowed: boolean;
  remaining: number;
  retryAfterSeconds: number;
}

interface Bucket {
  count: number;
  resetAt: number;
}

export function getRateLimitPerMinute(raw: string | undefined): number {
  const parsed = raw ? Number.parseInt(raw, 10) : Number.NaN;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 120;
}

export function createFixedWindowRateLimiter(options: RateLimitOptions): { check: (key: string) => RateLimitDecision } {
  const now = options.now ?? Date.now;
  const buckets = new Map<string, Bucket>();

  return {
    check(key: string): RateLimitDecision {
      const currentTime = now();
      const existing = buckets.get(key);
      const bucket = !existing || existing.resetAt <= currentTime
        ? { count: 0, resetAt: currentTime + options.windowMs }
        : existing;

      if (bucket.count >= options.limit) {
        buckets.set(key, bucket);
        return {
          allowed: false,
          remaining: 0,
          retryAfterSeconds: Math.max(1, Math.ceil((bucket.resetAt - currentTime) / 1000)),
        };
      }

      bucket.count += 1;
      buckets.set(key, bucket);
      return {
        allowed: true,
        remaining: Math.max(0, options.limit - bucket.count),
        retryAfterSeconds: 0,
      };
    },
  };
}
