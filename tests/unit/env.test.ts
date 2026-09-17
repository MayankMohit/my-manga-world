import { describe, it, expect } from "vitest";
import { parseEnv } from "@/lib/env";

const base = {
  APP_URL: "http://localhost:3000",
  MONGODB_URI: "mongodb://localhost:27017/shelf",
  REDIS_URL: "redis://localhost:6379",
  JWT_ACCESS_SECRET: "a".repeat(32),
  JWT_REFRESH_SECRET: "b".repeat(32),
  R2_ACCOUNT_ID: "acc",
  R2_ACCESS_KEY_ID: "key",
  R2_SECRET_ACCESS_KEY: "secret",
  R2_BUCKET: "bucket",
} as unknown as NodeJS.ProcessEnv;

describe("parseEnv", () => {
  it("parses a valid environment with defaults applied", () => {
    const env = parseEnv(base);
    expect(env.APP_URL).toBe("http://localhost:3000");
    expect(env.JWT_ACCESS_TTL).toBe(900);
    expect(env.JWT_REFRESH_TTL).toBe(2592000);
    expect(env.SIGNUPS_OPEN).toBe(false);
    expect(env.INVITE_TTL).toBe(604800);
    expect(env.NODE_ENV).toBe("development");
  });

  it("coerces numeric strings", () => {
    const env = parseEnv({ ...base, JWT_ACCESS_TTL: "60", MAX_ENTRIES: "10" });
    expect(env.JWT_ACCESS_TTL).toBe(60);
    expect(env.MAX_ENTRIES).toBe(10);
  });

  it("parses SIGNUPS_OPEN boolean strings", () => {
    expect(parseEnv({ ...base, SIGNUPS_OPEN: "true" }).SIGNUPS_OPEN).toBe(true);
    expect(parseEnv({ ...base, SIGNUPS_OPEN: "1" }).SIGNUPS_OPEN).toBe(true);
    expect(parseEnv({ ...base, SIGNUPS_OPEN: "false" }).SIGNUPS_OPEN).toBe(false);
  });

  it("rejects a missing required variable", () => {
    const { MONGODB_URI, ...rest } = base;
    void MONGODB_URI;
    expect(() => parseEnv(rest as NodeJS.ProcessEnv)).toThrow(/MONGODB_URI/);
  });

  it("rejects a short JWT secret", () => {
    expect(() => parseEnv({ ...base, JWT_ACCESS_SECRET: "short" })).toThrow(
      /JWT_ACCESS_SECRET/,
    );
  });

  it("rejects identical access and refresh secrets", () => {
    expect(() => parseEnv({ ...base, JWT_REFRESH_SECRET: "a".repeat(32) })).toThrow(
      /different/,
    );
  });

  it("rejects an invalid APP_URL", () => {
    expect(() => parseEnv({ ...base, APP_URL: "not-a-url" })).toThrow(/APP_URL/);
  });

  it("treats an empty BOOTSTRAP_ADMIN_EMAIL as undefined", () => {
    expect(parseEnv({ ...base, BOOTSTRAP_ADMIN_EMAIL: "" }).BOOTSTRAP_ADMIN_EMAIL).toBe(
      undefined,
    );
  });
});
