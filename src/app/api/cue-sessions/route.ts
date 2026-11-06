import { z } from "zod";
import { getAuthContext } from "@/lib/auth/context";
import { startCueSession } from "@/lib/cues/service";
import { withLoggedRoute } from "@/lib/http/handler";
import { parseJson } from "@/lib/http/parse";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const bodySchema = z.object({
  callId: z.string().uuid().optional(),
});

export const POST = withLoggedRoute(async (req) => {
  const auth = await getAuthContext(req);
  const body = await parseJson(req, bodySchema);
  const session = await startCueSession(auth, body);
  return Response.json(session, { status: 201 });
});
