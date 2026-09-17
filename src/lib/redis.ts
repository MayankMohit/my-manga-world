import Redis, { type RedisOptions } from "ioredis";
import { env } from "@/lib/env";
import { logger } from "@/lib/logger";

/**
 * ioredis singleton for caching, rate limiting, token denylist, and lockout.
 * Cached on `globalThis` to survive Next.js hot reloads. BullMQ gets its own
 * connections (created in the worker) because it requires
 * `maxRetriesPerRequest: null` on its blocking clients.
 */

const globalForRedis = globalThis as unknown as {
  __shelfRedis?: Redis;
};

function createClient(): Redis {
  const options: RedisOptions = {
    maxRetriesPerRequest: 3,
    enableReadyCheck: true,
    lazyConnect: false,
    retryStrategy: (times) => Math.min(times * 200, 2000),
  };
  const client = new Redis(env.REDIS_URL, options);
  client.on("error", (err) => logger.error({ err }, "Redis error"));
  client.on("connect", () => logger.info("Connected to Redis"));
  return client;
}

export const redis: Redis = globalForRedis.__shelfRedis ?? createClient();
globalForRedis.__shelfRedis = redis;
