import { NextResponse } from "next/server";
import { connectToDatabase } from "@/lib/db";
import { redis } from "@/lib/redis";
import { checkR2Health } from "@/lib/r2";
import { logger } from "@/lib/logger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Check = "ok" | "error";

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(`timeout after ${ms}ms`)), ms),
    ),
  ]);
}

async function checkMongo(): Promise<Check> {
  const m = await withTimeout(connectToDatabase(), 4000);
  await withTimeout(m.connection.db!.admin().ping(), 2000);
  return "ok";
}

async function checkRedis(): Promise<Check> {
  const pong = await withTimeout(redis.ping(), 2000);
  return pong === "PONG" ? "ok" : "error";
}

async function safe(name: string, fn: () => Promise<Check>): Promise<Check> {
  try {
    return await fn();
  } catch (err) {
    logger.warn({ err, check: name }, "Health check failed");
    return "error";
  }
}

export async function GET() {
  const [mongo, redisStatus, r2] = await Promise.all([
    safe("mongo", checkMongo),
    safe("redis", checkRedis),
    safe("r2", () => withTimeout(checkR2Health(), 4000).then<Check>(() => "ok")),
  ]);

  const checks = { mongo, redis: redisStatus, r2 };
  const healthy = Object.values(checks).every((c) => c === "ok");

  return NextResponse.json(
    { status: healthy ? "ok" : "degraded", checks },
    { status: healthy ? 200 : 503, headers: { "cache-control": "no-store" } },
  );
}
