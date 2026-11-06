import { getAuthContext } from "@/lib/auth/context";
import { listCueEvents } from "@/lib/cues/service";
import { withLoggedRoute } from "@/lib/http/handler";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = withLoggedRoute(async (req, ctx) => {
  const { id } = await ctx.params;
  const auth = await getAuthContext(req);
  return Response.json({ events: await listCueEvents(auth, id ?? "") });
});
