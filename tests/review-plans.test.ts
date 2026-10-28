import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { start, stop } from "./harness";
import {
  inboxSetup,
  feedbackAction,
  finalReview,
  packetEdit,
} from "./team-review-inbox-fixture";
import { client } from "./image-review-fixture";
import { planDates, planLabels } from "../src/lib/review-plans";
before(() => start({ port: 3397 }), { timeout: 90000 });
after(stop);
const root = "library/review-plans";
const content = (id: string) => ({
  name: "Synthetic reusable review",
  reviewers: [{ id, days: 2 }],
});
const apply = (d: any, p: any, start = "2028-02-28") =>
  feedbackAction(d, {
    op: "plan",
    planId: p.id,
    planVersion: p.version,
    start,
    acknowledged: true,
  });
test("calendar patterns use real bounded calendar days across leap years and DST; all three languages expose the complete workflow", () => {
  const id = randomUUID();
  assert.deepEqual(
    planDates(
      [
        { id, days: 2 },
        { id: randomUUID(), days: null },
      ],
      "2028-02-28",
    ).map((v) => v.dueDate),
    ["2028-03-01", null],
  );
  assert.equal(
    planDates([{ id, days: 1 }], "2027-03-14")[0].dueDate,
    "2027-03-15",
  );
  for (const date of ["2027-02-29", "2028-13-01", "1999-12-31", "2101-01-01"])
    assert.throws(() => planDates([{ id, days: 0 }], date));
  assert.throws(() => planDates([{ id, days: 1 }], "2100-12-31"));
  for (const l of Object.values(planLabels))
    assert.deepEqual(Object.keys(l), Object.keys(planLabels.en));
});
test(
  "plan CRUD is workspace scoped, editor only, versioned, strictly validated and metadata only",
  { timeout: 120000 },
  async () => {
    const c = await inboxSetup(),
      v = content(c.person.id);
    let r = await c.owner(root, "POST", v);
    assert.equal(r.status, 200);
    const p = r.plan;
    assert.deepEqual(Object.keys(p).sort(), [
      "id",
      "name",
      "reviewers",
      "version",
    ]);
    const anon = await client(),
      foreign = await client();
    assert.equal((await anon(root)).status, 401);
    await foreign("auth/signup", "POST", {
      name: "Foreign plan user",
      email: randomUUID() + "@example.test",
      password: "foreign-plan-password",
    });
    assert.deepEqual((await foreign(root)).plans, []);
    assert.equal(
      (await foreign(root + "/" + p.id, "DELETE", { version: 1 })).status,
      404,
    );
    for (const extra of [
      { reviewers: [{ id: c.person.id, days: -1 }] },
      { reviewers: [{ id: c.person.id, days: 1.5 }] },
      { reviewers: [{ id: c.person.id, days: 366 }] },
      { reviewers: [] },
      {
        reviewers: [
          { id: c.person.id, days: 0 },
          { id: c.person.id, days: null },
        ],
      },
      { summary: "PRIVATE" },
    ])
      assert.equal(
        (await c.owner(root, "POST", { ...v, ...extra })).status,
        400,
      );
    assert.equal(
      (await c.owner(root, "POST", content(randomUUID()))).status,
      404,
    );
    assert.equal((await c.owner(root + "/extra/route")).status, 404);
    assert.equal((await c.owner(root, "PUT", v)).status, 405);
    await c.local.db
      .prepare("UPDATE users SET role='viewer' WHERE id=?")
      .run(c.person.id);
    assert.equal((await c.person.call(root)).status, 200);
    assert.equal((await c.person.call(root, "POST", v)).status, 403);
    assert.equal(
      (await c.person.call(root + "/" + p.id, "DELETE", { version: 1 })).status,
      403,
    );
    await c.local.db
      .prepare("UPDATE users SET role='researcher' WHERE id=?")
      .run(c.person.id);
    r = await c.owner(root + "/" + p.id, "PUT", {
      ...v,
      name: "Changed plan",
      version: 1,
    });
    assert.equal(r.plan.version, 2);
    assert.equal(
      (await c.owner(root + "/" + p.id, "PUT", { ...v, version: 1 })).status,
      409,
    );
    assert.equal(
      (await c.owner(root + "/" + p.id, "DELETE", { version: 1 })).status,
      409,
    );
    assert.equal(
      (await c.owner(root + "/" + p.id, "DELETE", { version: 2 })).status,
      200,
    );
    assert.equal(
      (await c.owner(root + "/" + p.id, "PUT", { ...v, version: 2 })).status,
      404,
    );
    assert.equal((await c.owner(root)).plans.length, 0);
  },
);
test(
  "applying a preview replaces requests and dates atomically, resets approvals, preserves comments, and rejects replay",
  { timeout: 120000 },
  async () => {
    const c = await inboxSetup(),
      g = await c.create("Plan application", [c.actor.id]);
    let d = g.d;
    d = await c.owner(
      g.path + "/feedback",
      "POST",
      feedbackAction(d, {
        op: "comment",
        requestId: randomUUID(),
        body: "PRIVATE_PLAN_COMMENT",
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
    d = await c.owner(g.path + "/review", "POST", finalReview(d));
    assert.ok(d.packet.reviewedAt);
    const p = (
      await c.owner(root, "POST", {
        name: "Team launch",
        reviewers: [
          { id: c.person.id, days: 2 },
          { id: c.actor.id, days: null },
        ],
      })
    ).plan;
    const action = apply(d, p);
    d = await c.owner(g.path + "/feedback", "POST", action);
    assert.equal(d.status, 200);
    assert.equal(d.packet.reviewedAt, null);
    assert.deepEqual(
      d.feedback.reviewers.map((v: any) => [v.id, v.dueDate, v.approvedAt]),
      [
        [c.person.id, "2028-03-01", null],
        [c.actor.id, null, null],
      ],
    );
    assert.equal(d.feedback.comments[0].body, "PRIVATE_PLAN_COMMENT");
    assert.ok(d.feedback.comments[0].resolvedAt);
    assert.equal(
      (await c.owner(g.path + "/feedback", "POST", action)).status,
      409,
    );
    assert.equal(
      (await c.owner(g.path + "/review", "POST", finalReview(d))).status,
      409,
    );
    // Deleting a template never undoes requests already copied to a packet.
    assert.equal(
      (await c.owner(root + "/" + p.id, "DELETE", { version: 1 })).status,
      200,
    );
    assert.deepEqual((await c.owner(g.path)).feedback, d.feedback);
    assert.equal(
      (await c.owner(g.path + "/feedback", "POST", apply(d, p))).status,
      404,
    );
  },
);
test(
  "preview application rejects stale plans, packet edits, unavailable members, missing acknowledgement and invalid dates without partial changes",
  { timeout: 120000 },
  async () => {
    const c = await inboxSetup(),
      g = await c.create("Plan preflight", [c.actor.id]);
    let d = g.d;
    const p = (await c.owner(root, "POST", content(c.person.id))).plan;
    const unchanged = async (action: any, status: number) => {
      const before = await c.owner(g.path);
      assert.equal(
        (await c.owner(g.path + "/feedback", "POST", action)).status,
        status,
      );
      const after = await c.owner(g.path);
      assert.deepEqual(after.feedback, before.feedback);
      assert.deepEqual(after.packet, before.packet);
    };
    await unchanged({ ...apply(d, p), acknowledged: false }, 400);
    await unchanged({ ...apply(d, p), start: "2027-02-29" }, 400);
    await unchanged(apply(d, p, "2100-12-31"), 400);
    await unchanged({ ...apply(d, p), reviewerIds: [c.actor.id] }, 400);
    await c.local.db
      .prepare("UPDATE users SET role='viewer' WHERE id=?")
      .run(c.person.id);
    await unchanged(apply(d, p), 409);
    await c.local.db
      .prepare("UPDATE users SET role='researcher' WHERE id=?")
      .run(c.person.id);
    const updated = (
      await c.owner(root + "/" + p.id, "PUT", {
        ...content(c.person.id),
        version: 1,
        name: "Updated preview",
      })
    ).plan;
    await unchanged(apply(d, p), 409);
    const old = d;
    d = await c.owner(
      g.path,
      "PUT",
      packetEdit(d, { summary: "Changed private packet contents" }),
    );
    await unchanged(apply(old, updated), 409);
    assert.equal(
      (await c.person.call(g.path + "/feedback", "POST", apply(d, updated)))
        .status,
      200,
    );
  },
);
test(
  "plans survive packet/source erasure as coordination metadata and cannot target a replacement packet generation",
  { timeout: 120000 },
  async () => {
    const c = await inboxSetup(false),
      g = await c.create("Reusable after deletion");
    const p = (await c.owner(root, "POST", content(c.actor.id))).plan;
    const old = apply(g.d, p);
    assert.equal(
      (
        await c.owner(g.path, "DELETE", {
          id: g.d.packet.id,
          version: g.d.packet.version,
        })
      ).status,
      200,
    );
    const replacement = await c.owner(g.path, "POST", {
      requestId: randomUUID(),
      title: "Replacement packet",
      summary: "New summary",
      language: "en",
      answerIds: [],
      taskIds: [],
    });
    assert.equal(replacement.status, 201);
    assert.equal(
      (await c.owner(g.path + "/feedback", "POST", old)).status,
      404,
    );
    const erased = await c.owner(
      `studies/${c.imports[0].s.id}/responses/${c.imports[0].interviewId}`,
      "DELETE",
    );
    assert.equal(erased.status, 200);
    assert.equal((await c.owner(g.path)).packet, null);
    assert.deepEqual((await c.owner(root)).plans, [p]);
  },
);
test(
  "workspace plan count is bounded while existing plans remain editable and removable",
  { timeout: 120000 },
  async () => {
    const c = await inboxSetup(false),
      v = content(c.actor.id),
      ids = Array.from({ length: 50 }, () => randomUUID());
    for (const id of ids)
      await c.local.put("libraryReviewPlan", {
        id,
        workspaceId: c.actor.workspaceId,
        version: 1,
        ...v,
      });
    assert.equal((await c.owner(root, "POST", v)).status, 409);
    assert.equal((await c.owner(root)).plans.length, 50);
    assert.equal(
      (await c.owner(root + "/" + ids[0], "PUT", { ...v, version: 1 })).status,
      200,
    );
    assert.equal(
      (await c.owner(root + "/" + ids[0], "DELETE", { version: 2 })).status,
      200,
    );
    assert.equal((await c.owner(root, "POST", v)).status, 200);
  },
);
