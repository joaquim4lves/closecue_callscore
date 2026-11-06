import type { z } from "zod";
import { ApiError } from "./errors";

export async function parseJson<S extends z.ZodTypeAny>(req: Request, schema: S): Promise<z.infer<S>> {
  const text = await req.text();
  let data: unknown = {};
  if (text.trim().length > 0) {
    try {
      data = JSON.parse(text) as unknown;
    } catch {
      throw new ApiError(400, "invalid_request", "Request body must be JSON.");
    }
  }
  const parsed = schema.safeParse(data);
  if (!parsed.success) {
    throw new ApiError(400, "invalid_request", "Invalid request body.", {
      issues: parsed.error.issues.map((issue) => ({
        path: issue.path.join("."),
        message: issue.message,
      })),
    });
  }
  return parsed.data;
}
