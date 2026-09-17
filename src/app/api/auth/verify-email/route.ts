import { withRoute } from "@/lib/errors";
import { json, parseBody, assertSameOrigin } from "@/lib/http";
import { verifyEmailSchema } from "@/lib/auth/schemas";
import { verifyEmailAndCreateAccount } from "@/lib/services/auth.service";
import { setAuthCookies } from "@/lib/auth/cookies";
import { enforceRateLimit, getClientIp } from "@/lib/auth/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Step 2 of signup: confirm the emailed code, create the account, and sign in.
export const POST = withRoute(async (req: Request) => {
  assertSameOrigin(req);
  const ip = getClientIp(req);
  await enforceRateLimit("auth-strict", ip);

  const body = await parseBody(req, verifyEmailSchema);
  const { user, tokens } = await verifyEmailAndCreateAccount(body, {
    ip,
    userAgent: req.headers.get("user-agent") ?? undefined,
  });

  await setAuthCookies({
    accessToken: tokens.accessToken,
    accessExp: tokens.accessExp,
    refreshToken: tokens.refreshToken,
  });

  return json({ user }, { status: 201 });
});
