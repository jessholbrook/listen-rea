import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { advancedSetup } from "./advanced-methods-fixture";
import { automationGuide } from "./automation-fixture";
import { base } from "./harness";
export async function reconciliationSetup() {
  const c = await advancedSetup(),
    s = await c.create(
      automationGuide("Synthetic recovery study"),
      "Synthetic recovery study",
    );
  const issued = await c.owner("api-keys", "POST", {
    requestId: randomUUID(),
    secret: randomBytes(32).toString("hex"),
    name: "Synthetic recovery key",
    studyIds: [s.id],
    scopes: ["studies:read", "responses:read", "analyses:read"],
    expiresAt: new Date(Date.now() + 86400000).toISOString(),
  });
  assert.equal(issued.status, 201);
  async function external(
    path: string,
    method = "GET",
    data?: unknown,
    token = issued.token,
  ) {
    const r = await fetch(base + "/api/v1/reconciliation/" + path, {
      method,
      headers: {
        "content-type": "application/json",
        authorization: "Bearer " + token,
      },
      ...(data === undefined ? {} : { body: JSON.stringify(data) }),
    });
    return { status: r.status, ...(await r.json()) };
  }
  async function grant(extra: any = {}) {
    const current = await c.local.get<any>(
      "reconciliationGrant",
      issued.key.id,
      c.actor.workspaceId,
    );
    const r = await c.owner(
      "integration-recovery/grants/" + issued.key.id,
      "PUT",
      {
        version: current?.version || 0,
        enabled: true,
        limit24h: 10,
        reviewed: true,
        ...extra,
      },
    );
    assert.equal(r.status, 200, JSON.stringify(r));
    return r.grant;
  }
  const input = (extra: any = {}) => ({
    requestId: randomUUID(),
    studyIds: [s.id],
    resources: ["study", "response", "analysis"],
    pageSize: 1,
    ...extra,
  });
  async function source(extra: any = {}) {
    const i = {
      id: randomUUID(),
      workspaceId: c.actor.workspaceId,
      studyId: s.id,
      revisionId: s.revisionId,
      guide: s.draft,
      status: "complete",
      preview: false,
      excluded: false,
      createdAt: new Date().toISOString(),
      completedAt: new Date().toISOString(),
      turns: [
        {
          id: randomUUID(),
          questionId: s.draft.questions[0].id,
          prompt: "Synthetic prompt",
          answer: "PRIVATE SYNTHETIC ANSWER",
          source: "typed",
          followUp: false,
          createdAt: new Date().toISOString(),
        },
      ],
      ...extra,
    };
    await c.local.put("interview", i);
    return i;
  }
  async function changed() {
    const current = await c.local.get<any>("study", s.id, c.actor.workspaceId);
    await c.local.put("study", {
      ...current,
      updatedAt: new Date(Date.now() + 1000).toISOString(),
      version: current.version + 1,
    });
  }
  const ack = (id: string, view: any, extra: any = {}) =>
    external("runs/" + id + "/checkpoint", "POST", {
      requestId: randomUUID(),
      version: view.run.version,
      position: view.page.position,
      pageToken: view.page.pageToken,
      ...extra,
    });
  return {
    ...c,
    s,
    key: issued.key,
    token: issued.token,
    external,
    grant,
    input,
    source,
    changed,
    ack,
  };
}
