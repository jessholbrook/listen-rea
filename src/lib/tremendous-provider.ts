import { createHash } from "node:crypto";
import { providerFetch } from "./provider-transport";
import { tremendousId } from "./tremendous";
export type TremendousTransport = {
  binding: (
    workspaceId: string,
  ) => { hash: string; organizationId: string } | null;
  request: (
    workspaceId: string,
    path: string,
    method?: "GET" | "POST",
    data?: unknown,
  ) => Promise<unknown>;
};
export class TremendousProviderError extends Error {
  constructor(public status: number) {
    super("TREMENDOUS_HTTP_" + status);
  }
}
export const tremendousBinding: TremendousTransport["binding"] = (
  workspaceId,
) => {
  const key = process.env.RESEARCH_TREMENDOUS_SANDBOX_API_KEY,
    owner = process.env.RESEARCH_TREMENDOUS_ECHO_WORKSPACE_ID,
    organizationId = process.env.RESEARCH_TREMENDOUS_SANDBOX_ORGANIZATION_ID;
  if (
    !key?.startsWith("TEST_") ||
    workspaceId !== owner ||
    process.env.RESEARCH_TREMENDOUS_SANDBOX_ENABLED !== "true" ||
    !tremendousId.safeParse(organizationId).success
  )
    return null;
  return {
    organizationId: organizationId!,
    hash: createHash("sha256")
      .update(JSON.stringify(["sandbox", key, owner, organizationId]))
      .digest("hex"),
  };
};
export const tremendousTransport: TremendousTransport = {
  binding: tremendousBinding,
  async request(workspaceId, path, method = "GET", data) {
    if (!tremendousBinding(workspaceId))
      throw Error("TREMENDOUS_SANDBOX_NOT_CONFIGURED");
    const allowed =
      method === "GET"
        ? /^(organizations|products\/[A-Z0-9]{4,20}|orders\/[A-Za-z0-9_-]{4,100})$/.test(
            path,
          )
        : path === "orders" ||
          /^rewards\/[A-Z0-9]{4,20}\/generate_link$/.test(path);
    if (!allowed) throw Error("TREMENDOUS_OPERATION_UNAVAILABLE");
    // Fixed sandbox origin. No production host/flag, email/SMS, funding, approval, cancellation or refund endpoints.
    const r = await providerFetch(
      "https://testflight.tremendous.com/api/v2/" + path,
      {
        method,
        redirect: "error",
        headers: {
          Authorization:
            "Bearer " + process.env.RESEARCH_TREMENDOUS_SANDBOX_API_KEY,
          "Content-Type": "application/json",
        },
        ...(data === undefined ? {} : { body: JSON.stringify(data) }),
      },
      { timeoutMs: 15000 },
    );
    if (!r.ok) {
      await r.body?.cancel();
      throw new TremendousProviderError(r.status);
    }
    const text = await r.text();
    if (Buffer.byteLength(text) > 1024 * 1024)
      throw Error("TREMENDOUS_RESPONSE_LIMIT");
    return JSON.parse(text);
  },
};
