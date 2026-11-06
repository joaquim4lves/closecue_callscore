import { getAuthContext } from "@/lib/auth/context";
import { listCueEvents } from "@/lib/cues/service";
import { toErrorResponse } from "@/lib/http/errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const requestId = req.headers.get("x-request-id") ?? crypto.randomUUID();
  try {
    const { id } = await ctx.params;
    const auth = await getAuthContext(req);
    const encoder = new TextEncoder();
    let lastCount = 0;
    const stream = new ReadableStream({
      async start(controller) {
        const send = (event: string, data: unknown) => {
          controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
        };
        try {
          send("ready", { sessionId: id, connection: "up" });
          while (!req.signal.aborted) {
            const events = await listCueEvents(auth, id);
            if (events.length !== lastCount) {
              send("events", { events });
              lastCount = events.length;
            } else {
              controller.enqueue(encoder.encode(`event: ping\ndata: {}\n\n`));
            }
            await new Promise((resolve) => setTimeout(resolve, 1000));
          }
        } catch (error) {
          send("error", { message: error instanceof Error ? error.message : "stream failed" });
        } finally {
          controller.close();
        }
      },
    });
    return new Response(stream, {
      headers: {
        "content-type": "text/event-stream",
        "cache-control": "no-cache",
        connection: "keep-alive",
        "x-request-id": requestId,
      },
    });
  } catch (error) {
    return toErrorResponse(error, requestId);
  }
}
