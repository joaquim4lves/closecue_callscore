import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { readMockUserId } from "@/lib/auth/mock-session";
import { logRequest } from "@/lib/http/logger";

const PUBLIC_API = new Set(["/api/health", "/api/dev/users", "/api/dev/session"]);

function pathnameOf(request: NextRequest): string {
  const pathname = request.nextUrl.pathname.replace(/\/$/, "");
  return pathname || "/";
}

export function middleware(request: NextRequest) {
  const requestId = request.headers.get("x-request-id") ?? crypto.randomUUID();
  const pathname = pathnameOf(request);
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-request-id", requestId);

  const mockUserId = readMockUserId(request.headers);
  if (mockUserId) requestHeaders.set("x-mock-user-id", mockUserId);

  const isApi = pathname.startsWith("/api/");
  if (isApi && !PUBLIC_API.has(pathname) && !mockUserId) {
    logRequest({ msg: "request", requestId, method: request.method, path: pathname, status: 401 });
    return NextResponse.json(
      {
        error: "unauthorized",
        message: "Missing mock user. Send the x-mock-user-id header or the mock_user_id cookie.",
      },
      { status: 401, headers: { "x-request-id": requestId } },
    );
  }

  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set("x-request-id", requestId);
  logRequest({ msg: "request", requestId, method: request.method, path: pathname });
  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
