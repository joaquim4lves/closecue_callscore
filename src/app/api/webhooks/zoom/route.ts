import { acceptZoomWebhook } from "@/lib/calls/service";
import { withLoggedRoute } from "@/lib/http/handler";
import { enqueueIngest } from "@/lib/ingest/queue";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const POST = withLoggedRoute(async (req) => {
  const rawBody = await req.text();
  const result = await acceptZoomWebhook(rawBody, req.headers);
  if (result.status === 401) {
    return Response.json({ error: "invalid_signature", message: "Zoom signature was rejected." }, { status: 401 });
  }
  if (result.status === 503) {
    return Response.json(
      { error: "zoom_org_unconfigured", message: "ZOOM_ORG_ID is not set.", inboxId: result.inboxId },
      { status: 503 },
    );
  }
  if (result.status === 200) return Response.json(result.body);
  if (result.process) enqueueIngest(result.process);
  return Response.json({ received: true, inboxId: result.inboxId }, { status: 202 });
});
