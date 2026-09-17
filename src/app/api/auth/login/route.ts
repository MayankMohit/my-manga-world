import { withRoute, ApiError } from "@/lib/errors";
import { json, parseBody, assertSameOrigin } from "@/lib/http";
import { loginSchema } from "@/lib/auth/schemas";
import { login } from "@/lib/services/auth.service";
import { setAuthCookies } from "@/lib/auth/cookies";
import { enforceRateLimit, getClientIp } from "@/lib/auth/rate-limit";
import { assertNotLockedOut, recordFailedLogin, clearLockout } from "@/lib/auth/lockout";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const POST = withRoute(async (req: Request) => {
  assertSameOrigin(req);
  const ip = getClientIp(req);
  await enforceRateLimit("auth-strict", ip);

  const body = await parseBody(req, loginSchema);
  await assertNotLockedOut(ip, body.email);

  try {
    const { user, tokens } = await login(body, {
      ip,
      userAgent: req.headers.get("user-agent") ?? undefined,
    });
    await clearLockout(ip, body.email);
    await setAuthCookies({
      accessToken: tokens.accessToken,
      accessExp: tokens.accessExp,
      refreshToken: tokens.refreshToken,
    });
    return json({ user });
  } catch (err) {
    if (err instanceof ApiError && err.code === "UNAUTHENTICATED") {
      await recordFailedLogin(ip, body.email);
    }
    throw err;
  }
});
