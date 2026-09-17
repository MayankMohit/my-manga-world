/**
 * Auth constants shared by route handlers, the proxy gate, and client helpers.
 * No server-only or node-only imports here so the edge proxy can use it too.
 */

/** httpOnly cookie holding the short-lived JWT access token. */
export const ACCESS_COOKIE = "shelf_at";

/** httpOnly cookie holding the opaque refresh token. */
export const REFRESH_COOKIE = "shelf_rt";

/**
 * The refresh cookie is scoped to the auth API so it is never sent on ordinary
 * navigations or content requests, shrinking its exposure.
 */
export const REFRESH_COOKIE_PATH = "/api/auth";

/** JWT audience claim. */
export const JWT_AUDIENCE = "shelf";

/** Redis key prefix for the access-token (jti) denylist. */
export const DENYLIST_PREFIX = "denylist:jti";

/**
 * Routes that require an authenticated user (prefix match). `/upload` is
 * deliberately absent: uploading is allowed anonymously (claim-on-auth, D26).
 * Reading (`/read`) and the library stay gated.
 */
export const PROTECTED_PREFIXES = ["/library", "/series", "/read", "/settings"] as const;

/** Auth-only routes a signed-in user should be redirected away from. */
export const AUTH_PAGES = ["/login", "/signup"] as const;
