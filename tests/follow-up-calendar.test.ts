import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { start, stop } from "./harness";
import { inboxSetup } from "./team-review-inbox-fixture";
import {
  calendarMonth,
  moveCalendarMonth,
  initialCalendarState,
  calendarProjection,
  calendarDateLabel,
} from "../src/lib/follow-up-calendar";
import type { ActionCenter } from "../src/lib/research-action-center";
before(() => start({ port: 3422 }), { timeout: 90000 });
after(stop);
test("calendar arithmetic handles leap years, year edges, Monday offsets and stable date-only labels across DST", () => {
  assert.equal(calendarMonth("2028-02").days.length, 29);
  assert.equal(calendarMonth("2100-02").days.length, 28);
  assert.equal(calendarMonth("2028-02").offset, 1);
  assert.equal(calendarMonth("2028-05").offset, 0);
  assert.equal(moveCalendarMonth("2028-12", 1), "2029-01");
  assert.equal(moveCalendarMonth("2028-01", -1), "2027-12");
  assert.equal(calendarDateLabel("2028-03-12", "en"), "March 12, 2028");
  assert.equal(calendarDateLabel("2028-02-29", "fr"), "29 février 2028");
  assert.equal(calendarDateLabel("2028-02-29", "es"), "29 de febrero de 2028");
});
async function fixture() {
  const c = await inboxSetup(),
    g = await c.create("Calendar collection"),
    other = await c.create("Other calendar collection"),
    tasks = [];
  for (const [collectionId, assigneeId, status, dueDate] of [
    [g.collection.id, c.actor.id, "open", "2028-02-28"],
    [g.collection.id, c.person.id, "in_progress", "2028-02-29"],
    [g.collection.id, null, "open", "2028-03-06"],
    [g.collection.id, null, "open", "2028-03-07"],
    [g.collection.id, null, "open", null],
    [g.collection.id, c.actor.id, "completed", "2028-02-29"],
    [other.collection.id, c.actor.id, "open", "2028-02-29"],
  ]) {
    const r = await c.owner(
      `library/collections/${collectionId}/tasks`,
      "POST",
      {
        requestId: randomUUID(),
        title: "Calendar task " + tasks.length,
        assigneeId,
        status,
        dueDate,
        target: { kind: "interview", id: c.imports[0].interviewId },
      },
    );
    assert.equal(r.status, 201);
    tasks.push(r.task);
  }
  return { ...c, g, tasks };
}
test(
  "month/day and unfinished priority windows retain original scope, assignment, title and completion semantics",
  { timeout: 120000 },
  async () => {
    const c = await fixture(),
      data: ActionCenter = await c.owner("library/action-center"),
      state = {
        ...initialCalendarState("2028-02-29"),
        collectionId: c.g.collection.id,
      };
    const ids = (v: any) => v.rows.map((t: any) => t.id);
    let p = calendarProjection(data, state, "2028-02-29");
    assert.deepEqual(
      ids(p),
      c.tasks.slice(0, 2).map((t) => t.id),
    );
    assert.equal(p.counts["2028-02-29"], 1);
    assert.deepEqual(p.priorities, {
      overdue: 1,
      today: 1,
      week: 2,
      undated: 1,
    });
    assert.deepEqual(
      ids(
        calendarProjection(data, { ...state, day: "2028-02-29" }, "2028-02-29"),
      ),
      [c.tasks[1].id],
    );
    p = calendarProjection(data, { ...state, status: "all" }, "2028-02-29");
    assert.equal(p.counts["2028-02-29"], 2);
    assert.equal(p.priorities.today, 1);
    assert.deepEqual(
      ids(calendarProjection(data, { ...state, window: "week" }, "2028-02-29")),
      [c.tasks[1].id, c.tasks[2].id],
    );
    assert.deepEqual(
      ids(
        calendarProjection(
          data,
          {
            ...state,
            window: "undated",
            assignee: "unassigned",
            query: " task 4 ",
          },
          "2028-02-29",
        ),
      ),
      [c.tasks[4].id],
    );
    assert.deepEqual(
      ids(
        calendarProjection(data, { ...state, assignee: "mine" }, "2028-02-29"),
      ),
      [c.tasks[0].id],
    );
    assert.equal(
      calendarProjection(data, state, "2028-03-01").priorities.overdue,
      2,
    );
    assert.equal(
      calendarProjection(
        data,
        { ...state, collectionId: randomUUID() },
        "2028-02-29",
      ).rows.length,
      0,
    );
  },
);
test(
  "date-only preview/apply preserve assignment and progress, no-op versions, and isolate stale task versions",
  { timeout: 120000 },
  async () => {
    const c = await fixture(),
      tasks = c.tasks.slice(0, 2),
      target = (t: any) => ({
        id: t.id,
        collectionId: t.collectionId,
        version: t.version,
      }),
      root = "library/operations-triage/",
      changes = {
        assignee: { mode: "keep" },
        dueDate: { mode: "set", date: "2028-03-12" },
      };
    const snapshot = await c.local.list(
      "libraryTaskActivity",
      c.actor.workspaceId,
    );
    let p = await c.owner(root + "preview", "POST", {
      changes,
      tasks: tasks.map(target),
    });
    assert.deepEqual(
      p.tasks.map((t: any) => t.status),
      ["ready", "ready"],
    );
    assert.deepEqual(
      await c.local.list("libraryTaskActivity", c.actor.workspaceId),
      snapshot,
    );
    const concurrent = await c.owner(
      `library/collections/${tasks[1].collectionId}/tasks/${tasks[1].id}`,
      "PUT",
      {
        version: tasks[1].version,
        title: tasks[1].title,
        assigneeId: tasks[1].assigneeId,
        status: tasks[1].status,
        dueDate: "2028-03-14",
      },
    );
    assert.equal(concurrent.status, 200);
    p = await c.owner(root + "apply", "POST", {
      changes,
      acknowledged: true,
      tasks: tasks.map(target),
    });
    assert.deepEqual(
      p.tasks.map((t: any) => t.status),
      ["applied", "conflict"],
    );
    const current = await c.owner("library/action-center"),
      saved = current.tasks.find((t: any) => t.id === tasks[0].id);
    assert.equal(saved.dueDate, "2028-03-12");
    for (const key of [
      "title",
      "assigneeId",
      "status",
      "completedAt",
      "target",
    ])
      assert.deepEqual(saved[key], tasks[0][key]);
    const noOp = await c.owner(root + "apply", "POST", {
      changes,
      acknowledged: true,
      tasks: [target(saved)],
    });
    assert.equal(noOp.tasks[0].status, "unchanged");
    assert.equal(noOp.tasks[0].version, saved.version);
    const cleared = await c.owner(root + "apply", "POST", {
      changes: { assignee: { mode: "keep" }, dueDate: { mode: "clear" } },
      acknowledged: true,
      tasks: [target(saved)],
    });
    assert.equal(cleared.tasks[0].status, "applied");
    assert.equal(cleared.tasks[0].after.dueDate, null);
    assert.equal(cleared.tasks[0].after.assignee.id, c.actor.id);
  },
);
test(
  "calendar readers see current tasks without write authority, and source erasure removes calendar counts and rejects stale rescheduling",
  { timeout: 120000 },
  async () => {
    const c = await fixture();
    await c.local.db
      .prepare("UPDATE users SET role='viewer' WHERE id=?")
      .run(c.person.id);
    let data = await c.person.call("library/action-center");
    assert.equal(data.canEdit, false);
    const state = {
      ...initialCalendarState("2028-02-29"),
      collectionId: c.g.collection.id,
    };
    assert.equal(calendarProjection(data, state, "2028-02-29").rows.length, 2);
    const t = c.tasks[0],
      input = {
        changes: { assignee: { mode: "keep" }, dueDate: { mode: "clear" } },
        tasks: [{ id: t.id, collectionId: t.collectionId, version: t.version }],
      };
    assert.equal(
      (await c.person.call("library/operations-triage/preview", "POST", input))
        .status,
      403,
    );
    await c.owner(
      `studies/${c.imports[0].s.id}/responses/${c.imports[0].interviewId}`,
      "DELETE",
    );
    data = await c.person.call("library/action-center");
    assert.equal(calendarProjection(data, state, "2028-02-29").rows.length, 0);
    assert.deepEqual(calendarProjection(data, state, "2028-02-29").priorities, {
      overdue: 0,
      today: 0,
      week: 0,
      undated: 0,
    });
    const r = await c.owner("library/operations-triage/apply", "POST", {
      ...input,
      acknowledged: true,
    });
    assert.equal(r.tasks[0].status, "unavailable");
  },
);
