export type RequestLog = {
  requestId: string;
  method: string;
  path: string;
  status?: number;
  ms?: number;
  msg?: "request" | "response";
};

export function logRequest(event: RequestLog): void {
  console.info(
    JSON.stringify({
      level: "info",
      msg: event.msg ?? "request",
      requestId: event.requestId,
      method: event.method,
      path: event.path,
      status: event.status,
      ms: event.ms,
    }),
  );
}

export function logIngest(event: {
  msg: string;
  callId?: string | null;
  externalId?: string | null;
  source?: string | null;
  status?: string | null;
  inboxId?: string | null;
  error?: string | null;
}): void {
  console.info(
    JSON.stringify({
      level: event.error ? "error" : "info",
      msg: event.msg,
      callId: event.callId ?? null,
      externalId: event.externalId ?? null,
      source: event.source ?? null,
      status: event.status ?? null,
      inboxId: event.inboxId ?? null,
      error: event.error ?? null,
    }),
  );
}
