import { toErrorResponse } from "./errors";
import { logRequest } from "./logger";

export type RouteContext = { params: Promise<Record<string, string>> };

function cloneResponse(response: Response, requestId: string): Promise<Response> {
  const headers = new Headers();
  response.headers.forEach((value, key) => {
    if (key.toLowerCase() === "set-cookie") return;
    headers.set(key, value);
  });
  const setCookies =
    typeof response.headers.getSetCookie === "function" ? response.headers.getSetCookie() : [];
  for (const cookie of setCookies) {
    headers.append("set-cookie", cookie);
  }
  if (setCookies.length === 0) {
    const single = response.headers.get("set-cookie");
    if (single) headers.append("set-cookie", single);
  }
  headers.set("x-request-id", requestId);
  if (response.status === 204 || response.status === 205 || response.status === 304) {
    return Promise.resolve(new Response(null, { status: response.status, headers }));
  }
  return response.arrayBuffer().then((body) => new Response(body, { status: response.status, headers }));
}

export function withLoggedRoute(
  handler: (req: Request, ctx: RouteContext) => Promise<Response>,
): (req: Request, ctx: RouteContext) => Promise<Response> {
  return async (req, ctx) => {
    const requestId = req.headers.get("x-request-id") ?? crypto.randomUUID();
    const started = Date.now();
    const path = new URL(req.url).pathname;
    const context = ctx ?? { params: Promise.resolve({}) };
    try {
      const response = await handler(req, context);
      const logged = await cloneResponse(response, requestId);
      logRequest({
        msg: "response",
        requestId,
        method: req.method,
        path,
        status: logged.status,
        ms: Date.now() - started,
      });
      return logged;
    } catch (error) {
      const response = toErrorResponse(error, requestId);
      logRequest({
        msg: "response",
        requestId,
        method: req.method,
        path,
        status: response.status,
        ms: Date.now() - started,
      });
      return response;
    }
  };
}
