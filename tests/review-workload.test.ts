import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { start, stop } from "./harness";
import { client } from "./image-review-fixture";
import {
  feedbackAction,
  finalReview,
  packetEdit,
} from "./team-review-inbox-fixture";
import {
  workloadSetup,
  reassign,
  planningPath,
} from "./review-workload-fixture";
import {
  reviewWorkload,
  workloadRequests,
  defaultWorkloadFilters,
  workloadLabels,
} from "../src/lib/review-workload";
import type { ReviewInbox, InboxPacket } from "../src/lib/team-review-inbox";
before(
  () =>
    start({ port: process.env.RESEARCH_TEST_PRODUCTION === "1" ? 3395 : 3394 }),
  { timeout: 90000 },
);
after(stop);
const inbox = "library/review-inbox";
test(
  "assignment preparation is editor-only, scoped to the original generation, current and minimal without private text or approval side effects",
  { timeout: 120000 },
  async () => {
    const c = await workloadSetup(),
      g = await c.create("Synthetic workload metadata", [c.person.id]);
    const d = await c.owner(
      g.path + "/feedback",
      "POST",
      feedbackAction(g.d, {
        op: "comment",
        requestId: randomUUID(),
        body: "PRIVATE_WORKLOAD_COMMENT",
      }),
    );
    const stored = await c.local.get(
      "libraryHandoffFeedback",
      d.packet.id,
      c.actor.workspaceId,
    );
    let r = await c.owner(planningPath(g));
    assert.equal(r.status, 200);
    assert.equal(r.planning.id, d.packet.id);
    assert.equal(r.planning.version, d.feedback.version);
    assert.equal(r.planning.signature, d.signature);
    assert.equal(r.planning.members.length, 3);
    for (const key of [
      "PRIVATE_",
      "workspaceId",
      "summary",
      "preview",
      "inputHash",
      "requestId",
      "authorId",
      "comments",
      "transcript",
      "email",
      "password",
      "tombstones",
    ])
      assert.equal(JSON.stringify(r).includes(key), false, key);
    assert.deepEqual(
      await c.local.get(
        "libraryHandoffFeedback",
        d.packet.id,
        c.actor.workspaceId,
      ),
      stored,
    );
    assert.equal((await c.owner(inbox)).canEdit, true);
    const anon = await client(),
      foreign = await client();
    assert.equal((await anon(planningPath(g))).status, 401);
    await foreign("auth/signup", "POST", {
      name: "Foreign workload",
      email: randomUUID() + "@example.test",
      password: "foreign-workload-password",
    });
    assert.equal((await foreign(planningPath(g))).status, 404);
    assert.equal((await c.owner(planningPath(g), "POST", {})).status, 405);
    assert.equal((await c.owner(planningPath(g) + "&extra=1")).status, 400);
    assert.equal((await c.owner(g.path + "/planning")).status, 400);
    assert.equal((await c.owner(planningPath(g, randomUUID()))).status, 404);
    await c.local.db
      .prepare("UPDATE users SET role='viewer' WHERE id=?")
      .run(c.person.id);
    assert.equal((await c.person.call(inbox)).canEdit, false);
    assert.equal((await c.person.call(planningPath(g))).status, 403);
  },
);
test(
  "reassignment moves one pending request and its due date, preserves comments/other dates, resets decisions and requires the replacement's own approval",
  { timeout: 120000 },
  async () => {
    const c = await workloadSetup(),
      g = await c.create("Synthetic workload transfer", [
        c.actor.id,
        c.person.id,
      ]);
    let d = g.d;
    for (const [reviewerId, dueDate] of [
      [c.actor.id, "2028-03-01"],
      [c.person.id, "2028-02-27"],
    ])
      d = await c.owner(
        g.path + "/feedback",
        "POST",
        feedbackAction(d, { op: "deadline", reviewerId, dueDate }),
      );
    d = await c.person.call(
      g.path + "/feedback",
      "POST",
      feedbackAction(d, {
        op: "comment",
        requestId: randomUUID(),
        body: "KEEP_WORKLOAD_COMMENT",
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
    const p = (await c.owner(planningPath(g))).planning,
      request = reassign(p, c.person.id, c.replacement.id);
    d = await c.owner(g.path + "/feedback", "POST", request);
    assert.equal(d.status, 200);
    assert.deepEqual(
      d.feedback.reviewers.map((r: any) => r.id),
      [c.actor.id, c.replacement.id],
    );
    assert.ok(d.feedback.reviewers.every((r: any) => !r.approvedAt));
    assert.equal(d.packet.canExport, false);
    assert.equal(d.feedback.reviewers[0].dueDate, "2028-03-01");
    assert.equal(d.feedback.reviewers[1].dueDate, "2028-02-27");
    assert.equal(d.feedback.comments[0].body, "KEEP_WORKLOAD_COMMENT");
    assert.ok(d.feedback.comments[0].resolvedAt);
    assert.equal(
      (await c.owner(g.path + "/feedback", "POST", request)).status,
      409,
    );
    const stored = await c.local.get<any>(
      "libraryHandoffFeedback",
      d.packet.id,
      c.actor.workspaceId,
    );
    assert.equal(
      stored.deadlines.some((r: any) => r.userId === c.person.id),
      false,
    );
    const data = await c.owner(inbox),
      rows = reviewWorkload(data, { ...defaultWorkloadFilters }, "2028-02-28");
    assert.equal(rows.find((r) => r.id === c.person.id)?.pending, 0);
    assert.equal(rows.find((r) => r.id === c.replacement.id)?.overdue, 1);
    assert.equal(rows.find((r) => r.id === c.actor.id)?.pending, 1);
    assert.equal(
      (
        await c.person.call(
          g.path + "/feedback",
          "POST",
          feedbackAction(d, { op: "decision", approved: true }),
        )
      ).status,
      403,
    );
    d = await c.owner(
      g.path + "/feedback",
      "POST",
      feedbackAction(d, { op: "decision", approved: true }),
    );
    assert.equal(d.feedback.ready, false);
    d = await c.replacement.call(
      g.path + "/feedback",
      "POST",
      feedbackAction(d, { op: "decision", approved: true }),
    );
    assert.equal(d.feedback.ready, true);
    d = await c.owner(g.path + "/review", "POST", finalReview(d));
    assert.equal(d.packet.canExport, true);
  },
);
test(
  "atomic reassignment rejects merging, completed/unknown requests, unavailable targets, forged fields and stale versions; concurrent plans cannot replace the same request twice",
  { timeout: 120000 },
  async () => {
    const c = await workloadSetup(),
      g = await c.create("Synthetic workload conflicts", [c.person.id]);
    let p = (await c.owner(planningPath(g))).planning;
    const base = reassign(p, c.person.id, c.replacement.id);
    assert.equal(
      (
        await c.owner(g.path + "/feedback", "POST", {
          ...base,
          fromReviewerId: randomUUID(),
        })
      ).status,
      404,
    );
    assert.equal(
      (
        await c.owner(g.path + "/feedback", "POST", {
          ...base,
          toReviewerId: c.person.id,
        })
      ).status,
      400,
    );
    assert.equal(
      (
        await c.owner(g.path + "/feedback", "POST", {
          ...base,
          toReviewerId: randomUUID(),
        })
      ).status,
      404,
    );
    assert.equal(
      (await c.owner(g.path + "/feedback", "POST", { ...base, approved: true }))
        .status,
      400,
    );
    assert.equal(
      (await c.owner(g.path + "/feedback", "POST", { ...base, version: 999 }))
        .status,
      409,
    );
    assert.equal(
      (
        await c.owner(g.path + "/feedback", "POST", {
          ...base,
          signature: "0".repeat(64),
        })
      ).status,
      409,
    );
    await c.local.db
      .prepare("UPDATE users SET role='viewer' WHERE id=?")
      .run(c.replacement.id);
    assert.equal(
      (await c.owner(g.path + "/feedback", "POST", base)).status,
      404,
    );
    await c.local.db
      .prepare("UPDATE users SET role='collaborator' WHERE id=?")
      .run(c.replacement.id);
    const results = await Promise.all([
      c.owner(g.path + "/feedback", "POST", base),
      c.replacement.call(
        g.path + "/feedback",
        "POST",
        reassign(p, c.person.id, c.actor.id),
      ),
    ]);
    assert.deepEqual(results.map((r) => r.status).sort(), [200, 409]);
    let d = await c.owner(g.path);
    d = await c.owner(
      g.path + "/feedback",
      "POST",
      feedbackAction(d, {
        op: "assign",
        reviewerIds: [c.person.id, c.actor.id],
      }),
    );
    p = (await c.owner(planningPath(g))).planning;
    assert.equal(
      (
        await c.owner(
          g.path + "/feedback",
          "POST",
          reassign(p, c.person.id, c.actor.id),
        )
      ).status,
      409,
    );
    d = await c.person.call(
      g.path + "/feedback",
      "POST",
      feedbackAction(d, { op: "decision", approved: true }),
    );
    p = (await c.owner(planningPath(g))).planning;
    assert.equal(
      (
        await c.owner(
          g.path + "/feedback",
          "POST",
          reassign(p, c.person.id, c.replacement.id),
        )
      ).status,
      409,
    );
  },
);
test(
  "unavailable source requests can move to an editor while stale context/generations and source/collection/orphan erasure cannot revive assignments",
  { timeout: 120000 },
  async () => {
    const c = await workloadSetup(),
      g = await c.create("Synthetic absent reviewer", [c.person.id]);
    let d = await c.owner(
      g.path + "/feedback",
      "POST",
      feedbackAction(g.d, {
        op: "deadline",
        reviewerId: c.person.id,
        dueDate: "2028-02-27",
      }),
    );
    await c.local.db
      .prepare("UPDATE users SET workspace_id=? WHERE id=?")
      .run(randomUUID(), c.person.id);
    let p = (await c.owner(planningPath(g))).planning;
    assert.equal(p.reviewers[0].available, false);
    assert.equal(p.reviewers[0].name, null);
    d = await c.owner(
      g.path + "/feedback",
      "POST",
      reassign(p, c.person.id, c.replacement.id),
    );
    assert.equal(d.status, 200);
    assert.equal(d.feedback.reviewers[0].dueDate, "2028-02-27");
    p = (await c.owner(planningPath(g))).planning;
    d = await c.owner(
      g.path,
      "PUT",
      packetEdit(d, { summary: "CHANGED_WORKLOAD_CONTEXT" }),
    );
    assert.equal(
      (
        await c.owner(
          g.path + "/feedback",
          "POST",
          reassign(p, c.replacement.id, c.actor.id),
        )
      ).status,
      409,
    );
    p = (await c.owner(planningPath(g))).planning;
    await c.owner(g.path, "DELETE", {
      id: d.packet.id,
      version: d.packet.version,
    });
    const newPacket = await c.owner(g.path, "POST", {
      requestId: randomUUID(),
      title: "Synthetic replacement workload",
      summary: "New generation",
      language: "en",
      answerIds: [],
      taskIds: [],
    });
    assert.equal(newPacket.status, 201);
    assert.equal((await c.owner(planningPath(g))).status, 404);
    assert.equal(
      (
        await c.owner(
          g.path + "/feedback",
          "POST",
          reassign(p, c.replacement.id, c.actor.id),
        )
      ).status,
      404,
    );
    for (const mode of ["collection", "orphan", "source"]) {
      const h = await c.create("Synthetic workload erasure " + mode, [
        c.replacement.id,
      ]);
      const plan = (await c.owner(planningPath(h))).planning;
      if (mode === "collection")
        await c.owner("library/collections/" + h.collection.id, "DELETE", {
          version: h.collection.version,
        });
      if (mode === "orphan")
        await c.local.db
          .prepare(
            "DELETE FROM documents WHERE kind='libraryCollectionHandoff' AND id=? AND workspace_id=?",
          )
          .run(h.d.packet.id, c.actor.workspaceId);
      if (mode === "source")
        await c.owner(
          `studies/${c.imports[0].s.id}/responses/${c.imports[0].interviewId}`,
          "DELETE",
        );
      assert.equal(
        (
          await c.owner(
            h.path + "/feedback",
            "POST",
            reassign(plan, c.replacement.id, c.actor.id),
          )
        ).status,
        404,
      );
      assert.equal(
        await c.local.get(
          "libraryHandoffFeedback",
          h.d.packet.id,
          c.actor.workspaceId,
        ),
        undefined,
      );
    }
  },
);
test("workload counts requests per person including idle and unavailable members, scopes counts to collections/titles, and sorts overdue/pending work deterministically", () => {
  const r = (
    id: string,
    dueDate: string | null,
    approvedAt: string | null = null,
    available = true,
  ) => ({ id, name: available ? id : null, available, dueDate, approvedAt });
  const p = (id: string, reviewers: any[], extra: any = {}): InboxPacket => ({
    id,
    collectionId: "alpha",
    collectionTitle: "Alpha",
    title: "Packet " + id,
    version: 1,
    updatedAt: "2028-02-28T00:00:00Z",
    openComments: 0,
    state: "awaiting",
    reviewers,
    ...extra,
  });
  const data: ReviewInbox = {
    userId: "a",
    members: [
      { id: "a", name: "A" },
      { id: "b", name: "B" },
      { id: "idle", name: "Idle" },
    ],
    collections: [],
    packets: [
      p("1", [r("a", "2028-02-27"), r("b", "2028-02-28")], {
        state: "blocked",
      }),
      p("2", [r("a", null), r("b", "2028-02-25", "stamp")]),
      p("3", [r("gone", "2028-02-26", null, false)], { collectionId: "beta" }),
      p("4", [r("a", "2028-03-05")]),
    ],
  };
  const rows = reviewWorkload(
      data,
      { ...defaultWorkloadFilters },
      "2028-02-28",
    ),
    a = rows.find((m) => m.id === "a")!,
    b = rows.find((m) => m.id === "b")!;
  assert.deepEqual(
    rows.map((r) => r.id),
    ["a", "gone", "b", "idle"],
  );
  assert.deepEqual(
    [a.pending, a.overdue, a.today, a.week, a.undated, a.blocked, a.approved],
    [3, 1, 0, 1, 1, 1, 0],
  );
  assert.deepEqual(
    [b.pending, b.overdue, b.today, b.week, b.undated, b.blocked, b.approved],
    [1, 0, 1, 1, 0, 1, 1],
  );
  assert.equal(rows.find((m) => m.id === "gone")?.available, false);
  assert.equal(
    reviewWorkload(
      data,
      { collectionId: "alpha", query: "Packet 1", load: "pending" },
      "2028-02-28",
    ).length,
    2,
  );
  assert.deepEqual(
    reviewWorkload(
      data,
      { ...defaultWorkloadFilters, load: "overdue" },
      "2028-02-28",
    ).map((m) => m.id),
    ["a", "gone"],
  );
  assert.ok(
    reviewWorkload(
      data,
      { ...defaultWorkloadFilters, collectionId: "removed" },
      "2028-02-28",
    ).every((m) => m.pending === 0 && m.approved === 0),
  );
  assert.deepEqual(
    workloadRequests(data, { ...defaultWorkloadFilters }, "b").map((p) => p.id),
    ["1"],
  );
  assert.deepEqual(
    workloadRequests(data, { ...defaultWorkloadFilters }, "a").map((p) => p.id),
    ["1", "4", "2"],
  );
  assert.deepEqual(
    workloadRequests(
      data,
      { ...defaultWorkloadFilters, collectionId: "removed" },
      "a",
    ),
    [],
  );
});
test("local-day workload changes distinguish due today, overdue and approved reviews without altering request records", () => {
  const data: ReviewInbox = {
    userId: "a",
    members: [{ id: "a", name: "A" }],
    collections: [],
    packets: [
      {
        id: "p",
        collectionId: "c",
        collectionTitle: "C",
        title: "Packet",
        version: 1,
        updatedAt: "2028-03-11T00:00:00Z",
        openComments: 0,
        state: "awaiting",
        reviewers: [
          {
            id: "a",
            name: "A",
            available: true,
            approvedAt: null,
            dueDate: "2028-03-11",
          },
        ],
      },
    ],
  };
  const original = structuredClone(data);
  assert.equal(
    reviewWorkload(data, { ...defaultWorkloadFilters }, "2028-03-11")[0].today,
    1,
  );
  assert.equal(
    reviewWorkload(data, { ...defaultWorkloadFilters }, "2028-03-12")[0]
      .overdue,
    1,
  );
  assert.deepEqual(data, original);
  data.packets[0].reviewers[0].approvedAt = "approved";
  const m = reviewWorkload(
    data,
    { ...defaultWorkloadFilters },
    "2028-03-12",
  )[0];
  assert.equal(m.overdue, 0);
  assert.equal(m.approved, 1);
  assert.equal(m.pending, 0);
  for (const lang of ["es", "fr"] as const)
    assert.deepEqual(
      Object.keys(workloadLabels[lang]).sort(),
      Object.keys(workloadLabels.en).sort(),
    );
});
