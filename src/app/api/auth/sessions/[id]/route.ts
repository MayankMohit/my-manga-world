import { withRoute, ApiError } from "@/lib/errors";
import { assertSameOrigin, objectIdSchema } from "@/lib/http";
import { requireAuth } from "@/lib/auth/require-user";
import { revokeUserSession } from "@/lib/auth/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const DELETE = withRoute(
  async (req: Request, ctx: RouteContext<"/api/auth/sessions/[id]">) => {
    assertSameOrigin(req);
    const auth = await requireAuth();

    const { id } = await ctx.params;
    if (!objectIdSchema.safeParse(id).success) throw ApiError.notFound();

    const revoked = await revokeUserSession(auth.user.id, id);
    if (!revoked) throw ApiError.notFound();

    return new Response(null, { status: 204 });
  },
);
