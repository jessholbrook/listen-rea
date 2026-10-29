import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import {
  Client,
  StreamableHTTPClientTransport,
} from "@modelcontextprotocol/client";
import { createClient } from "@libsql/client";
import path from "node:path";
import { start, stop, base, client, dataDirectory } from "./harness";
import { automationSetup, automationGuide } from "./automation-fixture";
before(() => start({ port: 3442 }), { timeout: 90000 });
after(stop);
test("reviewed automation creates, edits, publishes and opens/pauses/closes one explicitly granted study with retry-safe separate admin decisions and original history", async () => {
  const c = await automationSetup();
  assert.equal((await c.external("studies/" + c.s.id)).status, 403);
  await c.grant();
  const input = { operation: "create", guide: automationGuide() },
    id = randomUUID();
  const p = (await c.proposal(input, id)).plan;
  assert.equal(p.state, "pending");
  assert.equal((await c.owner("studies")).studies.length, 1);
  assert.equal((await c.proposal(input, id)).plan.id, p.id);
  assert.equal(
    (
      await c.proposal(
        { ...input, guide: automationGuide("Different payload") },
        id,
      )
    ).status,
    409,
  );
  const decisionId = randomUUID(),
    applied = (await c.decision(p, "apply", decisionId)).plan;
  assert.equal(applied.state, "applied");
  const studyId = applied.result.studyId;
  assert.equal(
    (await c.decision(p, "apply", decisionId)).plan.result.studyId,
    studyId,
  );
  assert.equal((await c.owner("studies")).studies.length, 2);
  let s = (await c.external("studies/" + studyId)).study;
  assert.equal(s.fielding, "draft");
  assert.equal(s.revisionId, null);
  const revised = automationGuide("Revised synthetic guide");
  for (const change of [
    () => ({
      operation: "edit",
      studyId,
      fingerprint: s.fingerprint,
      guide: revised,
    }),
    () => ({ operation: "publish", studyId, fingerprint: s.fingerprint }),
    ...["active", "paused", "closed"].map((state) => () => ({
      operation: "fielding",
      studyId,
      fingerprint: s.fingerprint,
      state,
    })),
  ]) {
    const previous = s,
      proposal = (await c.proposal(change())).plan;
    assert.equal(
      (await c.external("studies/" + studyId)).study.fingerprint,
      previous.fingerprint,
      "A proposal must not mutate the study",
    );
    assert.equal((await c.decision(proposal)).status, 200);
    s = (await c.external("studies/" + studyId)).study;
    assert.equal(s.version, previous.version + 1);
  }
  assert.equal(s.fielding, "closed");
  assert.ok(s.revisionId);
  assert.equal(
    (await c.external("plans/" + p.id)).plan.result.studyId,
    studyId,
  );
  assert.equal((await c.owner("public/" + studyId)).fielding, "closed");
  const history = await c.owner("studies/" + studyId + "/history");
  assert.equal(history.status, 200);
});
test("automation scopes, admin membership, permission changes, unknown approval fields and optimistic study fingerprints reject unsafe or stale changes", async () => {
  const c = await automationSetup(),
    foreign = await automationSetup();
  await c.grant(["edit", "publish"]);
  const current = (await c.external("studies/" + c.s.id)).study;
  assert.equal((await c.external("studies/" + foreign.s.id)).status, 404);
  assert.equal(
    (await c.proposal({ operation: "create", guide: automationGuide() }))
      .status,
    403,
  );
  assert.equal(
    (
      await c.proposal({
        operation: "edit",
        studyId: c.s.id,
        fingerprint: current.fingerprint,
        guide: automationGuide(),
        approved: true,
      })
    ).status,
    400,
  );
  const p = (
    await c.proposal({
      operation: "edit",
      studyId: c.s.id,
      fingerprint: current.fingerprint,
      guide: automationGuide(),
    })
  ).plan;
  assert.equal((await foreign.owner("automation/plans/" + p.id)).status, 404);
  assert.equal(
    (
      await c.anon("automation/plans/" + p.id + "/decision", "POST", {
        version: 1,
        reviewed: true,
      })
    ).status,
    401,
  );
  assert.equal(
    (
      await c.external("plans/" + p.id + "/decision", "POST", {
        version: 1,
        decision: "apply",
        reviewed: true,
      })
    ).status,
    405,
  );
  await c.owner("studies/" + c.s.id, "PUT", {
    version: current.version,
    guide: automationGuide("Changed in UI"),
  });
  assert.equal((await c.decision(p)).status, 409);
  assert.equal((await c.decision(p, "reject")).plan.state, "rejected");
  const s = (await c.external("studies/" + c.s.id)).study;
  const q = (
    await c.proposal({
      operation: "publish",
      studyId: c.s.id,
      fingerprint: s.fingerprint,
    })
  ).plan;
  await c.grant(["publish"], 1, false);
  assert.equal((await c.decision(q)).status, 409);
  assert.equal((await c.external("studies/" + c.s.id)).status, 403);
  const invite = (await c.owner("invites", "POST", { role: "researcher" }))
      .invite,
    researcher = await client();
  await researcher("auth/signup", "POST", {
    name: "Researcher",
    email: randomUUID() + "@example.test",
    password: "automation-test-password",
    invite,
  });
  assert.equal((await researcher("automation")).status, 403);
});
test("competing admin decisions apply once, invalid guides roll back, expired/revoked requests fail and request bodies are bounded", async () => {
  const c = await automationSetup();
  await c.grant();
  let s = (await c.external("studies/" + c.s.id)).study;
  const p = (
    await c.proposal({
      operation: "edit",
      studyId: s.id,
      fingerprint: s.fingerprint,
      guide: automationGuide("Atomic edit"),
    })
  ).plan;
  const results = await Promise.all([c.decision(p), c.decision(p)]);
  assert.deepEqual(results.map((r) => r.status).sort(), [200, 409]);
  s = (await c.external("studies/" + c.s.id)).study;
  assert.equal(s.version, 2);
  assert.equal(
    (
      await c.proposal({
        operation: "fielding",
        studyId: s.id,
        fingerprint: s.fingerprint,
        state: "active",
      })
    ).status,
    400,
  );
  assert.equal(
    (
      await c.proposal({
        operation: "edit",
        studyId: s.id,
        fingerprint: s.fingerprint,
        guide: { title: "Invalid" },
      })
    ).status,
    400,
  );
  const expired = (
    await c.proposal({
      operation: "publish",
      studyId: s.id,
      fingerprint: s.fingerprint,
    })
  ).plan;
  const sql = createClient({
    url: "file:" + path.join(dataDirectory(), "research.sqlite"),
  });
  try {
    await sql.execute({
      sql: "UPDATE documents SET data=json_set(data,'$.expiresAt',0) WHERE kind='automationPlan' AND id=?",
      args: [expired.id],
    });
  } finally {
    sql.close();
  }
  assert.equal((await c.decision(expired)).status, 409);
  const oversized = await fetch(base + "/api/v1/automation/plans", {
    method: "POST",
    headers: {
      authorization: "Bearer " + c.token,
      "content-type": "application/json",
    },
    body: JSON.stringify({ huge: "a".repeat(66000) }),
  });
  assert.equal(oversized.status, 413);
  const q = (
    await c.proposal({
      operation: "publish",
      studyId: s.id,
      fingerprint: s.fingerprint,
    })
  ).plan;
  await c.owner("api-keys/" + c.key.id + "/revoke", "POST", { version: 1 });
  assert.equal((await c.decision(q)).status, 409);
  assert.equal((await c.external("plans/" + q.id)).status, 401);
});
test("official MCP automation discovery is explicit and change tools only propose; admin decisions are unavailable to the bearer client", async () => {
  const c = await automationSetup(),
    mcp = new Client({ name: "automation-fixture", version: "1" });
  await mcp.connect(
    new StreamableHTTPClientTransport(new URL(base + "/api/mcp"), {
      requestInit: { headers: { Authorization: "Bearer " + c.token } },
    }),
  );
  assert.equal(
    (await mcp.listTools()).tools.some(
      (t) => t.name === "propose_study_change",
    ),
    false,
  );
  await c.grant();
  const tools = (await mcp.listTools()).tools;
  assert.equal(
    tools.find((t) => t.name === "propose_study_change")?.annotations
      ?.readOnlyHint,
    false,
  );
  const draft = await mcp.callTool({
    name: "get_automation_study",
    arguments: { studyId: c.s.id },
  });
  assert.equal(draft.isError, undefined);
  const change = await mcp.callTool({
    name: "propose_study_change",
    arguments: {
      requestId: randomUUID(),
      reason: "Synthetic MCP creation request",
      change: {
        operation: "create",
        guide: automationGuide("Requested by MCP"),
      },
    },
  });
  assert.equal(change.isError, undefined);
  const parsed = JSON.parse((change.content as any)[0].text);
  assert.equal(parsed.plan.state, "pending");
  assert.equal((await c.owner("studies")).studies.length, 1);
  assert.equal(
    tools.some((t) => /apply|approve|pay|recruit/.test(t.name)),
    false,
  );
  await c.decision(parsed.plan, "reject");
  const status = await mcp.callTool({
    name: "get_study_change",
    arguments: { planId: parsed.plan.id },
  });
  assert.equal(
    JSON.parse((status.content as any)[0].text).plan.state,
    "rejected",
  );
  await mcp.close();
});
test("source erasure removes proposed guide copies and retains only a content-free receipt preventing late replay", async () => {
  const c = await automationSetup();
  await c.grant();
  const creationId = randomUUID(),
    creation = {
      operation: "create",
      guide: automationGuide("Created source cleanup"),
    };
  const createdPlan = (await c.proposal(creation, creationId)).plan;
  const created = (await c.decision(createdPlan)).plan.result;
  const index = createClient({
    url: "file:" + path.join(dataDirectory(), "research.sqlite"),
  });
  try {
    const row = await index.execute({
      sql: "SELECT study_id FROM documents WHERE kind='automationPlan' AND id=?",
      args: [createdPlan.id],
    });
    assert.equal(row.rows[0].study_id, created.studyId);
    // A pre-fix creation request still has its original request index; erasure must cover it too.
    await index.execute({
      sql: "UPDATE documents SET study_id=? WHERE kind='automationPlan' AND id=?",
      args: [createdPlan.id, createdPlan.id],
    });
  } finally {
    index.close();
  }
  let s = (await c.owner("studies/" + created.studyId)).study;
  s = (
    await c.owner("studies/" + s.id, "PUT", {
      guide: automationGuide(),
      version: s.version,
    })
  ).study;
  s = (
    await c.owner("studies/" + s.id + "/publish", "POST", {
      version: s.version,
    })
  ).study;
  await c.owner("studies/" + s.id + "/fielding", "POST", { state: "active" });
  const r = await c.anon("public/" + s.id, "POST", { consent: true });
  await c.anon(
    "interviews/" + r.interview.id + "/answer",
    "POST",
    {
      requestId: randomUUID(),
      version: 0,
      answer: "Synthetic source to erase.",
    },
    { "x-interview-token": r.token },
  );
  const current = (await c.external("studies/" + s.id)).study,
    input = {
      operation: "publish",
      studyId: s.id,
      fingerprint: current.fingerprint,
    },
    id = randomUUID();
  const p = (await c.proposal(input, id)).plan;
  await c.owner("studies/" + s.id + "/responses/" + r.interview.id, "DELETE");
  assert.equal((await c.external("plans/" + p.id)).status, 404);
  assert.equal((await c.external("plans/" + createdPlan.id)).status, 404);
  assert.equal((await c.proposal(creation, creationId)).status, 410);
  assert.equal((await c.proposal(input, id)).status, 410);
  assert.equal((await c.decision(p)).status, 404);
});
