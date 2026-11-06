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
