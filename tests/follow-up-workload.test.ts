import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import {
  followUpWorkload,
  workloadMetrics,
  workloadQueueFilters,
} from "../src/lib/follow-up-workload";
import {
  selectActionTasks,
  type ActionCenter,
  localCalendarDay,
} from "../src/lib/research-action-center";
import { start, stop } from "./harness";
import { inboxSetup } from "./team-review-inbox-fixture";
import { client } from "./image-review-fixture";
before(() => start({ port: 3414 }), { timeout: 90000 });
after(stop);
test("workload counts reconcile with exact queue drill-downs across intersecting scopes and local leap-day windows", () => {
  const data: ActionCenter = {
    tasks: [],
    members: [
      { id: "a", name: "Ada" },
      { id: "b", name: "Bo" },
      { id: "zero", name: "Zero" },
    ],
    collections: [
      { id: "alpha", title: "Alpha" },
      { id: "beta", title: "Beta" },
    ],
    userId: "a",
    canEdit: true,
  };
  for (const [i, dueDate] of [
    null,
    "2028-02-28",
    "2028-02-29",
    "2028-03-06",
    "2028-03-07",
  ].entries())
    for (const [j, status] of ["open", "in_progress", "completed"].entries())
      for (const assigneeId of ["a", "b", null, "departed"])
        data.tasks.push({
          id: `${i}-${j}-${assigneeId}`,
          collectionId: i % 2 ? "beta" : "alpha",
          workspaceId: "w",
          title: i % 2 ? "Other task" : "MATCH task",
          assigneeId,
          dueDate,
          status,
          createdAt: "2028-01-01",
          version: 1,
          target: null,
          source: null,
        } as any);
  const before = JSON.stringify(data);
  for (const scope of [
    { collectionId: "", query: "" },
    { collectionId: "alpha", query: "match" },
    { collectionId: "beta", query: "match" },
    { collectionId: "missing", query: "" },
  ])
    for (const today of ["2028-02-28", "2028-02-29", "2028-03-01"]) {
      const view = followUpWorkload(data, scope, today);
      for (const metric of workloadMetrics) {
        assert.equal(
          view.totals[metric],
          selectActionTasks(
            data,
            workloadQueueFilters(scope, "", metric),
            today,
          ).length,
        );
        assert.equal(
          view.rows.reduce((n, r) => n + r.counts[metric], 0),
          view.totals[metric],
        );
        for (const row of view.rows)
          assert.equal(
            row.counts[metric],
            selectActionTasks(
              data,
              workloadQueueFilters(scope, row.id, metric),
              today,
            ).length,
          );
      }
      assert.equal(view.rows.find((r) => r.id === "zero")!.counts.active, 0);
      assert.equal(view.rows.find((r) => r.id === "departed")!.name, "");
    }
  const leap = followUpWorkload(
    data,
    { collectionId: "", query: "" },
    "2028-02-29",
  );
  assert.equal(leap.totals.overdue, 8);
  assert.equal(leap.totals.today, 8);
  assert.equal(leap.totals.week, 16);
  assert.equal(leap.totals.undated, 8);
  assert.equal(leap.totals.completed, 20);
  assert.equal(JSON.stringify(data), before);
  assert.equal(localCalendarDay(new Date(2028, 1, 29, 23, 59)), "2028-02-29");
});
test("ordering is deterministic by overdue, unfinished, current name and ID, with a zero-work unassigned bucket", () => {
  const data: ActionCenter = {
    tasks: [],
    members: [
      { id: "b", name: "Same" },
      { id: "a", name: "Same" },
    ],
    collections: [],
    userId: "a",
    canEdit: false,
  };
  const view = followUpWorkload(
    data,
    { collectionId: "", query: "" },
    "2028-02-29",
  );
  assert.deepEqual(
    view.rows.map((r) => r.id),
    ["unassigned", "a", "b"],
  );
  assert.equal(view.totals.active, 0);
});
test(
  "current workspace projection supports readers without copied records or writes; task changes and source/assignee erasure refresh original counts",
  { timeout: 120000 },
  async () => {
    const c = await inboxSetup(),
      g = await c.create("Workload API scope");
    const task = (
      await c.owner(`library/collections/${g.collection.id}/tasks`, "POST", {
        requestId: randomUUID(),
        title: "Synthetic scoped workload",
        assigneeId: c.person.id,
        dueDate: "2028-02-28",
        status: "open",
        target: { kind: "interview", id: c.imports[0].interviewId },
      })
    ).task;
    const snap = await c.local.list("libraryTaskActivity", c.actor.workspaceId),
      taskSnap = await c.local.list(
        "libraryCollectionTask",
        c.actor.workspaceId,
      );
    const scope = { collectionId: g.collection.id, query: "scoped" };
    await c.local.db
      .prepare("UPDATE users SET role='viewer' WHERE id=?")
      .run(c.person.id);
    let data = await c.person.call("library/action-center");
    assert.equal(data.canEdit, false);
    let view = followUpWorkload(data, scope, "2028-02-29");
    assert.equal(view.totals.overdue, 1);
    assert.equal(view.rows.find((r) => r.id === c.person.id)!.counts.active, 1);
    assert.deepEqual(
      await c.local.list("libraryTaskActivity", c.actor.workspaceId),
      snap,
    );
    assert.deepEqual(
      await c.local.list("libraryCollectionTask", c.actor.workspaceId),
      taskSnap,
    );
    const foreign = await client();
    await foreign("auth/signup", "POST", {
      name: "Foreign",
      email: randomUUID() + "@example.test",
      password: "synthetic-foreign-password",
    });
    assert.equal(
      followUpWorkload(
        await foreign("library/action-center"),
        scope,
        "2028-02-29",
      ).totals.active,
      0,
    );
    assert.equal((await (await client())("library/action-center")).status, 401);
    await c.local.db
      .prepare("UPDATE users SET name='Current member name' WHERE id=?")
      .run(c.person.id);
    assert.equal(
      followUpWorkload(
        await c.owner("library/action-center"),
        scope,
        "2028-02-29",
      ).rows.find((r) => r.id === c.person.id)!.name,
      "Current member name",
    );
    await c.local.db
      .prepare("UPDATE users SET workspace_id=? WHERE id=?")
      .run(randomUUID(), c.person.id);
    view = followUpWorkload(
      await c.owner("library/action-center"),
      scope,
      "2028-02-29",
    );
    assert.equal(
      view.rows.some((r) => r.id === c.person.id),
      false,
    );
    assert.equal(
      view.rows.find((r) => r.id === "unassigned")!.counts.overdue,
      1,
    );
    const current = (
      await c.owner(`library/collections/${g.collection.id}/tasks`)
    ).tasks.find((t: any) => t.id === task.id);
    assert.equal(
      (
        await c.owner(
          `library/collections/${g.collection.id}/tasks/${task.id}`,
          "PUT",
          {
            version: current.version,
            title: current.title,
            assigneeId: null,
            dueDate: current.dueDate,
            status: "completed",
          },
        )
      ).status,
      200,
    );
    view = followUpWorkload(
      await c.owner("library/action-center"),
      scope,
      "2028-02-29",
    );
    assert.equal(view.totals.active, 0);
    assert.equal(view.totals.overdue, 0);
    assert.equal(view.totals.completed, 1);
    await c.owner(
      `studies/${c.imports[0].s.id}/responses/${c.imports[0].interviewId}`,
      "DELETE",
    );
    view = followUpWorkload(
      await c.owner("library/action-center"),
      scope,
      "2028-02-29",
    );
    assert.equal(view.totals.completed, 0);
    assert.equal(
      (await c.owner("library/action-center")).tasks.some(
        (t: any) => t.id === task.id,
      ),
      false,
    );
  },
);
