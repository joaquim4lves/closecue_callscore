import { withLoggedRoute } from "@/lib/http/handler";
import { firefliesProvider } from "@/lib/ingest/providers";
import { ProviderNotImplemented } from "@/lib/ingest/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const POST = withLoggedRoute(async (req) => {
  const rawBody = await req.text();
  try {
    firefliesProvider.verifySignature(rawBody, req.headers);
    firefliesProvider.parseEvent(rawBody ? (JSON.parse(rawBody) as unknown) : {});
  } catch (error) {
    if (error instanceof ProviderNotImplemented) {
      return Response.json(
        { error: "not_implemented", provider: "fireflies", message: error.message },
        { status: 501 },
      );
    }
    throw error;
  }
  return Response.json({ error: "not_implemented", provider: "fireflies" }, { status: 501 });
});
