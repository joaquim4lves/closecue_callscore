import { getAuthContext } from "@/lib/auth/context";
import { withLoggedRoute } from "@/lib/http/handler";
import { parseJson } from "@/lib/http/parse";
import { objectionPatchSchema } from "@/lib/playbooks/schemas";
import { deleteObjection, updateObjection } from "@/lib/playbooks/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const PATCH = withLoggedRoute(async (req, ctx) => {
  const { id, objectionId } = await ctx.params;
  const auth = await getAuthContext(req);
  const body = await parseJson(req, objectionPatchSchema);
  return Response.json(await updateObjection(auth, id ?? "", objectionId ?? "", body));
});

export const DELETE = withLoggedRoute(async (req, ctx) => {
  const { id, objectionId } = await ctx.params;
  const auth = await getAuthContext(req);
  return Response.json(await deleteObjection(auth, id ?? "", objectionId ?? ""));
});
