import { withLoggedRoute } from "@/lib/http/handler";
import { meetProvider } from "@/lib/ingest/providers";
import { ProviderNotImplemented } from "@/lib/ingest/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const POST = withLoggedRoute(async (req) => {
  const rawBody = await req.text();
  try {
    meetProvider.verifySignature(rawBody, req.headers);
    meetProvider.parseEvent(rawBody ? (JSON.parse(rawBody) as unknown) : {});
  } catch (error) {
    if (error instanceof ProviderNotImplemented) {
      return Response.json(
        { error: "not_implemented", provider: "meet", message: error.message },
        { status: 501 },
      );
    }
    throw error;
  }
  return Response.json({ error: "not_implemented", provider: "meet" }, { status: 501 });
});
