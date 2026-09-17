import { randomUUID } from "node:crypto";
import pino, { type Logger } from "pino";
import { env, isProduction } from "@/lib/env";

/**
 * Structured logging with pino. Emits JSON (pipe through `pino-pretty` in dev if
 * desired). Secrets are redacted defensively; never log tokens, passwords, or
 * presigned URLs directly.
 */
export const logger: Logger = pino({
  level: env.LOG_LEVEL ?? (isProduction ? "info" : "debug"),
  redact: {
    paths: [
      "password",
      "passwordHash",
      "token",
      "accessToken",
      "refreshToken",
      "authorization",
      "cookie",
      "set-cookie",
      "url",
      "presignedUrl",
      "*.password",
      "*.token",
      "*.authorization",
      "req.headers.authorization",
      "req.headers.cookie",
    ],
    censor: "[redacted]",
  },
});

/** Create a request-scoped id for correlating logs across a request lifecycle. */
export function newRequestId(): string {
  return randomUUID();
}

/** Child logger bound to a request id. */
export function requestLogger(requestId: string): Logger {
  return logger.child({ requestId });
}
