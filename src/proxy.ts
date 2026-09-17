import { NextResponse, type NextRequest } from "next/server";
import { verifyAccessToken } from "@/lib/auth/access-token";
import {
  ACCESS_COOKIE,
  REFRESH_COOKIE,
  PROTECTED_PREFIXES,
  AUTH_PAGES,
} from "@/lib/auth/constants";

/**
 * Proxy (Next.js 16's renamed Middleware). Edge-safe: imports only jose + env +
 * plain constants. It attaches a request id and does an OPTIMISTIC auth gate:
 *  - valid access token on an auth page -> send to /library
 *  - no auth at all on a protected page -> send to /login?next=...
 *  - expired access but a refresh cookie present -> allow through (the client
 *    refreshes via /api/auth/refresh; server components still enforce via
 *    requireAuth()). Full revocation checks live in requireAuth(), not here.
 */
function isProtected(pathname: string): boolean {
  return PROTECTED_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

function isAuthPage(pathname: string): boolean {
  return (AUTH_PAGES as readonly string[]).includes(pathname);
}

export async function proxy(request: NextRequest) {
  const requestId = request.headers.get("x-request-id") ?? crypto.randomUUID();
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-request-id", requestId);

  const pass = () => {
    const response = NextResponse.next({ request: { headers: requestHeaders } });
    response.headers.set("x-request-id", requestId);
    return response;
  };

  const redirect = (path: string) => {
    const url = new URL(path, request.url);
    const response = NextResponse.redirect(url);
    response.headers.set("x-request-id", requestId);
    return response;
  };

  const { pathname } = request.nextUrl;

  const accessToken = request.cookies.get(ACCESS_COOKIE)?.value;
  const hasRefresh = Boolean(request.cookies.get(REFRESH_COOKIE)?.value);
  const authed = accessToken ? Boolean(await verifyAccessToken(accessToken)) : false;

  if (authed) {
    if (isAuthPage(pathname)) return redirect("/library");
    return pass();
  }

  if (isProtected(pathname)) {
    if (hasRefresh) return pass(); // optimistic: client will refresh
    const loginUrl = new URL("/login", request.url);
    loginUrl.searchParams.set("next", pathname);
    const response = NextResponse.redirect(loginUrl);
    response.headers.set("x-request-id", requestId);
    return response;
  }

  return pass();
}

export const config = {
  matcher: [
    // Run on everything except Next internals and common static files.
    "/((?!_next/static|_next/image|favicon.ico|manifest.webmanifest|robots.txt|sitemap.xml|sw.js|.*\\.(?:png|jpg|jpeg|gif|webp|svg|ico|woff2?)$).*)",
  ],
};
