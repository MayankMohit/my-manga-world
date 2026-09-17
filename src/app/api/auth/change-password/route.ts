import { withRoute } from "@/lib/errors";
import { parseBody, assertSameOrigin } from "@/lib/http";
import { changePasswordSchema } from "@/lib/auth/schemas";
import { requireAuth } from "@/lib/auth/require-user";
import { changePassword } from "@/lib/services/auth.service";
import { setAccessCookie } from "@/lib/auth/cookies";
import { enforceRateLimit, getClientIp } from "@/lib/auth/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const POST = withRoute(async (req: Request) => {
  assertSameOrigin(req);
  const ctx = await requireAuth();
  await enforceRateLimit("auth-strict", getClientIp(req));

  const body = await parseBody(req, changePasswordSchema);
  const access = await changePassword({
    userId: ctx.user.id,
    currentSessionId: ctx.sessionId,
    currentPassword: body.currentPassword,
    newPassword: body.newPassword,
  });

  await setAccessCookie(access.accessToken, access.accessExp);
  return new Response(null, { status: 204 });
});
