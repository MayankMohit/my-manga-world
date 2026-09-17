import { z } from "zod";
import { NextResponse } from "next/server";
import { env } from "@/lib/env";
import { ApiError } from "@/lib/errors";

/** JSON response helper. */
export function json<T>(data: T, init?: ResponseInit): NextResponse<T> {
  return NextResponse.json(data, init);
}

/** Zod schema for a MongoDB ObjectId string. */
export const objectIdSchema = z.string().regex(/^[0-9a-fA-F]{24}$/, "Invalid id");

/** Parse and validate a JSON request body. Throws `ApiError` on failure. */
export async function parseBody<S extends z.ZodTypeAny>(
  req: Request,
  schema: S,
): Promise<z.infer<S>> {
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    throw ApiError.badRequest("Request body must be valid JSON");
  }
  const result = schema.safeParse(raw);
  if (!result.success) {
    throw ApiError.validation("Invalid request body", z.flattenError(result.error));
  }
  return result.data;
}

/** Parse and validate query parameters. Throws `ApiError` on failure. */
export function parseQuery<S extends z.ZodTypeAny>(
  searchParams: URLSearchParams,
  schema: S,
): z.infer<S> {
  const result = schema.safeParse(Object.fromEntries(searchParams.entries()));
  if (!result.success) {
    throw ApiError.validation("Invalid query parameters", z.flattenError(result.error));
  }
  return result.data;
}

const STATE_CHANGING = new Set(["POST", "PUT", "PATCH", "DELETE"]);

/**
 * CSRF defense: for state-changing requests, require an Origin (or Referer)
 * header whose origin matches APP_URL. Combined with SameSite=Lax cookies this
 * blocks cross-site form/fetch attacks.
 */
export function assertSameOrigin(req: Request): void {
  if (!STATE_CHANGING.has(req.method)) return;

  const appOrigin = new URL(env.APP_URL).origin;
  const origin = req.headers.get("origin");
  if (origin) {
    if (origin !== appOrigin) throw ApiError.forbidden("Cross-origin request rejected");
    return;
  }
  const referer = req.headers.get("referer");
  if (referer) {
    try {
      if (new URL(referer).origin !== appOrigin) {
        throw ApiError.forbidden("Cross-origin request rejected");
      }
      return;
    } catch {
      throw ApiError.forbidden("Invalid Referer header");
    }
  }
  throw ApiError.forbidden("Missing Origin header on state-changing request");
}
