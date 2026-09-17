import { z, ZodError } from "zod";
import { NextResponse } from "next/server";
import { logger, newRequestId } from "@/lib/logger";

/**
 * Typed API errors and a route wrapper that turns thrown errors into the
 * consistent shape `{ error: { code, message, details? } }`. Stack traces are
 * logged server-side but never returned to clients.
 */

export type ErrorCode =
  | "BAD_REQUEST"
  | "UNAUTHENTICATED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "VALIDATION"
  | "CONFLICT"
  | "QUOTA_EXCEEDED"
  | "RATE_LIMITED"
  | "INTERNAL";

const STATUS_BY_CODE: Record<ErrorCode, number> = {
  BAD_REQUEST: 400,
  UNAUTHENTICATED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  VALIDATION: 422,
  CONFLICT: 409,
  QUOTA_EXCEEDED: 413,
  RATE_LIMITED: 429,
  INTERNAL: 500,
};

export class ApiError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  readonly details?: unknown;
  readonly headers?: Record<string, string>;

  constructor(
    code: ErrorCode,
    message: string,
    options?: { details?: unknown; headers?: Record<string, string> },
  ) {
    super(message);
    this.name = "ApiError";
    this.code = code;
    this.status = STATUS_BY_CODE[code];
    this.details = options?.details;
    this.headers = options?.headers;
  }

  static badRequest(message = "Bad request", details?: unknown) {
    return new ApiError("BAD_REQUEST", message, { details });
  }
  static unauthenticated(message = "Authentication required") {
    return new ApiError("UNAUTHENTICATED", message);
  }
  static forbidden(message = "You do not have access to this resource") {
    return new ApiError("FORBIDDEN", message);
  }
  static notFound(message = "Not found") {
    return new ApiError("NOT_FOUND", message);
  }
  static validation(message = "Validation failed", details?: unknown) {
    return new ApiError("VALIDATION", message, { details });
  }
  static conflict(message = "Conflict") {
    return new ApiError("CONFLICT", message);
  }
  static quota(message = "Storage quota exceeded") {
    return new ApiError("QUOTA_EXCEEDED", message);
  }
  static rateLimited(message = "Too many requests", retryAfterSeconds?: number) {
    const headers = retryAfterSeconds
      ? { "Retry-After": String(retryAfterSeconds) }
      : undefined;
    return new ApiError("RATE_LIMITED", message, { headers });
  }
  static internal(message = "Something went wrong") {
    return new ApiError("INTERNAL", message);
  }
}

interface ErrorBody {
  error: { code: ErrorCode; message: string; details?: unknown };
}

function buildResponse(err: ApiError, requestId: string): NextResponse<ErrorBody> {
  const body: ErrorBody = {
    error: { code: err.code, message: err.message, details: err.details },
  };
  const res = NextResponse.json(body, { status: err.status });
  res.headers.set("x-request-id", requestId);
  if (err.headers) {
    for (const [k, v] of Object.entries(err.headers)) res.headers.set(k, v);
  }
  return res;
}

/** Convert any thrown value into a safe JSON error response. */
export function toErrorResponse(
  error: unknown,
  requestId: string,
): NextResponse<ErrorBody> {
  if (error instanceof ApiError) {
    return buildResponse(error, requestId);
  }
  if (error instanceof ZodError) {
    return buildResponse(
      ApiError.validation("Invalid input", z.flattenError(error)),
      requestId,
    );
  }
  logger.error({ err: error, requestId }, "Unhandled route error");
  return buildResponse(ApiError.internal(), requestId);
}

type RouteHandler<C> = (req: Request, ctx: C) => Promise<Response> | Response;

/**
 * Wrap a route handler so thrown errors become the standard error shape and
 * every response carries a request id. Handlers can throw `ApiError` freely.
 */
export function withRoute<C>(handler: RouteHandler<C>): RouteHandler<C> {
  return async (req, ctx) => {
    const requestId = req.headers.get("x-request-id") ?? newRequestId();
    try {
      const res = await handler(req, ctx);
      if (!res.headers.has("x-request-id")) {
        res.headers.set("x-request-id", requestId);
      }
      return res;
    } catch (error) {
      return toErrorResponse(error, requestId);
    }
  };
}
