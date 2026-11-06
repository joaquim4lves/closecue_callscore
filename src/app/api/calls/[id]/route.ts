import { getAuthContext } from "@/lib/auth/context";
import { getCall } from "@/lib/calls/service";
import { withLoggedRoute } from "@/lib/http/handler";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = withLoggedRoute(async (req, ctx) => {
  const { id } = await ctx.params;
  const auth = await getAuthContext(req);
  return Response.json(await getCall(auth, id ?? ""));
});
