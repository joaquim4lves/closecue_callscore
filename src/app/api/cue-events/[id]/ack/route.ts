import { getAuthContext } from "@/lib/auth/context";
import { acknowledgeCue } from "@/lib/cues/service";
import { withLoggedRoute } from "@/lib/http/handler";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const POST = withLoggedRoute(async (req, ctx) => {
  const { id } = await ctx.params;
  const auth = await getAuthContext(req);
  return Response.json(await acknowledgeCue(auth, id ?? ""));
});
