import { withRoute } from "@/lib/errors";
import { json } from "@/lib/http";
import { requireAuth } from "@/lib/auth/require-user";
import { listActiveSessions } from "@/lib/auth/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = withRoute(async () => {
  const ctx = await requireAuth();
  const sessions = await listActiveSessions(ctx.user.id);

  return json({
    sessions: sessions.map((s) => ({
      id: s._id.toString(),
      userAgent: s.userAgent ?? null,
      ip: s.ip ?? null,
      createdAt: s.createdAt,
      current: s._id.toString() === ctx.sessionId,
    })),
  });
});
