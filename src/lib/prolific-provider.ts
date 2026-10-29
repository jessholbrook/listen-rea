import { createHash } from "node:crypto";
import { z } from "zod";
import { providerFetch } from "./provider-transport";
import { prolificId } from "./prolific";
export type ProlificTransport = {
  binding: (workspaceId: string) => {
    hash: string;
    researcherId: string;
    projectId: string;
    testEnabled: boolean;
    paidEnabled: boolean;
  } | null;
  request: (
    workspaceId: string,
    path: string,
    method?: "GET" | "POST" | "PATCH",
    data?: unknown,
  ) => Promise<unknown>;
};
export const prolificBinding: ProlificTransport["binding"] = (workspaceId) => {
  const key = process.env.RESEARCH_PROLIFIC_API_KEY,
    owner = process.env.RESEARCH_PROLIFIC_ECHO_WORKSPACE_ID,
    researcherId = process.env.RESEARCH_PROLIFIC_RESEARCHER_ID,
    projectId = process.env.RESEARCH_PROLIFIC_PROJECT_ID;
  if (
    !key ||
    workspaceId !== owner ||
    !prolificId.safeParse(researcherId).success ||
    !prolificId.safeParse(projectId).success
  )
    return null;
  return {
    researcherId: researcherId!,
    projectId: projectId!,
    testEnabled: process.env.RESEARCH_PROLIFIC_TEST_ENABLED === "true",
    paidEnabled: process.env.RESEARCH_PROLIFIC_PAID_LAUNCH_ENABLED === "true",
    hash: createHash("sha256")
      .update(JSON.stringify([key, owner, researcherId, projectId]))
      .digest("hex"),
  };
};
export const prolificTransport: ProlificTransport = {
  binding: prolificBinding,
  async request(workspaceId, path, method = "GET", data) {
    const b = prolificBinding(workspaceId);
    if (!b) throw Error("PROLIFIC_NOT_CONFIGURED");
    // No caller-selected origins, payment approvals, bonuses, messages or account funding endpoints.
    const allowed =
      method === "PATCH"
        ? /^studies\/[A-Za-z0-9_-]+\/$/.test(path)
        : method === "GET"
          ? /^(users\/me\/|projects\/[A-Za-z0-9_-]+\/|studies\/[A-Za-z0-9_-]+\/(cost\/\?is_projected=true)?|submissions\/\?study=[A-Za-z0-9_-]+&page_size=100&page=\d+)$/.test(
              path,
            )
          : /^(studies\/|studies\/[A-Za-z0-9_-]+\/(test-study|transition\/))$/.test(
              path,
            );
    if (!allowed) throw Error("PROLIFIC_OPERATION_UNAVAILABLE");
    if (method === "POST" && path.endsWith("test-study") && !b.testEnabled)
      throw Error("PROLIFIC_TEST_DISABLED");
    if (method === "POST" && path.endsWith("transition/")) {
      const action = z
        .object({ action: z.enum(["PUBLISH", "PAUSE"]) })
        .strict()
        .parse(data).action;
      if (action === "PUBLISH" && !b.paidEnabled)
        throw Error("PROLIFIC_PAID_DISABLED");
    }
    const r = await providerFetch(
      "https://api.prolific.com/api/v1/" + path,
      {
        method,
        headers: {
          Authorization: "Token " + process.env.RESEARCH_PROLIFIC_API_KEY,
          "Content-Type": "application/json",
        },
        ...(data === undefined ? {} : { body: JSON.stringify(data) }),
        redirect: "error",
      },
      { timeoutMs: 15000 },
    );
    if (!r.ok) {
      await r.body?.cancel();
      throw Error("PROLIFIC_HTTP_" + r.status);
    }
    const text = await r.text();
    if (Buffer.byteLength(text) > 2 * 1024 * 1024)
      throw Error("PROLIFIC_RESPONSE_LIMIT");
    return JSON.parse(text);
  },
};
