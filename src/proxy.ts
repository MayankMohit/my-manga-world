import { NextResponse, type NextRequest } from "next/server";

/**
 * Proxy (Next.js 16's renamed Middleware). Edge-safe. For now it only attaches a
 * request id so route handlers and logs can correlate. Phase 2 adds the
 * optimistic access-token gate for protected routes.
 */
export function proxy(request: NextRequest) {
  const requestId = request.headers.get("x-request-id") ?? crypto.randomUUID();

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-request-id", requestId);

  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set("x-request-id", requestId);
  return response;
}

export const config = {
  matcher: [
    // Run on everything except Next internals and common static files.
    "/((?!_next/static|_next/image|favicon.ico|manifest.webmanifest|robots.txt|sitemap.xml|sw.js|.*\\.(?:png|jpg|jpeg|gif|webp|svg|ico|woff2?)$).*)",
  ],
};
