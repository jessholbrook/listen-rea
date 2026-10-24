import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { start, stop } from "./harness";
import { client } from "./image-review-fixture";
import { inboxSetup, feedbackAction } from "./team-review-inbox-fixture";
import {
  loadOperations,
  operationsSummary,
  operationsLabels,
} from "../src/lib/research-operations";
import { defaultInboxFilters } from "../src/lib/team-review-inbox";
before(() => start({ port: 3406 }), { timeout: 90000 });
after(stop);
const read = (call: any) => async (path: string) => {
  const r = await call(path);
  if (r.status !== 200) throw new Error("Unavailable");
  return r;
};
test(
  "overview uses current full queues, excludes completed and today deadlines, counts packets rather than reviewers and preserves decisions/history",
  { timeout: 120000 },
  async () => {
    const c = await inboxSetup(),
      g = await c.create("Operations counts", [c.actor.id, c.person.id]);
    for (const reviewerId of [c.actor.id, c.person.id])
      g.d = await c.owner(
        g.path + "/feedback",
        "POST",
        feedbackAction(g.d, {
          op: "deadline",
          reviewerId,
          dueDate: "2028-02-27",
        }),
      );
    g.d = await c.owner(
      g.path + "/feedback",
      "POST",
      feedbackAction(g.d, {
        op: "comment",
        requestId: randomUUID(),
        body: "PRIVATE_OPERATION_COMMENT",
      }),
    );
    const tasks: any[] = [];
    for (const [status, dueDate] of [
      ["open", "2028-02-27"],
      ["in_progress", "2028-02-26"],
      ["completed", "2028-02-25"],
      ["open", "2028-02-28"],
      ["open", null],
    ]) {
      const r = await c.owner(
        `library/collections/${g.collection.id}/tasks`,
        "POST",
        {
          requestId: randomUUID(),
          title: "Operations task " + tasks.length,
          status,
          dueDate,
          assigneeId: c.actor.id,
          target: null,
        },
      );
      assert.equal(r.status, 201);
      tasks.push(r.task);
    }
    const before = await c.owner(g.path),
      history = await c.owner("library/review-activity");
    const data = await loadOperations(read(c.owner)),
      s = operationsSummary(data, "2028-02-28");
    assert.deepEqual(
      s.tasks.map((t) => t.id),
      [tasks[1].id, tasks[0].id],
    );
    assert.equal(s.overdue.length, 1);
    assert.equal(s.mine.length, 1);
    assert.equal(s.blocked.length, 1);
    assert.equal(s.ready.length, 0);
    assert.equal(operationsSummary(data, "2028-02-27").overdue.length, 0);
    assert.equal(
      JSON.stringify(data).includes("PRIVATE_OPERATION_COMMENT"),
      false,
    );
    assert.deepEqual(await c.owner(g.path), before);
    assert.deepEqual(await c.owner("library/review-activity"), history);
    g.d = await c.owner(g.path);
    g.d = await c.owner(
      g.path + "/feedback",
      "POST",
      feedbackAction(g.d, {
        op: "resolve",
        commentId: g.d.feedback.comments[0].id,
        resolved: true,
      }),
    );
    g.d = await c.owner(
      g.path + "/feedback",
      "POST",
      feedbackAction(g.d, { op: "decision", approved: true }),
    );
    const current = operationsSummary(
      await loadOperations(read(c.owner)),
      "2028-02-28",
    );
    assert.equal(current.mine.length, 0);
    assert.equal(current.overdue.length, 1);
  },
);
test(
  "overview catalog respects private/shared boundaries for readers, foreign workspaces and unauthenticated sessions",
  { timeout: 120000 },
  async () => {
    const c = await inboxSetup(),
      g = await c.create("Operations access", [c.actor.id]);
    for (const visibility of ["private", "shared"])
      await c.owner("library/saved-review-views", "POST", {
        name: "OWNER_" + visibility,
        visibility,
        config: { kind: "requests", filters: { ...defaultInboxFilters } },
      });
    await c.local.db
      .prepare("UPDATE users SET role='viewer' WHERE id=?")
      .run(c.person.id);
    const d = await loadOperations(read(c.person.call));
    assert.deepEqual(
      d.views.map((v) => v.name),
      ["OWNER_shared"],
    );
    assert.equal(d.inbox.canEdit, false);
    assert.equal(d.actions.canEdit, false);
    assert.equal(d.views[0].canManage, false);
    const anon = await client();
    await assert.rejects(loadOperations(read(anon)));
    const foreign = await client();
    await foreign("auth/signup", "POST", {
      name: "Other operations workspace",
      email: randomUUID() + "@example.test",
      password: "operations-test-password",
    });
    const f = await loadOperations(read(foreign));
    assert.equal(f.inbox.packets.length, 0);
    assert.equal(f.actions.tasks.length, 0);
    assert.equal(f.activity.events.length, 0);
    assert.equal(f.views.length, 0);
    assert.equal(JSON.stringify(f).includes(g.d.packet.id), false);
  },
);
test(
  "source erasure removes dashboard links/activity and linked tasks while presets retain exact unavailable scopes",
  { timeout: 120000 },
  async () => {
    const c = await inboxSetup(false),
      g = await c.create("Operations erasure");
    const t = await c.owner(
      `library/collections/${g.collection.id}/tasks`,
      "POST",
      {
        requestId: randomUUID(),
        title: "Linked operations task",
        assigneeId: null,
        dueDate: "2028-02-01",
        status: "open",
        target: { kind: "interview", id: c.imports[0].interviewId },
      },
    );
    assert.equal(t.status, 201);
    await c.owner("library/saved-review-views", "POST", {
      name: "Unavailable operations scope",
      visibility: "private",
      config: {
        kind: "requests",
        filters: {
          ...defaultInboxFilters,
          collectionId: g.collection.id,
          query: g.d.packet.title,
        },
      },
    });
    const before = await loadOperations(read(c.owner));
    assert.ok(before.inbox.packets.length);
    assert.ok(before.activity.events.length);
    await c.owner(
      `studies/${c.imports[0].s.id}/responses/${c.imports[0].interviewId}`,
      "DELETE",
    );
    const after = await loadOperations(read(c.owner));
    assert.equal(after.inbox.packets.length, 0);
    assert.equal(after.activity.events.length, 0);
    assert.equal(after.actions.tasks.length, 0);
    assert.equal(after.views[0].config.kind, "requests");
    const torn = operationsSummary(
      { ...before, inbox: after.inbox },
      "2028-02-28",
    );
    assert.equal(torn.activity.length, 0);
  },
);
test("a failed component rejects the complete overview, and all three languages expose the same controls", async () => {
  const seen: string[] = [];
  await assert.rejects(
    loadOperations(async (route) => {
      seen.push(route);
      if (route === "library/review-activity")
        throw new Error("Synthetic failed queue");
      return { views: [] };
    }),
    /Synthetic failed queue/,
  );
  assert.equal(seen.length, 4);
  const keys = Object.keys(operationsLabels.en).sort();
  for (const l of Object.values(operationsLabels)) {
    assert.deepEqual(Object.keys(l).sort(), keys);
    assert.ok(Object.values(l).every(Boolean));
  }
});
