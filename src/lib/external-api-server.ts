import { automationApi } from "./study-automation-server";
import { randomUUID } from "node:crypto";
import { ZodError } from "zod";
import { HttpError, fail } from "./http";
import { authenticateReadKey } from "./read-api-auth";
import { readAuthorizedData } from "./read-api-data";
export async function externalApi(req: Request, p: string[]) {
  const requestId = randomUUID(),
    headers: Record<string, string> = {
      "Cache-Control": "private, no-store",
      Vary: "Authorization",
      "X-Content-Type-Options": "nosniff",
      "X-Request-ID": requestId,
    };
  const json = (data: unknown, status = 200) =>
    Response.json(data, { status, headers });
  try {
    if (p[0] === "automation") {
      const key = await authenticateReadKey(req, headers);
      const response = await automationApi(req, p.slice(1), key);
      return json(await response.json(), response.status);
    }
    if (req.method !== "GET") {
      headers.Allow = "GET";
      fail(405, "This API supports GET requests only.");
    }
    const key = await authenticateReadKey(req, headers);
    return await readAuthorizedData(req, p, key, json);
  } catch (e) {
    const status =
      e instanceof HttpError ? e.status : e instanceof ZodError ? 400 : 500;
    if (status === 401)
      headers["WWW-Authenticate"] = 'Bearer realm="Echo Lab API"';
    const codes: Record<number, string> = {
      400: "invalid_request",
      401: "unauthorized",
      403: "insufficient_scope",
      404: "not_found",
      405: "method_not_allowed",
      409: "conflict",
      410: "gone",
      413: "payload_too_large",
      429: "rate_limited",
      500: "internal_error",
    };
    return json(
      {
        error: {
          code: codes[status] || "request_failed",
          message:
            status === 500
              ? "The request could not be completed."
              : (e as Error).message,
          requestId,
        },
      },
      status,
    );
  }
}
