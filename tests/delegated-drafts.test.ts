import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createClient } from "@libsql/client";
import path from "node:path";
import {
  Client,
  StreamableHTTPClientTransport,
} from "@modelcontextprotocol/client";
import { start, stop, base, dataDirectory } from "./harness";
import { automationSetup, automationGuide } from "./automation-fixture";
before(() => start({ port: 3448 }), { timeout: 90000 });
after(stop);
async function enable(
  c: Awaited<ReturnType<typeof automationSetup>>,
  extra: any = {},
) {
  const r = await c.owner("automation/grants/" + c.key.id, "PUT", {
    version: 0,
    enabled: true,
    operations: ["create", "edit", "publish", "fielding"],
    reviewed: true,
    delegation: { enabled: true, operations: ["create", "edit"], limit24h: 5 },
    delegationReviewed: true,
    ...extra,
  });
  assert.equal(r.status, 200, JSON.stringify(r));
  return r.grant;
}
const proposal = (change: unknown, requestId = randomUUID()) => ({
  requestId,
  reason: "Synthetic trusted draft execution",
  change,
});
function sql() {
  return createClient({
    url: "file:" + path.join(dataDirectory(), "research.sqlite"),
  });
}
test("legacy keys and reviewed grants do not delegate execution; explicit admin acknowledgment and strict bounded draft-only permissions are required", async () => {
  const c = await automationSetup(),
    input = proposal({ operation: "create", guide: automationGuide() });
  assert.equal((await c.external("execute", "POST", input)).status, 403);
  await c.grant();
  assert.equal((await c.external("execute", "POST", input)).status, 403);
  for (const extra of [
    { delegationReviewed: undefined },
    { delegation: { enabled: true, operations: ["publish"], limit24h: 5 } },
    { delegation: { enabled: true, operations: ["create"], limit24h: 51 } },
    { delegation: { enabled: true, operations: [], limit24h: 5 } },
  ])
    assert.equal(
      (
        await c.owner("automation/grants/" + c.key.id, "PUT", {
          version: 1,
          enabled: true,
          operations: ["create"],
          reviewed: true,
          delegation: { enabled: true, operations: ["create"], limit24h: 5 },
          delegationReviewed: true,
          ...extra,
        })
      ).status,
      400,
    );
  await enable(c, { version: 1 });
  const current = (await c.external("studies/" + c.s.id)).study;
  for (const change of [
    { operation: "publish", studyId: c.s.id, fingerprint: current.fingerprint },
    {
      operation: "fielding",
      studyId: c.s.id,
      fingerprint: current.fingerprint,
      state: "active",
    },
  ])
    assert.equal(
      (await c.external("execute", "POST", proposal(change))).status,
      400,
    );
  assert.equal((await c.owner("studies/" + c.s.id)).study.revisionId, null);
});
test("concurrent exact draft creation commits once, returns stable receipts, scopes only the new study and attributes history; edits preserve live publication and admissions", async () => {
  const c = await automationSetup();
  await enable(c);
  const input = proposal({
    operation: "create",
    guide: automationGuide("Automatically created private draft"),
  });
  const results = await Promise.all([
    c.external("execute", "POST", input),
    c.external("execute", "POST", input),
  ]);
  assert.deepEqual(results.map((r) => r.status).sort(), [200, 201]);
  const execution = results[0].execution,
    id = execution.result.studyId;
  assert.equal(results[1].execution.id, execution.id);
  assert.equal(execution.state, "applied");
  assert.equal(execution.result.revisionId, null);
  assert.equal(execution.result.fielding, "draft");
  assert.equal((await c.owner("studies")).studies.length, 2);
  assert.equal(
    (await c.external("executions/" + execution.id)).execution.keyName,
    c.key.name,
  );
  assert.equal(
    (
      await c.external("execute", "POST", {
        ...input,
        reason: "Changed reason",
      })
    ).status,
    409,
  );
  const keys = (await c.owner("api-keys")).keys;
  assert.ok(keys.find((k: any) => k.id === c.key.id).studyIds.includes(id));
  let study = (await c.owner("studies/" + id)).study;
  study = (
    await c.owner(`studies/${id}/publish`, "POST", { version: study.version })
  ).study;
  await c.owner(`studies/${id}/fielding`, "POST", { state: "active" });
  const before = (await c.external("studies/" + id)).study;
  const edit = proposal({
    operation: "edit",
    studyId: id,
    fingerprint: before.fingerprint,
    guide: automationGuide("A new unpublished draft"),
  });
  assert.equal((await c.external("execute", "POST", edit)).status, 201);
  const after = (await c.external("studies/" + id)).study;
  assert.equal(after.version, before.version + 1);
  assert.equal(after.revisionId, before.revisionId);
  assert.equal(after.fielding, "active");
  assert.equal(
    (await c.anon("public/" + id)).title,
    "Automatically created private draft",
  );
  assert.equal(
    (await c.external("execute", "POST", proposal(edit.change))).status,
    409,
  );
  const history = await c.owner(`studies/${id}/history`);
  assert.ok(
    JSON.stringify(history).includes("Integration: Synthetic automation key"),
  );
});
test("rolling limits count committed changes across grant edits and source erasure; exact retry does not consume another slot, old receipts age only out of the rolling count", async () => {
  const c = await automationSetup();
  await enable(c, {
    delegation: { enabled: true, operations: ["create", "edit"], limit24h: 1 },
  });
  const input = proposal({ operation: "create", guide: automationGuide() });
  const first = await c.external("execute", "POST", input);
  assert.equal(first.status, 201);
  assert.equal((await c.external("execute", "POST", input)).status, 200);
  assert.equal(
    (
      await c.external(
        "execute",
        "POST",
        proposal({ operation: "create", guide: automationGuide() }),
      )
    ).status,
    429,
  );
  await enable(c, {
    version: 1,
    delegation: { enabled: true, operations: ["create", "edit"], limit24h: 1 },
  });
  assert.equal(
    (
      await c.external(
        "execute",
        "POST",
        proposal({ operation: "create", guide: automationGuide() }),
      )
    ).status,
    429,
  );
  const db = sql();
  try {
    await db.execute({
      sql: "UPDATE documents SET data=json_set(data,'$.createdAt',?) WHERE kind='automationReceipt' AND id=?",
      args: [new Date(Date.now() - 86401000).toISOString(), first.execution.id],
    });
  } finally {
    db.close();
  }
  assert.equal(
    (
      await c.external(
        "execute",
        "POST",
        proposal({ operation: "create", guide: automationGuide() }),
      )
    ).status,
    201,
  );
});
test("selected studies, separate operations, current roles, key revocation and disabling delegation are enforced without widening OAuth or cookie access", async () => {
  const c = await automationSetup(),
    foreign = await automationSetup();
  await enable(c, {
    delegation: { enabled: true, operations: ["edit"], limit24h: 5 },
  });
  assert.equal(
    (
      await c.external(
        "execute",
        "POST",
        proposal({ operation: "create", guide: automationGuide() }),
      )
    ).status,
    403,
  );
  assert.equal(
    (
      await c.external(
        "execute",
        "POST",
        proposal({
          operation: "edit",
          studyId: foreign.s.id,
          fingerprint: "a".repeat(64),
          guide: automationGuide(),
        }),
      )
    ).status,
    404,
  );
  const req = proposal({
    operation: "edit",
    studyId: c.s.id,
    fingerprint: (await c.external("studies/" + c.s.id)).study.fingerprint,
    guide: automationGuide(),
  });
  assert.equal(
    (await c.owner("v1/automation/execute", "POST", req)).status,
    401,
  );
  assert.equal(
    (
      await foreign.owner("automation/grants/" + c.key.id, "PUT", {
        version: 1,
        enabled: false,
        operations: ["edit"],
        reviewed: true,
      })
    ).status,
    409,
  );
  await enable(c, {
    version: 1,
    delegation: { enabled: false, operations: [], limit24h: 5 },
  });
  assert.equal((await c.external("execute", "POST", req)).status, 403);
  await enable(c, { version: 2 });
  const db = sql();
  try {
    const foreignKey = await db.execute({
      sql: "SELECT json_extract(data,'$.ownerId') AS owner FROM documents WHERE kind='readApiKey' AND id=?",
      args: [foreign.key.id],
    });
    const authorizerId = String(foreignKey.rows[0].owner);
    await db.execute({
      sql: "UPDATE users SET workspace_id=(SELECT workspace_id FROM documents WHERE kind='readApiKey' AND id=?),name='Delegating admin' WHERE id=?",
      args: [c.key.id, authorizerId],
    });
    const delegated = await foreign.owner(
      "automation/grants/" + c.key.id,
      "PUT",
      {
        version: 3,
        enabled: true,
        operations: ["create", "edit"],
        reviewed: true,
        delegation: {
          enabled: true,
          operations: ["create", "edit"],
          limit24h: 5,
        },
        delegationReviewed: true,
      },
    );
    assert.equal(delegated.status, 200);
    const applied = await c.external("execute", "POST", req);
    assert.equal(applied.status, 201);
    assert.equal(applied.execution.authorizedBy, "Delegating admin");
    assert.equal(applied.execution.authorizedById, authorizerId);
    await db.execute({
      sql: "UPDATE users SET role='researcher' WHERE id=?",
      args: [authorizerId],
    });
    assert.equal(
      (
        await c.external(
          "execute",
          "POST",
          proposal({ operation: "create", guide: automationGuide() }),
        )
      ).status,
      403,
    );
    await db.execute({
      sql: "UPDATE users SET role='admin' WHERE id=?",
      args: [authorizerId],
    });
    await db.execute({
      sql: "UPDATE users SET role='researcher' WHERE workspace_id=(SELECT workspace_id FROM documents WHERE kind='readApiKey' AND id=?)",
      args: [c.key.id],
    });
    assert.equal((await c.external("execute", "POST", req)).status, 401);
    await db.execute({
      sql: "UPDATE users SET role='admin' WHERE workspace_id=(SELECT workspace_id FROM documents WHERE kind='readApiKey' AND id=?)",
      args: [c.key.id],
    });
  } finally {
    db.close();
  }
  assert.equal(
    (await c.owner(`api-keys/${c.key.id}/revoke`, "POST", { version: 1 }))
      .status,
    200,
  );
  assert.equal((await c.external("execute", "POST", req)).status, 401);
});
test("source erasure clears applied creation/edit audit bodies and indexes while spent receipts prevent replay and retain the rolling budget", async () => {
  const c = await automationSetup();
  await enable(c, {
    delegation: { enabled: true, operations: ["create", "edit"], limit24h: 2 },
  });
  const input = proposal({
      operation: "create",
      guide: automationGuide("Erase automatic audit"),
    }),
    created = await c.external("execute", "POST", input),
    id = created.execution.studyId;
  const snap = (await c.external("studies/" + id)).study;
  const edit = proposal({
    operation: "edit",
    studyId: id,
    fingerprint: snap.fingerprint,
    guide: automationGuide("Revised automatic source"),
  });
  await c.external("execute", "POST", edit);
  let s = (await c.owner("studies/" + id)).study;
  s = (await c.owner(`studies/${id}/publish`, "POST", { version: s.version }))
    .study;
  await c.owner(`studies/${id}/fielding`, "POST", { state: "active" });
  const joined = await c.anon("public/" + id, "POST", { consent: true });
  assert.equal(joined.status, 201);
  await c.anon(
    `interviews/${joined.interview.id}/answer`,
    "POST",
    {
      requestId: randomUUID(),
      version: 0,
      answer: "Synthetic original answer",
    },
    { "x-interview-token": joined.token },
  );
  assert.equal(
    (await c.owner(`studies/${id}/responses/${joined.interview.id}`, "DELETE"))
      .status,
    200,
  );
  assert.equal(
    (await c.external("executions/" + created.execution.id)).status,
    404,
  );
  assert.equal((await c.external("execute", "POST", input)).status, 410);
  const activity = await c.owner("automation");
  assert.equal(activity.executions.length, 0);
  assert.equal(
    (
      await c.external(
        "execute",
        "POST",
        proposal({ operation: "create", guide: automationGuide() }),
      )
    ).status,
    429,
  );
  const db = sql();
  try {
    const rows = await db.execute({
      sql: "SELECT data FROM documents WHERE kind='automationReceipt' AND workspace_id=(SELECT workspace_id FROM documents WHERE kind='readApiKey' AND id=?)",
      args: [c.key.id],
    });
    assert.equal(rows.rows.length, 2);
    assert.ok(!JSON.stringify(rows.rows).includes("Erase automatic audit"));
    assert.ok(!JSON.stringify(rows.rows).includes(id));
  } finally {
    db.close();
  }
});
test("official MCP discovers delegated write tools only after opt-in, executes a draft once and loses write access immediately after disable", async () => {
  const c = await automationSetup();
  await c.grant();
  const mcp = new Client({ name: "echo-lab-delegation-test", version: "1" });
  await mcp.connect(
    new StreamableHTTPClientTransport(new URL(base + "/api/mcp"), {
      requestInit: { headers: { authorization: "Bearer " + c.token } },
    }),
  );
  assert.equal(
    (await mcp.listTools()).tools.some(
      (t) => t.name === "execute_draft_change",
    ),
    false,
  );
  await enable(c, { version: 1 });
  const tools = (await mcp.listTools()).tools;
  assert.equal(
    tools.find((t) => t.name === "execute_draft_change")?.annotations
      ?.readOnlyHint,
    false,
  );
  assert.equal(
    tools.find((t) => t.name === "execute_draft_change")?.annotations
      ?.destructiveHint,
    true,
  );
  const input = proposal({
      operation: "create",
      guide: automationGuide("MCP automatic draft"),
    }),
    r = await mcp.callTool({ name: "execute_draft_change", arguments: input });
  assert.equal(r.isError, undefined);
  const e = JSON.parse((r.content as any)[0].text).execution;
  assert.equal(e.state, "applied");
  const retry = await c.external("execute", "POST", input);
  assert.equal(retry.status, 200);
  assert.equal(retry.execution.id, e.id);
  await enable(c, {
    version: 2,
    delegation: { enabled: false, operations: [], limit24h: 5 },
  });
  assert.equal(
    (await mcp.listTools()).tools.some(
      (t) => t.name === "execute_draft_change",
    ),
    false,
  );
  assert.equal(
    (
      await c.external(
        "execute",
        "POST",
        proposal({ operation: "create", guide: automationGuide() }),
      )
    ).status,
    403,
  );
  await mcp.close();
});
test("malformed, over-bound and media-invalid executions are atomic, expose no token, and permission history records the authorizing admin", async () => {
  const c = await automationSetup();
  await enable(c);
  const request = proposal({ operation: "create", guide: automationGuide() });
  assert.equal(
    (await c.external("execute?force=true", "POST", request)).status,
    400,
  );
  assert.equal(
    (await c.external("execute", "POST", { ...request, approved: true }))
      .status,
    400,
  );
  assert.equal(
    (
      await c.external("execute", "POST", {
        ...request,
        reason: "X".repeat(70000),
      })
    ).status,
    413,
  );
  assert.equal(
    (
      await c.external(
        "execute",
        "POST",
        proposal({ operation: "create", guide: { title: "Bad guide" } }),
      )
    ).status,
    400,
  );
  const guide = automationGuide();
  guide.questions[0].options = [];
  (guide as any).conceptTest = {
    concepts: [
      {
        id: "c",
        name: "Missing image",
        headline: "",
        description: "",
        imageAssetId: randomUUID(),
        imageDescription: "Synthetic missing image",
      },
    ],
    assignment: "all",
    randomize: false,
  };
  const failed = await c.external(
    "execute",
    "POST",
    proposal({ operation: "create", guide }),
  );
  assert.equal(failed.status, 400);
  const activity = await c.owner("automation");
  assert.equal(activity.executions.length, 0);
  assert.equal(activity.grantEvents[0].actorName, "Automation reviewer");
  assert.equal(activity.grantEvents[0].delegation.enabled, true);
  assert.ok(!JSON.stringify(activity).includes(c.token));
  assert.equal((await c.owner("studies")).studies.length, 1);
});
test("parallel distinct create requests cannot exceed a one-change delegation budget", async () => {
  const c = await automationSetup();
  await enable(c, {
    delegation: { enabled: true, operations: ["create"], limit24h: 1 },
  });
  const first = proposal({
      operation: "create",
      guide: automationGuide("First race draft"),
    }),
    second = proposal({
      operation: "create",
      guide: automationGuide("Second race draft"),
    });
  const results = await Promise.all([
    c.external("execute", "POST", first),
    c.external("execute", "POST", second),
  ]);
  assert.equal(results.filter((r) => r.status === 201).length, 1);
  assert.ok(results.some((r) => [409, 429].includes(r.status)));
  const remaining = results[0].status === 201 ? second : first;
  assert.equal((await c.external("execute", "POST", remaining)).status, 429);
  assert.equal((await c.owner("automation")).executions.length, 1);
  assert.equal((await c.owner("studies")).studies.length, 2);
});
