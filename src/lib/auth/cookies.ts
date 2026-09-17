import "server-only";
import { cookies } from "next/headers";
import { env, isProduction } from "@/lib/env";
import { ACCESS_COOKIE, REFRESH_COOKIE, REFRESH_COOKIE_PATH } from "@/lib/auth/constants";

/**
 * Auth cookie management. Both cookies are httpOnly + SameSite=Lax and Secure in
 * production. The access cookie is site-wide (`path=/`); the refresh cookie is
 * scoped to `/api/auth` so it is only sent when refreshing.
 */

export async function setAuthCookies(input: {
  accessToken: string;
  accessExp: number; // seconds since epoch
  refreshToken: string;
}): Promise<void> {
  const store = await cookies();
  const secure = isProduction;

  store.set(ACCESS_COOKIE, input.accessToken, {
    httpOnly: true,
    secure,
    sameSite: "lax",
    path: "/",
    expires: new Date(input.accessExp * 1000),
  });

  store.set(REFRESH_COOKIE, input.refreshToken, {
    httpOnly: true,
    secure,
    sameSite: "lax",
    path: REFRESH_COOKIE_PATH,
    maxAge: env.JWT_REFRESH_TTL,
  });
}

/** Update only the access cookie (used after a password change reissues it). */
export async function setAccessCookie(
  accessToken: string,
  accessExp: number,
): Promise<void> {
  const store = await cookies();
  store.set(ACCESS_COOKIE, accessToken, {
    httpOnly: true,
    secure: isProduction,
    sameSite: "lax",
    path: "/",
    expires: new Date(accessExp * 1000),
  });
}

export async function clearAuthCookies(): Promise<void> {
  const store = await cookies();
  store.set(ACCESS_COOKIE, "", {
    httpOnly: true,
    secure: isProduction,
    sameSite: "lax",
    path: "/",
    maxAge: 0,
  });
  store.set(REFRESH_COOKIE, "", {
    httpOnly: true,
    secure: isProduction,
    sameSite: "lax",
    path: REFRESH_COOKIE_PATH,
    maxAge: 0,
  });
}

export async function readAccessCookie(): Promise<string | undefined> {
  return (await cookies()).get(ACCESS_COOKIE)?.value;
}

export async function readRefreshCookie(): Promise<string | undefined> {
  return (await cookies()).get(REFRESH_COOKIE)?.value;
}
