import { withRoute, ApiError } from "@/lib/errors";
import { json, assertSameOrigin } from "@/lib/http";
import { rotateSession } from "@/lib/auth/session";
import { issueAccessForSession } from "@/lib/services/auth.service";
import { readRefreshCookie, setAuthCookies, clearAuthCookies } from "@/lib/auth/cookies";
import { enforceRateLimit, getClientIp } from "@/lib/auth/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const POST = withRoute(async (req: Request) => {
  assertSameOrigin(req);
  const ip = getClientIp(req);
  await enforceRateLimit("auth-refresh", ip);

  const raw = await readRefreshCookie();
  if (!raw) throw ApiError.unauthenticated("No active session");

  let rotated;
  try {
    rotated = await rotateSession(raw, {
      ip,
      userAgent: req.headers.get("user-agent") ?? undefined,
    });
  } catch (err) {
    // Invalid / reused / expired: clear cookies so the client re-authenticates.
    await clearAuthCookies();
    throw err;
  }

  const access = await issueAccessForSession(
    rotated.userId,
    rotated.session._id.toString(),
  );

  await setAuthCookies({
    accessToken: access.accessToken,
    accessExp: access.accessExp,
    refreshToken: rotated.rawRefreshToken,
  });

  return json({ ok: true });
});
