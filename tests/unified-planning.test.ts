import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { start, stop } from "./harness";
import {
  inboxSetup,
  feedbackAction,
  finalReview,
} from "./team-review-inbox-fixture";
import { client } from "./image-review-fixture";
import {
  initialUnifiedFilters,
  unifiedProjection,
  planningRows,
} from "../src/lib/unified-planning";
before(() => start({ port: 3426 }), { timeout: 90000 });
after(stop);
const root = "library/unified-planning";
async function setup() {
  const c = await inboxSetup(),
    g = await c.create("Unified calendar", [c.actor.id, c.person.id]),
    tasks = [];
  let d = g.d;
  for (const [reviewerId, dueDate] of [
    [c.actor.id, "2028-02-29"],
    [c.person.id, "2028-03-06"],
  ])
    d = await c.owner(
      g.path + "/feedback",
      "POST",
      feedbackAction(d, { op: "deadline", reviewerId, dueDate }),
    );
  for (const [assigneeId, dueDate, status] of [
    [c.actor.id, "2028-02-28", "open"],
    [null, null, "open"],
    [c.person.id, "2028-02-29", "completed"],
  ]) {
    const r = await c.owner(
      `library/collections/${g.collection.id}/tasks`,
      "POST",
      {
        requestId: randomUUID(),
        title: "Unified task " + tasks.length,
        assigneeId,
        dueDate,
        status,
        target: { kind: "interview", id: c.imports[0].interviewId },
      },
    );
    assert.equal(r.status, 201);
    tasks.push(r.task);
  }
  return { ...c, g, tasks };
}
const state = (collectionId: string) => ({
  ...initialUnifiedFilters("2028-02-29"),
  collectionId,
});
test(
  "unified projection counts individual review requests and task dates with exact kind/person/collection/title intersections, completion and local date windows",
  { timeout: 120000 },
  async () => {
    const c = await setup(),
      data = await c.owner(root),
      f = state(c.g.collection.id);
    assert.equal(data.status, 200);
    assert.ok(data.loadedAt);
    const p = unifiedProjection(data, f, "2028-02-29");
    assert.equal(p.tasks, 1);
    assert.equal(p.reviews, 1);
    assert.equal(p.counts["2028-02-29"], 1);
    assert.deepEqual(p.priorities, { overdue: 1, week: 2, undated: 1 });
    assert.equal(
      unifiedProjection(data, { ...f, includeFinished: true }, "2028-02-29")
        .counts["2028-02-29"],
      2,
    );
    assert.equal(
      unifiedProjection(
        data,
        { ...f, kind: "reviews", window: "week" },
        "2028-02-29",
      ).rows.length,
      2,
    );
    assert.equal(
      unifiedProjection(
        data,
        { ...f, window: "week", person: "mine" },
        "2028-02-29",
      ).rows.length,
      1,
    );
    assert.equal(
      unifiedProjection(
        data,
        { ...f, window: "undated", person: "unassigned" },
        "2028-02-29",
      ).tasks,
      1,
    );
    assert.equal(
      unifiedProjection(
        data,
        { ...f, window: "undated", person: "unassigned" },
        "2028-02-29",
      ).reviews,
      0,
    );
    assert.equal(
      unifiedProjection(
        data,
        { ...f, query: "Packet Unified", kind: "reviews" },
        "2028-02-29",
      ).reviews,
      1,
    );
    assert.equal(
      unifiedProjection(data, { ...f, day: "2028-02-29" }, "2028-02-29").rows
        .length,
      1,
    );
    assert.equal(
      unifiedProjection(
        data,
        { ...f, collectionId: randomUUID() },
        "2028-02-29",
      ).rows.length,
      0,
    );
    assert.equal(
      unifiedProjection(data, { ...f, person: randomUUID() }, "2028-02-29").rows
        .length,
      0,
    );
    assert.equal(
      unifiedProjection(data, f, "2028-03-01").priorities.overdue,
      2,
    );
    assert.equal(
      new Set(planningRows(data, f, "2028-02-29", false).map((r) => r.key))
        .size,
      4,
    );
    const finished = structuredClone(data);
    finished.actions.tasks = finished.actions.tasks.map((t: any) => ({
      ...t,
      status: "completed",
      dueDate: null,
    }));
    finished.reviews.packets = finished.reviews.packets.map((p: any) => ({
      ...p,
      reviewers: p.reviewers.map((r: any) => ({
        ...r,
        approvedAt: "2028-02-29T12:00:00Z",
        dueDate: null,
      })),
    }));
    assert.equal(
      planningRows(
        finished,
        { ...f, window: "undated", includeFinished: true },
        "2028-02-29",
      ).length,
      0,
    );
    assert.equal(
      planningRows(
        finished,
        { ...f, includeFinished: true },
        "2028-02-29",
        false,
      ).length,
      5,
    );
  },
);
test(
  "one packet with multiple reviewer deadlines occupies separate exact rows; current decisions and names refresh while reads preserve tasks and review activity",
  { timeout: 120000 },
  async () => {
    const c = await setup();
    let d = await c.owner(c.g.path);
    d = await c.owner(
      c.g.path + "/feedback",
      "POST",
      feedbackAction(d, {
        op: "deadline",
        reviewerId: c.person.id,
        dueDate: "2028-02-29",
      }),
    );
    const snapshot = await c.local.db
      .prepare(
        "SELECT kind,id,data FROM documents WHERE workspace_id=? AND kind IN ('libraryCollectionTask','libraryHandoffFeedback','libraryReviewActivity','libraryTaskActivity') ORDER BY kind,id",
      )
      .all(c.actor.workspaceId);
    let data = await c.owner(root),
      f = state(c.g.collection.id);
    assert.equal(unifiedProjection(data, f, "2028-02-29").reviews, 2);
    await c.owner(root);
    assert.deepEqual(
      await c.local.db
        .prepare(
          "SELECT kind,id,data FROM documents WHERE workspace_id=? AND kind IN ('libraryCollectionTask','libraryHandoffFeedback','libraryReviewActivity','libraryTaskActivity') ORDER BY kind,id",
        )
        .all(c.actor.workspaceId),
      snapshot,
    );
    d = await c.owner(
      c.g.path + "/feedback",
      "POST",
      feedbackAction(d, { op: "decision", approved: true }),
    );
    assert.equal(
      unifiedProjection(await c.owner(root), f, "2028-02-29").reviews,
      1,
    );
    await c.local.db
      .prepare("UPDATE users SET name='Current unified reviewer' WHERE id=?")
      .run(c.person.id);
    data = await c.owner(root);
    assert.equal(unifiedProjection(data, f, "2028-02-29").reviews, 2);
    const rows = unifiedProjection(
      data,
      { ...f, includeFinished: true, day: "2028-02-29" },
      "2028-02-29",
    ).rows;
    assert.equal(rows.filter((r) => r.kind === "review").length, 2);
    assert.ok(rows.some((r) => r.personName === "Current unified reviewer"));
    assert.equal(
      rows.find((r) => r.kind === "review" && r.personId === c.actor.id)
        ?.finished,
      false,
    );
  },
);
test(
  "review scheduling through the original planning/feedback coordinates preserves approvals, detects concurrent changes and no-ops, and cannot substitute a packet/reviewer",
  { timeout: 120000 },
  async () => {
    const c = await setup();
    let d = await c.owner(c.g.path);
    for (const call of [c.owner, c.person.call])
      d = await call(
        c.g.path + "/feedback",
        "POST",
        feedbackAction(d, { op: "decision", approved: true }),
      );
    d = await c.owner(c.g.path + "/review", "POST", finalReview(d));
    assert.equal(d.packet.canExport, true);
    const p = (await c.owner(c.g.path + "/planning?id=" + d.packet.id))
        .planning,
      { title: _, members: __, reviewers: ___, ...coordinates } = p;
    const input = {
      ...coordinates,
      op: "deadline",
      reviewerId: c.actor.id,
      dueDate: "2028-03-12",
    };
    const saved = await c.owner(c.g.path + "/feedback", "POST", input);
    assert.equal(saved.status, 200);
    assert.equal(saved.packet.canExport, true);
    assert.equal(saved.packet.reviewedAt, d.packet.reviewedAt);
    assert.deepEqual(
      saved.feedback.reviewers.map((r: any) => r.approvedAt),
      d.feedback.reviewers.map((r: any) => r.approvedAt),
    );
    assert.equal(
      (
        await c.owner(c.g.path + "/feedback", "POST", {
          ...input,
          dueDate: "2028-03-13",
        })
      ).status,
      409,
    );
    const noop = await c.owner(c.g.path + "/feedback", "POST", input);
    assert.equal(noop.reused, true);
    assert.equal(noop.feedback.version, saved.feedback.version);
    const fresh = feedbackAction(saved, {
      op: "deadline",
      reviewerId: randomUUID(),
      dueDate: null,
    });
    assert.equal(
      (await c.owner(c.g.path + "/feedback", "POST", fresh)).status,
      404,
    );
    assert.equal(
      (await c.owner(c.g.path + "/planning?id=" + randomUUID())).status,
      404,
    );
    assert.equal(
      (
        await c.owner(c.g.path + "/feedback", "POST", {
          ...input,
          id: randomUUID(),
        })
      ).status,
      404,
    );
  },
);
test(
  "readers see unified queues without scheduling authority; anonymous, foreign and strict route boundaries expose no cross-workspace work",
  { timeout: 120000 },
  async () => {
    const c = await setup();
    await c.local.db
      .prepare("UPDATE users SET role='viewer' WHERE id=?")
      .run(c.person.id);
    const r = await c.person.call(root);
    assert.equal(r.actions.canEdit, false);
    assert.equal(r.reviews.canEdit, false);
    assert.equal(r.actions.tasks.length, 3);
    assert.equal(r.reviews.packets.length, 1);
    assert.equal(
      (await c.person.call(c.g.path + "/planning?id=" + c.g.d.packet.id))
        .status,
      403,
    );
    assert.equal(
      (
        await c.person.call(
          c.g.path + "/feedback",
          "POST",
          feedbackAction(await c.owner(c.g.path), {
            op: "deadline",
            reviewerId: c.actor.id,
            dueDate: null,
          }),
        )
      ).status,
      403,
    );
    assert.equal((await (await client())(root)).status, 401);
    assert.equal(
      (await c.owner(root + "?workspaceId=" + c.actor.workspaceId)).status,
      400,
    );
    assert.equal((await c.owner(root, "POST", {})).status, 405);
    assert.equal((await c.owner(root + "/other")).status, 404);
    const foreign = await client();
    await foreign("auth/signup", "POST", {
      name: "Foreign planner",
      email: randomUUID() + "@example.test",
      password: "unified-test-password",
    });
    const other = await foreign(root);
    assert.deepEqual(other.actions.tasks, []);
    assert.deepEqual(other.reviews.packets, []);
    assert.equal(JSON.stringify(other).includes(c.g.collection.id), false);
  },
);
test(
  "departed reviewers remain explicitly unavailable without widening exact person scopes; source erasure clears both queues and rejects captured scheduling coordinates",
  { timeout: 120000 },
  async () => {
    const c = await setup(),
      planning = (await c.owner(c.g.path + "/planning?id=" + c.g.d.packet.id))
        .planning;
    await c.local.db
      .prepare("UPDATE users SET workspace_id=? WHERE id=?")
      .run(randomUUID(), c.person.id);
    let data = await c.owner(root),
      f = {
        ...state(c.g.collection.id),
        window: "week" as const,
        person: c.person.id,
      };
    const row = unifiedProjection(data, f, "2028-02-29").rows.find(
      (r) => r.kind === "review",
    );
    assert.ok(row && row.kind === "review");
    assert.equal(row.reviewer.available, false);
    assert.equal(row.personName, null);
    await c.owner(
      `studies/${c.imports[0].s.id}/responses/${c.imports[0].interviewId}`,
      "DELETE",
    );
    data = await c.owner(root);
    assert.equal(
      planningRows(data, state(c.g.collection.id), "2028-02-29", false).length,
      0,
    );
    const { title: _, members: __, reviewers: ___, ...coords } = planning;
    assert.equal(
      (
        await c.owner(c.g.path + "/feedback", "POST", {
          ...coords,
          op: "deadline",
          reviewerId: c.actor.id,
          dueDate: "2028-03-15",
        })
      ).status,
      404,
    );
  },
);
