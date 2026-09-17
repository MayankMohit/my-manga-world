import mongoose from "mongoose";
import { env } from "@/lib/env";
import { logger } from "@/lib/logger";

/**
 * Mongoose singleton. Cached on `globalThis` so Next.js hot reloads and multiple
 * serverless invocations reuse a single connection. `sanitizeFilter` is enabled
 * globally to guard against operator injection from user input.
 */

mongoose.set("sanitizeFilter", true);
mongoose.set("strictQuery", true);

interface MongooseCache {
  conn: typeof mongoose | null;
  promise: Promise<typeof mongoose> | null;
}

const globalForMongoose = globalThis as unknown as {
  __shelfMongoose?: MongooseCache;
};

const cache: MongooseCache = globalForMongoose.__shelfMongoose ?? {
  conn: null,
  promise: null,
};
globalForMongoose.__shelfMongoose = cache;

export async function connectToDatabase(): Promise<typeof mongoose> {
  if (cache.conn) return cache.conn;

  if (!cache.promise) {
    cache.promise = mongoose
      .connect(env.MONGODB_URI, {
        serverSelectionTimeoutMS: 5000,
        maxPoolSize: 10,
      })
      .then((m) => {
        logger.info("Connected to MongoDB");
        return m;
      })
      .catch((err) => {
        cache.promise = null;
        logger.error({ err }, "MongoDB connection failed");
        throw err;
      });
  }

  cache.conn = await cache.promise;
  return cache.conn;
}
