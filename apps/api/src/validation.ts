import type { Context } from "hono";
import type { z } from "zod";
import { HttpError } from "./errors";

export async function parseJson<S extends z.ZodTypeAny>(c: Context, schema: S): Promise<z.output<S>> {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    throw new HttpError(400, "invalid_json", "request body must be JSON");
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success) throw new HttpError(400, "invalid_input", "invalid input", parsed.error.issues);
  return parsed.data;
}
