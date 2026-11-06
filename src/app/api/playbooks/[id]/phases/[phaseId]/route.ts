import { getAuthContext } from "@/lib/auth/context";
import { withLoggedRoute } from "@/lib/http/handler";
import { parseJson } from "@/lib/http/parse";
import { phasePatchSchema } from "@/lib/playbooks/schemas";
import { deletePhase, updatePhase } from "@/lib/playbooks/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const PATCH = withLoggedRoute(async (req, ctx) => {
  const { id, phaseId } = await ctx.params;
  const auth = await getAuthContext(req);
  const body = await parseJson(req, phasePatchSchema);
  return Response.json(await updatePhase(auth, id ?? "", phaseId ?? "", body));
});

export const DELETE = withLoggedRoute(async (req, ctx) => {
  const { id, phaseId } = await ctx.params;
  const auth = await getAuthContext(req);
  return Response.json(await deletePhase(auth, id ?? "", phaseId ?? ""));
});
