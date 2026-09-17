import { redis } from "@/lib/redis";
import { logger } from "@/lib/logger";
import { ApiError } from "@/lib/errors";
import { CACHE_PREFIX } from "@/lib/shared/constants";

/**
 * Fixed-window rate limiting backed by Redis (INCR + EXPIRE). Auth tiers fail
 * CLOSED (a Redis outage blocks the request) so brute-force protection can never
 * be silently disabled; content tiers fail OPEN so a cache outage does not take
 * the app down (Decision D8).
 */

export type RateLimitTier =
  "auth-strict" | "auth-refresh" | "upload" | "write" | "read" | "progress";

interface TierConfig {
  limit: number;
  windowSeconds: number;
  failClosed: boolean;
}

export const RATE_LIMIT_TIERS: Record<RateLimitTier, TierConfig> = {
  "auth-strict": { limit: 10, windowSeconds: 60, failClosed: true },
  "auth-refresh": { limit: 60, windowSeconds: 60, failClosed: true },
  upload: { limit: 60, windowSeconds: 60, failClosed: false },
  write: { limit: 120, windowSeconds: 60, failClosed: false },
  read: { limit: 300, windowSeconds: 60, failClosed: false },
  progress: { limit: 600, windowSeconds: 60, failClosed: false },
};

/** Best-effort client IP from proxy headers, falling back to a constant. */
export function getClientIp(req: Request): string {
  const xff = req.headers.get("x-forwarded-for");
  if (xff) {
    const first = xff.split(",")[0]?.trim();
    if (first) return first;
  }
  return req.headers.get("x-real-ip")?.trim() || "unknown";
}

/**
 * Enforce a rate-limit tier for `identifier` (usually an IP). Throws
 * `ApiError.rateLimited` (429 with Retry-After) when the window is exceeded.
 */
export async function enforceRateLimit(
  tier: RateLimitTier,
  identifier: string,
): Promise<void> {
  const { limit, windowSeconds, failClosed } = RATE_LIMIT_TIERS[tier];
  const key = `${CACHE_PREFIX}:rl:${tier}:${identifier}`;

  let count: number;
  try {
    count = await redis.incr(key);
    if (count === 1) await redis.expire(key, windowSeconds);
  } catch (err) {
    if (failClosed) {
      logger.error({ err, tier }, "Rate limiter unavailable; failing closed");
      throw ApiError.rateLimited("Service temporarily unavailable", windowSeconds);
    }
    logger.error({ err, tier }, "Rate limiter unavailable; failing open");
    return;
  }

  if (count > limit) {
    let ttl = windowSeconds;
    try {
      const remaining = await redis.ttl(key);
      if (remaining > 0) ttl = remaining;
    } catch {
      // keep the default window
    }
    throw ApiError.rateLimited("Too many requests", ttl);
  }
}
