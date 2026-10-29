import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import {
  Client,
  StreamableHTTPClientTransport,
} from "@modelcontextprotocol/client";
import { start, stop, base, client } from "./harness";
import { reconciliationSetup } from "./reconciliation-fixture";
import { studyDto, responseDto, analysisDto } from "../src/lib/external-api";
before(() => start({ port: 3452 }), { timeout: 90000 });
after(stop);
test("recovery defaults off and requires separate current admin authorization, strict input and selected read scopes", async () => {
  const c = await reconciliationSetup();
  assert.equal((await c.external("runs", "POST", c.input())).status, 403);
  const anon = await client();
  assert.equal((await anon("integration-recovery")).status, 401);
  await c.grant();
  for (const extra of [
    { studyIds: [randomUUID()] },
    { resources: ["draft"] },
    { resources: ["study", "study"] },
    { pageSize: 101 },
    { unexpected: true },
  ])
    assert.ok(
      [400, 404].includes(
        (await c.external("runs", "POST", c.input(extra))).status,
      ),
    );
  await c.local.put("readApiKey", {
    ...(await c.local.get<any>("readApiKey", c.key.id, c.actor.workspaceId)),
    scopes: ["studies:read"],
  });
  assert.equal((await c.external("runs", "POST", c.input())).status, 403);
  assert.equal(
    (await c.external("runs?extra=1", "POST", c.input())).status,
    400,
  );
  await c.local.db
    .prepare("UPDATE users SET role='researcher' WHERE id=?")
    .run(c.actor.id);
  assert.equal(
    (await c.external("runs", "POST", c.input({ resources: ["study"] })))
      .status,
    401,
  );
  assert.equal((await c.owner("integration-recovery")).status, 403);
});
test("inventories match published read DTO fingerprints and omit excluded, preview, incomplete, unreviewed, stale and invalid evidence", async () => {
  const c = await reconciliationSetup();
  await c.grant();
  const i = await c.source();
  for (const extra of [
    { preview: true },
    { excluded: true },
    { status: "active" },
  ])
    await c.source(extra);
  const a = {
    id: randomUUID(),
    workspaceId: c.actor.workspaceId,
    studyId: c.s.id,
    reviewed: true,
    dataVersion: c.s.dataVersion,
    version: 1,
    createdAt: new Date().toISOString(),
    studyGoal: "Synthetic",
    model: "synthetic fixture",
    summary: "PRIVATE SYNTHETIC MEMO",
    memo: "PRIVATE SYNTHETIC MEMO",
    limitations: "Synthetic fixture only",
    themes: [
      {
        id: "theme",
        title: "Synthetic",
        description: "Synthetic",
        citations: [
          {
            interviewId: i.id,
            turnId: i.turns[0].id,
            quote: "SYNTHETIC ANSWER",
          },
        ],
      },
    ],
  };
  await c.local.put("analysis", a);
  for (const extra of [
    { reviewed: false },
    { dataVersion: 999 },
    {
      themes: [
        {
          citations: [
            { interviewId: i.id, turnId: randomUUID(), quote: "absent" },
          ],
        },
      ],
    },
  ])
    await c.local.put("analysis", { ...a, ...extra, id: randomUUID() });
  const start = await c.external("runs", "POST", c.input({ pageSize: 100 }));
  assert.equal(start.status, 201, JSON.stringify(start));
  const view = await c.external("runs/" + start.run.id);
  assert.equal(view.page.items.length, 3, JSON.stringify(view));
  const revision = await c.local.get<any>(
    "revision",
    c.s.revisionId,
    c.actor.workspaceId,
  );
  const expected = {
    study: c.local.hash(JSON.stringify(studyDto(c.s, revision))),
    response: c.local.hash(JSON.stringify(responseDto(i))),
    analysis: c.local.hash(JSON.stringify(analysisDto(a, true))),
  };
  for (const item of view.page.items) {
    assert.equal(item.etag, expected[item.resource as keyof typeof expected]);
    const read = await fetch(base + item.path, {
      headers: { authorization: "Bearer " + c.token },
    });
    assert.equal(read.status, 200);
  }
  assert.ok(!JSON.stringify(view).includes("PRIVATE"));
  const raw = await c.local.get<any>(
    "reconciliationRun",
    start.run.id,
    c.actor.workspaceId,
  );
  assert.ok(!JSON.stringify(raw).includes("PRIVATE"));
});
test("concurrent exact starts/checkpoints commit once, disallow skipping and stale pages, and resume at the server position", async () => {
  const c = await reconciliationSetup();
  await c.grant();
  await c.source();
  const input = c.input();
  const starts = await Promise.all([
    c.external("runs", "POST", input),
    c.external("runs", "POST", input),
  ]);
  assert.deepEqual(starts.map((r) => r.status).sort(), [200, 201]);
  const id = starts[0].run.id;
  assert.equal(
    (await c.external("runs", "POST", { ...input, pageSize: 2 })).status,
    409,
  );
  const v = await c.external("runs/" + id);
  assert.equal((await c.ack(id, v, { position: 1 })).status, 409);
  await c.changed();
  assert.equal((await c.ack(id, v)).status, 409);
  const fresh = await c.external("runs/" + id),
    requestId = randomUUID();
  const results = await Promise.all([
    c.ack(id, fresh, { requestId }),
    c.ack(id, fresh, { requestId }),
  ]);
  assert.deepEqual(
    results.map((r) => r.status),
    [200, 200],
  );
  assert.equal(results.filter((r) => r.reused).length, 1);
  assert.equal(
    (await c.ack(id, fresh, { requestId, pageToken: "a".repeat(64) })).status,
    409,
  );
  const next = await c.external("runs/" + id);
  assert.equal(next.run.position, 1);
  assert.equal(next.run.version, 2);
  assert.equal((await c.ack(id, next)).checkpoint.state, "complete");
  assert.equal((await c.external("runs/" + id)).run.state, "complete");
  await c.changed();
  assert.equal((await c.external("runs/" + id)).run.state, "needs_rescan");
});
test("new sources and changes to already acknowledged sources require a fresh scan at completion", async () => {
  const c = await reconciliationSetup();
  await c.grant();
  await c.source();
  const r = await c.external("runs", "POST", c.input());
  const id = r.run.id;
  const v = await c.external("runs/" + id);
  await c.ack(id, v);
  await c.source();
  const last = await c.external("runs/" + id);
  assert.equal(last.rescanRequired, true);
  assert.equal((await c.ack(id, last)).checkpoint.state, "needs_rescan");
  assert.equal((await c.ack(id, last)).status, 409);
  const changedRun = await c.external(
    "runs",
    "POST",
    c.input({ resources: ["response"] }),
  );
  const first = await c.external("runs/" + changedRun.run.id);
  await c.ack(changedRun.run.id, first);
  const previous = await c.local.get<any>(
    "interview",
    first.page.items[0].id,
    c.actor.workspaceId,
  );
  await c.local.put("interview", {
    ...previous,
    turns: previous.turns.map((t: any) => ({
      ...t,
      answer: t.answer + " changed",
    })),
  });
  const remaining = await c.external("runs/" + changedRun.run.id);
  assert.equal(remaining.rescanRequired, true);
  assert.equal(
    (await c.ack(changedRun.run.id, remaining)).checkpoint.state,
    "needs_rescan",
  );
  const withdrawnRun = await c.external(
    "runs",
    "POST",
    c.input({ resources: ["response"], pageSize: 100 }),
  );
  await c.local.put("interview", { ...previous, excluded: true });
  const withdrawn = await c.external("runs/" + withdrawnRun.run.id);
  const unavailable = withdrawn.page.items.find(
    (item: any) => item.id === previous.id,
  );
  assert.equal(unavailable.state, "unavailable");
  assert.equal(unavailable.etag, null);
  assert.equal(unavailable.path, undefined);
  assert.equal(
    (await c.ack(withdrawnRun.run.id, withdrawn)).checkpoint.state,
    "complete",
  );
});
test("bulk checks are transient and generic, inherit scopes, and detect unavailable sources without retaining unknown IDs", async () => {
  const c = await reconciliationSetup();
  await c.grant();
  const i = await c.source(),
    missing = randomUUID();
  const refs = [
    { resource: "response", studyId: c.s.id, id: i.id },
    { resource: "response", studyId: c.s.id, id: missing },
  ];
  let r = await c.external("check", "POST", { items: refs });
  assert.deepEqual(
    r.items.map((v: any) => v.state),
    ["available", "unavailable"],
  );
  await c.local.put("interview", { ...i, excluded: true });
  r = await c.external("check", "POST", { items: refs });
  assert.deepEqual(
    r.items.map((v: any) => v.state),
    ["unavailable", "unavailable"],
  );
  assert.equal(r.items[0].etag, null);
  assert.ok(!JSON.stringify(r).includes("excluded"));
  const persisted = await c.local.db
    .prepare(
      "SELECT data FROM documents WHERE kind LIKE 'reconciliation%' AND workspace_id=?",
    )
    .all(c.actor.workspaceId);
  assert.ok(!JSON.stringify(persisted).includes(missing));
  assert.equal(
    (
      await c.external("check", "POST", {
        items: [{ ...refs[0], studyId: randomUUID() }],
      })
    ).status,
    404,
  );
  assert.equal(
    (await c.external("check", "POST", { items: Array(101).fill(refs[0]) }))
      .status,
    400,
  );
  const large = await fetch(base + "/api/v1/reconciliation/check", {
    method: "POST",
    headers: {
      authorization: "Bearer " + c.token,
      "content-type": "application/json",
    },
    body: JSON.stringify({ items: refs, padding: "x".repeat(65536) }),
  });
  assert.equal(large.status, 413);
});
test("policy/key changes invalidate checkpoints and expiry, rolling start caps and admin discard preserve retry tombstones", async () => {
  const c = await reconciliationSetup();
  await c.grant({ limit24h: 1 });
  const input = c.input(),
    r = await c.external("runs", "POST", input),
    id = r.run.id;
  assert.equal((await c.external("runs", "POST", c.input())).status, 429);
  assert.equal((await c.external("runs", "POST", input)).status, 200);
  await c.grant();
  assert.equal((await c.external("runs/" + id)).status, 409);
  assert.equal(
    (
      await c.owner("integration-recovery/runs/" + id, "DELETE", {
        version: 2,
        reviewed: true,
      })
    ).status,
    409,
  );
  assert.equal(
    (
      await c.owner("integration-recovery/runs/" + id, "DELETE", {
        version: 1,
        reviewed: true,
      })
    ).status,
    200,
  );
  assert.equal((await c.external("runs", "POST", input)).status, 410);
  const second = await c.external("runs", "POST", c.input());
  const raw = await c.local.get<any>(
    "reconciliationRun",
    second.run.id,
    c.actor.workspaceId,
  );
  await c.local.put("reconciliationRun", { ...raw, expiresAt: Date.now() - 1 });
  assert.equal((await c.external("runs/" + second.run.id)).status, 410);
  await c.grant({ enabled: false });
  assert.equal(
    (
      await c.external("check", "POST", {
        items: [{ resource: "study", studyId: c.s.id, id: c.s.id }],
      })
    ).status,
    403,
  );
});
test("source erasure clears whole inventory metadata while content-free creation receipts prevent late replay", async () => {
  const c = await reconciliationSetup();
  await c.grant();
  const i = await c.source(),
    input = c.input(),
    r = await c.external("runs", "POST", input),
    view = await c.external("runs/" + r.run.id);
  const { clearReporting } = await import("../src/lib/reporting-cleanup");
  await clearReporting(c.s);
  assert.equal(
    await c.local.get("reconciliationRun", r.run.id, c.actor.workspaceId),
    undefined,
  );
  const receipt = await c.local.get<any>(
    "reconciliationReceipt",
    r.run.id,
    c.actor.workspaceId,
  );
  assert.ok(receipt);
  assert.ok(!JSON.stringify(receipt).includes(i.id));
  assert.ok(!JSON.stringify(receipt).includes(c.s.id));
  assert.equal((await c.external("runs", "POST", input)).status, 410);
  assert.equal((await c.ack(r.run.id, view)).status, 410);
  const { pruneReconciliation } =
    await import("../src/lib/reconciliation-lifecycle");
  await c.local.put("reconciliationReceipt", {
    ...receipt,
    createdAt: new Date(Date.now() - 8 * 86400000).toISOString(),
  });
  await pruneReconciliation(c.actor.workspaceId);
  assert.equal(
    await c.local.get("reconciliationReceipt", r.run.id, c.actor.workspaceId),
    undefined,
  );
});
test("official MCP discovery stays read-only by default and adds correctly annotated recovery progress tools only for enabled static keys", async () => {
  const c = await reconciliationSetup();
  async function connect() {
    const t = new StreamableHTTPClientTransport(new URL(base + "/api/mcp"), {
      requestInit: { headers: { authorization: "Bearer " + c.token } },
    });
    const m = new Client({ name: "Synthetic recovery client", version: "1" });
    await m.connect(t);
    return m;
  }
  let m = await connect();
  assert.equal((await m.listTools()).tools.length, 6);
  await m.close();
  await c.grant();
  m = await connect();
  try {
    const tools = (await m.listTools()).tools;
    assert.equal(tools.length, 10);
    assert.equal(
      tools.find((t) => t.name === "checkpoint_reconciliation")?.annotations
        ?.readOnlyHint,
      false,
    );
    assert.equal(
      tools.find((t) => t.name === "check_source_availability")?.annotations
        ?.readOnlyHint,
      true,
    );
    const started = await m.callTool({
      name: "start_reconciliation",
      arguments: c.input({ resources: ["study"] }),
    });
    assert.ok(!started.isError, JSON.stringify(started));
    const r = started.structuredContent as any;
    const view = (
      await m.callTool({
        name: "get_reconciliation",
        arguments: { runId: r.run.id },
      })
    ).structuredContent as any;
    const ack = await m.callTool({
      name: "checkpoint_reconciliation",
      arguments: {
        runId: r.run.id,
        requestId: randomUUID(),
        version: view.run.version,
        position: 0,
        pageToken: view.page.pageToken,
      },
    });
    assert.equal((ack.structuredContent as any).checkpoint.state, "complete");
    await c.grant({ enabled: false });
    await assert.rejects(() =>
      m.callTool({
        name: "get_reconciliation",
        arguments: { runId: r.run.id },
      }),
    );
  } finally {
    await m.close();
  }
});
test("active inventory, snapshot and retention bounds reject overflow without retaining partial runs", async () => {
  const c = await reconciliationSetup();
  await c.grant();
  for (let n = 0; n < 5; n++)
    assert.equal((await c.external("runs", "POST", c.input())).status, 201);
  assert.equal((await c.external("runs", "POST", c.input())).status, 409);
  const runs = await c.local.list<any>(
    "reconciliationRun",
    c.actor.workspaceId,
  );
  for (const r of runs)
    assert.equal(
      (await c.external("runs/" + r.id, "DELETE", { version: r.version }))
        .status,
      200,
    );
  const i = await c.source();
  await c.local.transaction(async () => {
    for (let n = 0; n < 1000; n++)
      await c.local.put("interview", { ...i, id: randomUUID() });
  });
  assert.equal(
    (await c.external("runs", "POST", c.input({ resources: ["response"] })))
      .status,
    409,
  );
  assert.equal(
    (await c.local.list("reconciliationRun", c.actor.workspaceId)).length,
    0,
  );
  assert.equal(
    (await c.local.list("reconciliationReceipt", c.actor.workspaceId)).length,
    5,
  );
});
