import { randomUUID, randomBytes } from "node:crypto";
import assert from "node:assert/strict";
import { client, base } from "./harness";
import { templateGuide } from "../src/lib/domain";
export async function automationSetup() {
  const owner = await client(),
    anon = await client(),
    email = randomUUID() + "@example.test";
  await owner("auth/signup", "POST", {
    name: "Automation reviewer",
    email,
    password: "automation-test-password",
  });
  const s = (
    await owner("studies", "POST", { title: "Synthetic automation baseline" })
  ).study;
  const issued = await owner("api-keys", "POST", {
    requestId: randomUUID(),
    secret: randomBytes(32).toString("hex"),
    name: "Synthetic automation key",
    studyIds: [s.id],
    scopes: ["studies:read"],
    expiresAt: new Date(Date.now() + 86400000).toISOString(),
  });
  assert.equal(issued.status, 201);
  async function external(
    path: string,
    method = "GET",
    data?: unknown,
    token = issued.token,
  ) {
    const r = await fetch(base + "/api/v1/automation/" + path, {
      method,
      headers: {
        "content-type": "application/json",
        authorization: "Bearer " + token,
      },
      ...(data === undefined ? {} : { body: JSON.stringify(data) }),
    });
    return { status: r.status, ...(await r.json()) };
  }
  async function grant(
    operations = ["create", "edit", "publish", "fielding"],
    version = 0,
    enabled = true,
  ) {
    const r = await owner("automation/grants/" + issued.key.id, "PUT", {
      version,
      enabled,
      operations,
      reviewed: true,
    });
    assert.equal(r.status, 200);
    return r.grant;
  }
  async function proposal(change: unknown, requestId = randomUUID()) {
    return external("plans", "POST", {
      requestId,
      reason: "Synthetic automation workflow check",
      change,
    });
  }
  async function decision(
    plan: any,
    decision = "apply",
    requestId = randomUUID(),
  ) {
    return owner("automation/plans/" + plan.id + "/decision", "POST", {
      version: plan.version,
      requestId,
      decision,
      reviewed: true,
    });
  }
  return {
    owner,
    anon,
    email,
    s,
    key: issued.key,
    token: issued.token,
    external,
    grant,
    proposal,
    decision,
  };
}
export function automationGuide(title = "Synthetic requested study") {
  const g = templateGuide(title);
  g.questions = [{ ...g.questions[1], followUps: 0 }];
  return g;
}
