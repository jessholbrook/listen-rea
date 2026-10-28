import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { start, stop } from "./harness";
import {
  inboxSetup,
  feedbackAction,
  packetEdit,
  finalReview,
} from "./team-review-inbox-fixture";
import { client } from "./image-review-fixture";
import { batchLabels } from "../src/lib/batch-review-plans";
before(() => start({ port: 3400 }), { timeout: 90000 });
after(stop);
const root = "library/review-plan-batch/";
const target = (g: any) => ({
  collectionId: g.collection.id,
  id: g.d.packet.id,
});
const input = (p: any, groups: any[]) => ({
  planId: p.id,
  planVersion: p.version,
  start: "2028-02-28",
  packets: groups.map(target),
});
const action = (p: any) => ({
  planId: p.plan.id,
  planVersion: p.plan.version,
  start: p.start,
  acknowledged: true,
  packets: p.packets
    .filter((v: any) => v.status === "ready")
    .map(({ collectionId, id, packetVersion, version, signature }: any) => ({
      collectionId,
      id,
      packetVersion,
      version,
      signature,
    })),
});
const plan = async (c: any, ids = [c.actor.id]) =>
  (
    await c.owner("library/review-plans", "POST", {
      name: "Synthetic batch plan",
      reviewers: ids.map((id: string, n: number) => ({
        id,
        days: n ? null : 2,
      })),
    })
  ).plan;
test(
  "batch preview is bounded, editor-only, workspace/generation scoped and minimal; preparing does not change review state",
  { timeout: 120000 },
  async () => {
    const c = await inboxSetup(),
      g = await c.create("Batch preview", [c.actor.id]),
      p = await plan(c);
    g.d = await c.owner(
      g.path + "/feedback",
      "POST",
      feedbackAction(g.d, {
        op: "comment",
        requestId: randomUUID(),
        body: "PRIVATE_BATCH_COMMENT",
      }),
    );
    const r = await c.owner(root + "preview", "POST", input(p, [g]));
    assert.equal(r.status, 200);
    assert.equal(r.packets[0].status, "ready");
    assert.equal(r.packets[0].openComments, 1);
    assert.equal(r.reviewers[0].dueDate, "2028-03-01");
    assert.deepEqual((await c.owner(g.path)).feedback, g.d.feedback);
    for (const word of [
      "PRIVATE_",
      "workspaceId",
      "summary",
      "transcript",
      "inputHash",
      "authorId",
      "email",
      "password",
      "tombstones",
    ])
      assert.equal(JSON.stringify(r).includes(word), false, word);
    const anon = await client(),
      foreign = await client();
    assert.equal(
      (await anon(root + "preview", "POST", input(p, [g]))).status,
      401,
    );
    await foreign("auth/signup", "POST", {
      name: "Foreign batch user",
      email: randomUUID() + "@example.test",
      password: "foreign-batch-password",
    });
    assert.equal(
      (await foreign(root + "preview", "POST", input(p, [g]))).status,
      404,
    );
    await c.local.db
      .prepare("UPDATE users SET role='viewer' WHERE id=?")
      .run(c.person.id);
    assert.equal(
      (await c.person.call(root + "preview", "POST", input(p, [g]))).status,
      403,
    );
    assert.equal(
      (await c.person.call(root + "apply", "POST", action(r))).status,
      403,
    );
    assert.equal((await c.owner(root + "preview")).status, 405);
    assert.equal((await c.owner(root + "unknown", "POST", {})).status, 404);
    assert.equal(
      (await c.owner(root + "preview/nested", "POST", {})).status,
      404,
    );
    const missing = await c.owner(root + "preview", "POST", {
      ...input(p, [g]),
      packets: [
        { collectionId: g.collection.id, id: randomUUID() },
        { collectionId: randomUUID(), id: randomUUID() },
      ],
    });
    assert.deepEqual(
      missing.packets.map((v: any) => v.status),
      ["unavailable", "unavailable"],
    );
    assert.equal(JSON.stringify(missing).includes(g.d.packet.title), false);
    for (const l of Object.values(batchLabels))
      assert.deepEqual(Object.keys(l), Object.keys(batchLabels.en));
  },
);
test(
  "batch application resets every requested decision/final approval, preserves comments, computes deadlines and rejects a repeated batch",
  { timeout: 120000 },
  async () => {
    const c = await inboxSetup(),
      a = await c.create("Batch approved one", [c.actor.id]),
      b = await c.create("Batch approved two", [c.actor.id]);
    for (const g of [a, b]) {
      let d = g.d;
      d = await c.owner(
        g.path + "/feedback",
        "POST",
        feedbackAction(d, {
          op: "comment",
          requestId: randomUUID(),
          body: "PRIVATE_PRESERVED_COMMENT",
        }),
      );
      d = await c.owner(
        g.path + "/feedback",
        "POST",
        feedbackAction(d, {
          op: "resolve",
          commentId: d.feedback.comments[0].id,
          resolved: true,
        }),
      );
      d = await c.owner(
        g.path + "/feedback",
        "POST",
        feedbackAction(d, { op: "decision", approved: true }),
      );
      g.d = await c.owner(g.path + "/review", "POST", finalReview(d));
      assert.ok(g.d.packet.reviewedAt);
    }
    const p = await plan(c, [c.person.id, c.actor.id]),
      preview = await c.owner(root + "preview", "POST", input(p, [a, b]));
    assert.ok(preview.packets.every((v: any) => v.finalApproved));
    const request = action(preview),
      result = await c.owner(root + "apply", "POST", request);
    assert.deepEqual(
      result.packets.map((v: any) => v.status),
      ["applied", "applied"],
    );
    for (const g of [a, b]) {
      const d = await c.owner(g.path);
      assert.equal(d.packet.reviewedAt, null);
      assert.equal(d.packet.canExport, false);
      assert.deepEqual(
        d.feedback.reviewers.map((v: any) => [v.id, v.dueDate, v.approvedAt]),
        [
          [c.person.id, "2028-03-01", null],
          [c.actor.id, null, null],
        ],
      );
      assert.equal(d.feedback.comments[0].body, "PRIVATE_PRESERVED_COMMENT");
      assert.ok(d.feedback.comments[0].resolvedAt);
      g.d = d;
    }
    const replay = await c.owner(root + "apply", "POST", request);
    assert.deepEqual(
      replay.packets.map((v: any) => v.status),
      ["conflict", "conflict"],
    );
    for (const g of [a, b])
      assert.deepEqual((await c.owner(g.path)).feedback, g.d.feedback);
    assert.equal(JSON.stringify(result).includes("PRIVATE_"), false);
  },
);
test(
  "mixed batch commits independent successes and reports stale, deleted and forged packets without changing them",
  { timeout: 120000 },
  async () => {
    const c = await inboxSetup(false),
      groups = [];
    for (const name of [
      "Stale batch",
      "Good batch",
      "Deleted batch",
      "Forged batch",
    ])
      groups.push(await c.create(name));
    const p = await plan(c),
      preview = await c.owner(root + "preview", "POST", input(p, groups)),
      request = action(preview);
    groups[0].d = await c.owner(
      groups[0].path,
      "PUT",
      packetEdit(groups[0].d, { summary: "PRIVATE_CHANGED_BATCH" }),
    );
    await c.owner(groups[2].path, "DELETE", {
      id: groups[2].d.packet.id,
      version: groups[2].d.packet.version,
    });
    request.packets[3].signature = "0".repeat(64);
    const result = await c.owner(root + "apply", "POST", request);
    assert.deepEqual(
      result.packets.map((v: any) => v.status),
      ["conflict", "applied", "unavailable", "conflict"],
    );
    for (const n of [0, 3])
      assert.deepEqual(
        (await c.owner(groups[n].path)).feedback,
        groups[n].d.feedback,
      );
    assert.equal(
      (await c.owner(groups[1].path)).feedback.reviewers[0].dueDate,
      "2028-03-01",
    );
    assert.equal((await c.owner(groups[2].path)).packet, null);
    for (const n of [2])
      assert.deepEqual(Object.keys(result.packets[n]).sort(), [
        "collectionId",
        "id",
        "status",
      ]);
  },
);
test(
  "invalid/global-stale plan requests never start a batch and unavailable reviewers do not partially update packets",
  { timeout: 120000 },
  async () => {
    const c = await inboxSetup(),
      g = await c.create("Batch validation"),
      p = await plan(c, [c.person.id]),
      v = input(p, [g]),
      preview = await c.owner(root + "preview", "POST", v),
      request = action(preview);
    for (const extra of [
      { packets: [] },
      { packets: [...v.packets, ...v.packets] },
      {
        packets: Array.from({ length: 11 }, () => ({
          id: randomUUID(),
          collectionId: randomUUID(),
        })),
      },
      { start: "2027-02-29" },
      { start: "2100-12-31" },
      { extra: "PRIVATE" },
    ])
      assert.equal(
        (await c.owner(root + "preview", "POST", { ...v, ...extra })).status,
        400,
      );
    assert.equal(
      (
        await c.owner(root + "apply", "POST", {
          ...request,
          acknowledged: false,
        })
      ).status,
      400,
    );
    assert.equal(
      (
        await c.owner(root + "apply", "POST", {
          ...request,
          packets: [{ ...request.packets[0], title: "injected" }],
        })
      ).status,
      400,
    );
    await c.local.db
      .prepare("UPDATE users SET role='viewer' WHERE id=?")
      .run(c.person.id);
    assert.equal((await c.owner(root + "apply", "POST", request)).status, 409);
    await c.local.db
      .prepare("UPDATE users SET role='researcher' WHERE id=?")
      .run(c.person.id);
    await c.owner("library/review-plans/" + p.id, "PUT", {
      name: p.name,
      reviewers: p.reviewers,
      version: 1,
    });
    assert.equal((await c.owner(root + "apply", "POST", request)).status, 409);
    await c.owner("library/review-plans/" + p.id, "DELETE", { version: 2 });
    assert.equal((await c.owner(root + "apply", "POST", request)).status, 404);
    assert.deepEqual((await c.owner(g.path)).feedback, g.d.feedback);
  },
);
test(
  "source erasure and replacement packet generations cannot be revived by batch previews or applications",
  { timeout: 120000 },
  async () => {
    const c = await inboxSetup(false),
      a = await c.create("Batch source one"),
      b = await c.create("Batch source two"),
      p = await plan(c),
      v = input(p, [a, b]),
      preview = await c.owner(root + "preview", "POST", v);
    await c.owner(a.path, "DELETE", {
      id: a.d.packet.id,
      version: a.d.packet.version,
    });
    const replacement = await c.owner(a.path, "POST", {
      requestId: randomUUID(),
      title: "Replacement generation",
      summary: "PRIVATE_REPLACEMENT",
      language: "en",
      answerIds: [],
      taskIds: [],
    });
    assert.equal(replacement.status, 201);
    const result = await c.owner(root + "apply", "POST", action(preview));
    assert.deepEqual(
      result.packets.map((v: any) => v.status),
      ["unavailable", "applied"],
    );
    assert.deepEqual((await c.owner(a.path)).feedback.reviewers, []);
    await c.owner(
      `studies/${c.imports[0].s.id}/responses/${c.imports[0].interviewId}`,
      "DELETE",
    );
    const gone = await c.owner(root + "preview", "POST", v);
    assert.deepEqual(
      gone.packets.map((v: any) => v.status),
      ["unavailable", "unavailable"],
    );
    assert.equal(
      JSON.stringify(gone).includes("Replacement generation"),
      false,
    );
    assert.deepEqual((await c.owner("library/review-plans")).plans, [p]);
    assert.equal(
      (await c.local.list("libraryHandoffFeedback", c.actor.workspaceId))
        .length,
      0,
    );
    assert.equal(
      (await c.local.list("libraryReviewBatch", c.actor.workspaceId)).length,
      0,
    );
  },
);
test(
  "competing batches apply each packet exactly once even when independent packet commits interleave",
  { timeout: 120000 },
  async () => {
    const c = await inboxSetup(false),
      a = await c.create("Concurrent batch one"),
      b = await c.create("Concurrent batch two"),
      p = await plan(c),
      preview = await c.owner(root + "preview", "POST", input(p, [a, b]));
    const results = await Promise.all([
      c.owner(root + "apply", "POST", action(preview)),
      c.owner(root + "apply", "POST", action(preview)),
    ]);
    for (const g of [a, b]) {
      assert.equal(
        results
          .flatMap((r) => r.packets)
          .filter((v) => v.id === g.d.packet.id && v.status === "applied")
          .length,
        1,
      );
      const d = await c.owner(g.path);
      assert.equal(d.feedback.version, 1);
      assert.equal(d.feedback.reviewers[0].id, c.actor.id);
    }
  },
);
test(
  "a caller whose role or workspace changed after authentication cannot prepare or mutate a packet",
  { timeout: 120000 },
  async () => {
    const c = await inboxSetup(false),
      g = await c.create("Batch actor recheck"),
      p = await plan(c),
      preview = await c.owner(root + "preview", "POST", input(p, [g])),
      expected = action(preview).packets[0],
      service = await import("../src/lib/collection-handoff-server");
    for (const sql of [
      "UPDATE users SET role='viewer' WHERE id=?",
      "UPDATE users SET workspace_id='00000000-0000-4000-8000-000000000000' WHERE id=?",
    ]) {
      await c.local.db.prepare(sql).run(c.actor.id);
      await assert.rejects(
        () =>
          service.prepareBatchReview(c.actor, g.collection.id, g.d.packet.id),
        (e: any) => e.status === 403,
      );
      await assert.rejects(
        () =>
          service.applyBatchReview(c.actor, g.collection.id, {
            ...expected,
            op: "plan",
            planId: p.id,
            planVersion: 1,
            start: "2028-02-28",
            acknowledged: true,
          }),
        (e: any) => e.status === 403,
      );
      await c.local.db
        .prepare("UPDATE users SET role='admin',workspace_id=? WHERE id=?")
        .run(c.actor.workspaceId, c.actor.id);
    }
    assert.deepEqual((await c.owner(g.path)).feedback, g.d.feedback);
  },
);
