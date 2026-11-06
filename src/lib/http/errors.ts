export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly extra?: Record<string, unknown>;

  constructor(status: number, code: string, message: string, extra?: Record<string, unknown>) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.extra = extra;
  }
}

export function pgErrorCode(error: unknown): string | undefined {
  if (!error || typeof error !== "object") return undefined;
  if ("code" in error && typeof error.code === "string") return error.code;
  if ("cause" in error) return pgErrorCode(error.cause);
  return undefined;
}

export function toErrorResponse(error: unknown, requestId: string): Response {
  if (error instanceof ApiError) {
    return Response.json(
      { error: error.code, message: error.message, ...(error.extra ?? {}) },
      { status: error.status, headers: { "x-request-id": requestId } },
    );
  }

  const code = pgErrorCode(error);
  if (code === "23505") {
    return Response.json(
      { error: "conflict", message: "Unique constraint violated." },
      { status: 409, headers: { "x-request-id": requestId } },
    );
  }

  console.error(
    JSON.stringify({
      level: "error",
      msg: "unhandled",
      requestId,
      error: error instanceof Error ? error.message : "unknown",
    }),
  );
  return Response.json(
    { error: "internal_error", message: "Internal error." },
    { status: 500, headers: { "x-request-id": requestId } },
  );
}
