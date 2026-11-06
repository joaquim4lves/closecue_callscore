import { getAuthContext } from "@/lib/auth/context";
import { withLoggedRoute } from "@/lib/http/handler";
import { ApiError } from "@/lib/http/errors";
import { scoringMetrics } from "@/lib/scoring/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = withLoggedRoute(async (req) => {
  const auth = await getAuthContext(req);
  const period = new URL(req.url).searchParams.get("period");
  if (period && period !== "week") throw new ApiError(400, "invalid_request", "period must be week.");
  return Response.json(await scoringMetrics(auth, period === "week" ? "week" : undefined));
});