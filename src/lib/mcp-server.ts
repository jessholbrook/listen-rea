import { automationApi, automationGrant } from "./study-automation-server";
import { mcpAutomationTools } from "./mcp-tools";
import { ZodError } from "zod";
import { randomUUID } from "node:crypto";
import { McpServer, createMcpHandler } from "@modelcontextprotocol/server";
import { authenticateReadKey } from "./read-api-auth";
import { readAuthorizedData } from "./read-api-data";
import { HttpError, fail } from "./http";
import { permittedMcpTools, mcpInstructions } from "./mcp-tools";
import { metadataFor } from "./oauth";
const methods = new Set([
  "initialize",
  "notifications/initialized",
  "notifications/cancelled",
  "ping",
  "server/discover",
  "tools/list",
  "tools/call",
]);
function trustedRequest(req: Request) {
  const url = new URL(req.url),
    hosts = new Set<string>(),
    origins = new Set<string>();
  for (const value of [
    process.env.RESEARCH_PUBLIC_URL,
    process.env.VERCEL_URL ? "https://" + process.env.VERCEL_URL : null,
    process.env.VERCEL_PROJECT_PRODUCTION_URL
      ? "https://" + process.env.VERCEL_PROJECT_PRODUCTION_URL
      : null,
  ]) {
    if (value) {
      try {
        const u = new URL(value);
        hosts.add(u.host);
        origins.add(u.origin);
      } catch {}
    }
  }
  if (
    !process.env.VERCEL &&
    ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)
  ) {
    hosts.add(url.host);
    origins.add(url.origin);
  }
  if (!hosts.has(url.host)) fail(403, "This MCP host is not allowed.");
  const origin = req.headers.get("origin");
  if (origin && !origins.has(origin))
    fail(403, "This MCP request origin is not allowed.");
}
async function boundedBody(req: Request) {
  if (Number(req.headers.get("content-length") || 0) > 65536)
    fail(413, "MCP request exceeds 64 KiB.");
  const reader = req.body?.getReader();
  if (!reader) return "";
  let size = 0;
  const chunks: Uint8Array[] = [];
  try {
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      size += part.value.byteLength;
      if (size > 65536) {
        await reader.cancel();
        fail(413, "MCP request exceeds 64 KiB.");
      }
      chunks.push(part.value);
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks).toString("utf8");
}
export async function handleMcp(req: Request) {
  const requestId = randomUUID(),
    headers: Record<string, string> = {
      "Cache-Control": "private, no-store",
      Vary: "Authorization, Origin",
      "X-Request-ID": requestId,
      "X-Content-Type-Options": "nosniff",
    };
  let id: string | number | null = null;
  const error = (status: number, code: number, message: string) =>
    Response.json(
      { jsonrpc: "2.0", id, error: { code, message, data: { requestId } } },
      { status, headers },
    );
  try {
    if (req.method !== "POST") {
      headers.Allow = "POST";
      return error(
        405,
        -32000,
        "Use MCP Streamable HTTP POST. Persistent GET streams and session deletion are not supported.",
      );
    }
    trustedRequest(req);
    if (new URL(req.url).search)
      fail(
        400,
        "MCP does not accept query parameters. Supply credentials in headers.",
      );
    const key = await authenticateReadKey(req, headers, true);
    if (
      (req.headers.get("content-type") || "")
        .split(";")[0]
        .trim()
        .toLowerCase() !== "application/json"
    )
      return error(415, -32600, "Use Content-Type: application/json.");
    let body: unknown;
    try {
      body = JSON.parse(await boundedBody(req));
    } catch (e) {
      if (e instanceof HttpError) throw e;
      return error(400, -32700, "Invalid JSON.");
    }
    if (!body || typeof body !== "object" || Array.isArray(body))
      return error(
        400,
        -32600,
        "Use one JSON-RPC request object, not a batch.",
      );
    const envelope = body as {
      id?: unknown;
      method?: unknown;
      jsonrpc?: unknown;
    };
    if (typeof envelope.id === "string" || typeof envelope.id === "number")
      id = envelope.id;
    if (envelope.jsonrpc !== "2.0" || typeof envelope.method !== "string")
      return error(400, -32600, "Invalid JSON-RPC request.");
    if (!methods.has(envelope.method)) {
      if (!("id" in envelope))
        return new Response(null, { status: 202, headers });
      return error(200, -32601, "This read-only MCP method is not available.");
    }
    const grant = await automationGrant(key);
    const handler = createMcpHandler(
      () => {
        const server = new McpServer(
          { name: "echo-lab", version: "1.0.0" },
          { instructions: mcpInstructions },
        );
        for (const tool of permittedMcpTools(key.scopes)) {
          server.registerTool(
            tool.name,
            {
              title: tool.title,
              description: tool.description,
              inputSchema: tool.schema,
              annotations: {
                readOnlyHint: true,
                destructiveHint: false,
                idempotentHint: true,
                openWorldHint: false,
              },
            },
            async (args: unknown) => {
              try {
                const input = args as {
                  studyId?: string;
                  responseId?: string;
                  analysisId?: string;
                  limit?: number;
                  cursor?: string;
                };
                const path = tool.path(input),
                  url = new URL(
                    "/api/v1/" + path.join("/"),
                    "http://read-api.internal",
                  );
                if (input.limit !== undefined)
                  url.searchParams.set("limit", String(input.limit));
                if (input.cursor !== undefined)
                  url.searchParams.set("cursor", input.cursor);
                const response = await readAuthorizedData(
                    new Request(url),
                    path,
                    key,
                  ),
                  data = (await response.json()) as Record<string, unknown>;
                return {
                  content: [
                    { type: "text" as const, text: JSON.stringify(data) },
                  ],
                  structuredContent: data,
                };
              } catch (e) {
                const status = e instanceof HttpError ? e.status : 500;
                return {
                  isError: true,
                  content: [
                    {
                      type: "text" as const,
                      text: JSON.stringify({
                        error: {
                          code:
                            status === 404
                              ? "not_found"
                              : status === 403
                                ? "insufficient_scope"
                                : status === 400
                                  ? "invalid_request"
                                  : "internal_error",
                          message:
                            status === 500
                              ? "The research read could not be completed."
                              : (e as Error).message,
                          requestId,
                        },
                      }),
                    },
                  ],
                };
              }
            },
          );
        }
        if (grant)
          for (const tool of mcpAutomationTools) {
            server.registerTool(
              tool.name,
              {
                title: tool.title,
                description: tool.description,
                inputSchema: tool.schema,
                annotations: {
                  readOnlyHint: tool.readOnly,
                  destructiveHint: false,
                  idempotentHint: true,
                  openWorldHint: false,
                },
              },
              async (args: unknown) => {
                try {
                  const input = tool.schema.parse(args),
                    path = tool.path(input);
                  const response = await automationApi(
                    new Request(
                      "http://automation.internal/api/" + path.join("/"),
                      {
                        method: tool.method,
                        ...(tool.method === "POST"
                          ? {
                              headers: { "content-type": "application/json" },
                              body: JSON.stringify(input),
                            }
                          : {}),
                      },
                    ),
                    path,
                    key,
                  );
                  const data = await response.json();
                  return {
                    content: [
                      { type: "text" as const, text: JSON.stringify(data) },
                    ],
                    structuredContent: data,
                  };
                } catch (e) {
                  const status =
                    e instanceof HttpError
                      ? e.status
                      : e instanceof ZodError
                        ? 400
                        : 500;
                  return {
                    isError: true,
                    content: [
                      {
                        type: "text" as const,
                        text: JSON.stringify({
                          error: {
                            code:
                              status === 500
                                ? "internal_error"
                                : "request_failed",
                            message:
                              status === 500
                                ? "The change request could not be completed."
                                : (e as Error).message,
                            requestId,
                          },
                        }),
                      },
                    ],
                  };
                }
              },
            );
          }
        return server;
      },
      {
        legacy: "stateless",
        responseMode: "json",
        maxSubscriptions: 0,
        maxRequestBodySize: 65536,
      },
    );
    // Buffer the bounded request's response so per-request SDK resources can close
    // for both modern JSON and the legacy one-response SSE transport.
    try {
      const response = await handler.fetch(req, { parsedBody: body });
      const bytes = await response.arrayBuffer();
      const outputHeaders = new Headers(response.headers);
      for (const [name, value] of Object.entries(headers))
        outputHeaders.set(name, value);
      outputHeaders.delete("mcp-session-id");
      return new Response(
        response.status === 204 || response.status === 202 ? null : bytes,
        { status: response.status, headers: outputHeaders },
      );
    } finally {
      await handler.close();
    }
  } catch (e) {
    const status = e instanceof HttpError ? e.status : 500;
    if (status === 401) {
      let metadata = "";
      try {
        metadata = ', resource_metadata="' + metadataFor(req) + '"';
      } catch {}
      headers["WWW-Authenticate"] = 'Bearer realm="Echo Lab MCP"' + metadata;
    }
    return error(
      status,
      -32000,
      status === 500
        ? "The MCP request could not be completed."
        : (e as Error).message,
    );
  }
}
