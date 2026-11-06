import { z } from "zod";
import { getAuthContext } from "@/lib/auth/context";
import { tickCueSession } from "@/lib/cues/service";
import { withLoggedRoute } from "@/lib/http/handler";
import { parseJson } from "@/lib/http/parse";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const bodySchema = z.object({
  text: z.string().trim().max(4000).optional(),
  simulate: z.enum(["phase", "objection"]).optional(),
});

export const POST = withLoggedRoute(async (req, ctx) => {
  const { id } = await ctx.params;
  const auth = await getAuthContext(req);
  const body = await parseJson(req, bodySchema);
  return Response.json(await tickCueSession(auth, id ?? "", body));
});
