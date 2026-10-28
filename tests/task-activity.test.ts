import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { start, stop } from "./harness";
import { client } from "./image-review-fixture";
import { inboxSetup } from "./team-review-inbox-fixture";
import { taskActivityLabels } from "../src/lib/task-activity";
before(() => start({ port: 3410 }), { timeout: 90000 });
after(stop);
const route = "library/task-activity",
  query = (v: any) => route + "?" + new URLSearchParams(v);
async function setup() {
  const c = await inboxSetup(),
    g = await c.create("Follow-up history collection");
  const root = `library/collections/${g.collection.id}/tasks`,
    input = {
      requestId: randomUUID(),
      title: "PRIVATE_OLD_TASK_TITLE",
      assigneeId: c.actor.id,
      dueDate: "2028-02-27",
      status: "open",
      target: { kind: "interview", id: c.imports[0].interviewId },
    };
  const t = (await c.owner(root, "POST", input)).task;
  const edit = (t: any, extra: any = {}, call = c.owner) =>
    call(root + "/" + t.id, "PUT", {
      version: t.version,
      title: t.title,
      assigneeId: t.assigneeId,
      dueDate: t.dueDate,
      status: t.status,
      ...extra,
    });
  const history = () => c.owner(query({ taskId: t.id }));
  return { ...c, g, root, input, t, edit, history };
}
test(
  "creation and successful edits record exact actors and coordination before/after; no-ops, retries and rejected conflicts add no events or copied text",
  { timeout: 120000 },
  async () => {
    const c = await setup();
    let log = await c.history();
    assert.equal(log.total, 1);
    assert.equal(log.events[0].action, "task_created");
    assert.equal(log.events[0].actor.id, c.actor.id);
    assert.equal(log.events[0].before, null);
    assert.equal((await c.owner(c.root, "POST", c.input)).reused, true);
    assert.equal((await c.edit(c.t)).reused, true);
    assert.equal((await c.history()).total, 1);
    let r = await c.edit(
      c.t,
      {
        assigneeId: c.person.id,
        dueDate: "2028-02-29",
        status: "completed",
        title: "PRIVATE_NEW_TASK_TITLE",
      },
      c.person.call,
    );
    assert.equal(r.status, 200);
    assert.equal(r.task.completedAt !== null, true);
    log = await c.history();
    const e = log.events[0];
    assert.equal(e.actor.id, c.person.id);
    assert.equal(e.before.status, "open");
    assert.equal(e.after.status, "completed");
    assert.equal(e.before.assignee.id, c.actor.id);
    assert.equal(e.after.assignee.id, c.person.id);
    assert.equal(e.after.dueDate, "2028-02-29");
    assert.equal(e.titleChanged, true);
    assert.equal(e.task.title, "PRIVATE_NEW_TASK_TITLE");
    assert.equal((await c.edit(c.t, { dueDate: "2028-03-10" })).status, 409);
    assert.equal((await c.history()).total, 2);
    r = await c.edit(r.task, { status: "open" });
    assert.equal(r.task.completedAt, null);
    assert.equal((await c.history()).events[0].before.status, "completed");
    const stored = await c.local.get<any>(
      "libraryTaskActivity",
      c.t.id,
      c.actor.workspaceId,
    );
    for (const marker of [
      "PRIVATE_OLD_TASK_TITLE",
      "PRIVATE_NEW_TASK_TITLE",
      c.person.name,
      c.actor.name,
      "transcript",
      "summary",
      "target",
      "requestId",
      "inputHash",
    ])
      assert.equal(JSON.stringify(stored).includes(marker), false, marker);
    for (const marker of [
      "workspaceId",
      "requestId",
      "inputHash",
      "transcript",
      "PRIVATE_OLD_TASK_TITLE",
    ])
      assert.equal(JSON.stringify(log).includes(marker), false, marker);
    const before = await c.owner(c.g.path),
      stable = await c.history();
    assert.deepEqual(await c.history(), stable);
    assert.deepEqual(await c.owner(c.g.path), before);
  },
);
test(
  "triage records only successful changed tasks with the caller; stale rows, previews, unchanged edits and replay stay silent",
  { timeout: 120000 },
  async () => {
    const c = await setup(),
      t2 = (
        await c.owner(c.root, "POST", {
          ...c.input,
          requestId: randomUUID(),
          title: "Second follow-up",
        })
      ).task,
      target = (t: any) => ({
        id: t.id,
        collectionId: t.collectionId,
        version: t.version,
      }),
      changes = {
        assignee: { mode: "clear" },
        dueDate: { mode: "set", date: "2028-02-29" },
      },
      input = {
        changes,
        tasks: [target(c.t), { ...target(t2), version: 999 }],
      };
    await c.owner("library/operations-triage/preview", "POST", input);
    assert.equal((await c.history()).total, 1);
    const r = await c.person.call("library/operations-triage/apply", "POST", {
      ...input,
      acknowledged: true,
    });
    assert.deepEqual(
      r.tasks.map((t: any) => t.status),
      ["applied", "conflict"],
    );
    let log = await c.history();
    assert.equal(log.total, 2);
    assert.equal(log.events[0].action, "task_triaged");
    assert.equal(log.events[0].actor.id, c.person.id);
    assert.equal(log.events[0].after.assignee, null);
    await c.owner("library/operations-triage/apply", "POST", {
      ...input,
      acknowledged: true,
    });
    assert.equal((await c.history()).total, 2);
    await c.owner("library/operations-triage/apply", "POST", {
      changes,
      tasks: [{ ...target(c.t), version: 2 }],
      acknowledged: true,
    });
    assert.equal((await c.history()).total, 2);
    assert.equal((await c.owner(query({ taskId: t2.id }))).total, 1);
  },
);
test(
  "departed assignees are cleared once with an automatic actor and prior people are masked or resolved from current names",
  { timeout: 120000 },
  async () => {
    const c = await setup(),
      r = await c.edit(c.t, { assigneeId: c.person.id }, c.person.call);
    await c.local.db
      .prepare("UPDATE users SET name='Current follow-up reviewer' WHERE id=?")
      .run(c.person.id);
    let log = await c.history();
    assert.equal(log.events[0].actor.name, "Current follow-up reviewer");
    assert.equal(
      log.events[0].after.assignee.name,
      "Current follow-up reviewer",
    );
    await c.local.db
      .prepare("UPDATE users SET workspace_id=? WHERE id=?")
      .run(randomUUID(), c.person.id);
    log = await c.history();
    assert.equal(log.events[0].action, "assignee_unavailable");
    assert.equal(log.events[0].actor, null);
    assert.equal(log.events[0].before.assignee.id, c.person.id);
    assert.equal(log.events[0].before.assignee.name, null);
    assert.equal(log.events[0].after.assignee, null);
    assert.equal(log.events[1].actor.name, null);
    assert.equal(log.events[0].taskVersion, r.task.version + 1);
    assert.deepEqual(await c.history(), log);
    assert.equal(
      (await c.owner(query({ personId: "system", taskId: c.t.id }))).total,
      1,
    );
    assert.equal(
      (await c.owner(query({ personId: c.person.id, taskId: c.t.id }))).total,
      2,
    );
    await c.local.db
      .prepare("UPDATE users SET workspace_id=? WHERE id=?")
      .run(c.actor.workspaceId, c.person.id);
    assert.equal(
      (await c.owner(c.root)).tasks.find((t: any) => t.id === c.t.id)
        .assigneeId,
      null,
    );
  },
);
test(
  "workspace readers can inspect but not mutate history; foreign/anonymous, strict parameters and stale actor membership are enforced",
  { timeout: 120000 },
  async () => {
    const c = await setup(),
      anon = await client();
    assert.equal((await anon(route)).status, 401);
    await c.local.db
      .prepare("UPDATE users SET role='viewer' WHERE id=?")
      .run(c.person.id);
    assert.equal((await c.person.call(query({ taskId: c.t.id }))).total, 1);
    assert.equal((await c.person.call(route, "POST", {})).status, 405);
    assert.equal(
      (
        await c.person.call(c.root + "/" + c.t.id, "PUT", {
          version: 1,
          title: c.t.title,
          assigneeId: null,
          dueDate: null,
          status: "open",
        })
      ).status,
      403,
    );
    const f = await client();
    await f("auth/signup", "POST", {
      name: "Foreign task history",
      email: randomUUID() + "@example.test",
      password: "task-history-password",
    });
    assert.equal((await f(query({ taskId: c.t.id }))).total, 0);
    assert.deepEqual((await f(route)).tasks, []);
    for (const value of [
      "?unknown=1",
      "?taskId=bad",
      "?page=-1",
      "?page=1.5",
      "?taskId=&taskId=",
      "?action=delete",
      "?field=transcript",
      "?from=2027-02-29",
      "?from=2028-03-01&to=2028-02-29",
      "?timeZone=bad",
    ])
      assert.equal((await c.owner(route + value)).status, 400, value);
    assert.equal((await c.owner(route + "/extra")).status, 404);
    const service = await import("../src/lib/task-activity-server"),
      mutate = await import("../src/lib/collection-tasks-server");
    await c.local.db
      .prepare("UPDATE users SET role='viewer' WHERE id=?")
      .run(c.actor.id);
    await assert.rejects(
      mutate.dispatchCollectionTasks(
        new Request("http://test/api/" + c.root + "/" + c.t.id, {
          method: "PUT",
          body: JSON.stringify({
            version: 1,
            title: c.t.title,
            assigneeId: null,
            dueDate: null,
            status: "open",
          }),
        }),
        ["library", "collections", c.g.collection.id, "tasks", c.t.id],
        c.actor,
      ),
      /Edit access unavailable/,
    );
    await c.local.db
      .prepare("UPDATE users SET workspace_id=? WHERE id=?")
      .run(randomUUID(), c.actor.id);
    await assert.rejects(
      service.dispatchTaskActivity(
        new Request("http://test/api/" + route),
        ["library", "task-activity"],
        c.actor,
      ),
      /Workspace access unavailable/,
    );
  },
);
test(
  "local-date intersections, changed-field filters, bounded retention and legacy tasks do not invent prior events",
  { timeout: 120000 },
  async () => {
    const c = await setup(),
      stored = await c.local.get<any>(
        "libraryTaskActivity",
        c.t.id,
        c.actor.workspaceId,
      ),
      seed = stored.events[0];
    await c.local.put("libraryTaskActivity", {
      ...stored,
      events: Array.from({ length: 100 }, (_, n) => ({
        ...seed,
        id: randomUUID(),
        sequence: n + 1,
        at: "2028-03-01T00:30:00.000Z",
      })),
    });
    const r = await c.edit(c.t, { dueDate: "2028-03-02" });
    assert.equal(r.status, 200);
    let log = await c.history();
    assert.equal(log.total, 100);
    assert.equal(log.omitted, 1);
    assert.equal(log.events.length, 20);
    assert.equal(log.pages, 5);
    assert.equal(
      (
        await c.owner(
          query({
            taskId: c.t.id,
            from: "2028-02-29",
            to: "2028-02-29",
            timeZone: "America/Los_Angeles",
          }),
        )
      ).total,
      99,
    );
    assert.equal(
      (
        await c.owner(
          query({
            taskId: c.t.id,
            from: "2028-02-29",
            to: "2028-02-29",
            timeZone: "UTC",
          }),
        )
      ).total,
      0,
    );
    assert.equal(
      (
        await c.owner(
          query({ taskId: c.t.id, field: "dueDate", action: "task_updated" }),
        )
      ).total,
      1,
    );
    assert.equal(
      (await c.owner(query({ taskId: c.t.id, field: "title" }))).total,
      0,
    );
    assert.equal(
      (await c.owner(query({ taskId: c.t.id, page: "999" }))).page,
      4,
    );
    await c.local.db
      .prepare(
        "DELETE FROM documents WHERE kind='libraryTaskActivity' AND id=?",
      )
      .run(c.t.id);
    assert.equal((await c.history()).total, 0);
    await c.edit(r.task, { status: "in_progress" });
    assert.equal((await c.history()).total, 1);
    assert.equal((await c.history()).events[0].sequence, 1);
    for (const l of Object.values(taskActivityLabels))
      assert.deepEqual(
        Object.keys(l).sort(),
        Object.keys(taskActivityLabels.en).sort(),
      );
  },
);
test(
  "task/source/collection removal erases owned history, general tasks retain their scope and orphan history is pruned",
  { timeout: 120000 },
  async () => {
    const c = await setup(),
      general = (
        await c.owner(c.root, "POST", {
          ...c.input,
          requestId: randomUUID(),
          title: "General follow-up",
          target: null,
        })
      ).task;
    await c.owner(
      `studies/${c.imports[0].s.id}/responses/${c.imports[0].interviewId}`,
      "DELETE",
    );
    assert.equal((await c.history()).total, 0);
    assert.equal(
      await c.local.get("libraryTaskActivity", c.t.id, c.actor.workspaceId),
      undefined,
    );
    assert.equal((await c.owner(query({ taskId: general.id }))).total, 1);
    await c.owner(c.root + "/" + general.id, "DELETE", {
      version: general.version,
    });
    assert.equal((await c.owner(query({ taskId: general.id }))).total, 0);
    const another = (
      await c.owner(c.root, "POST", {
        ...c.input,
        requestId: randomUUID(),
        title: "Orphan follow-up",
        target: null,
      })
    ).task;
    await c.local.db
      .prepare(
        "DELETE FROM documents WHERE kind='libraryCollectionTask' AND id=?",
      )
      .run(another.id);
    await c.owner(route);
    assert.equal(
      await c.local.get("libraryTaskActivity", another.id, c.actor.workspaceId),
      undefined,
    );
    const last = (
      await c.owner(c.root, "POST", {
        ...c.input,
        requestId: randomUUID(),
        title: "Collection removal follow-up",
        target: null,
      })
    ).task;
    const collection = (
      await c.owner("library/collections/" + c.g.collection.id)
    ).collection;
    await c.owner("library/collections/" + collection.id, "DELETE", {
      version: collection.version,
    });
    assert.equal((await c.owner(query({ taskId: last.id }))).total, 0);
    assert.equal(
      await c.local.get("libraryTaskActivity", last.id, c.actor.workspaceId),
      undefined,
    );
  },
);
test(
  "competing updates record one winning event and a history-write failure rolls back the task mutation",
  { timeout: 120000 },
  async () => {
    const c = await setup(),
      out = await Promise.all([
        c.edit(c.t, { dueDate: "2028-03-01" }),
        c.edit(c.t, { dueDate: "2028-03-02" }),
      ]);
    assert.deepEqual(out.map((r) => r.status).sort(), [200, 409]);
    assert.equal((await c.history()).total, 2);
    const current = out.find((r) => r.status === 200).task,
      prior = await c.history();
    await c.local.db
      .prepare(
        "CREATE TRIGGER fail_task_history BEFORE INSERT ON documents WHEN NEW.kind='libraryTaskActivity' BEGIN SELECT RAISE(ABORT,'Synthetic history write failure'); END",
      )
      .run();
    try {
      assert.equal(
        (await c.edit(current, { dueDate: "2028-03-10" })).status,
        500,
      );
    } finally {
      await c.local.db.prepare("DROP TRIGGER fail_task_history").run();
    }
    assert.deepEqual(
      (await c.owner(c.root)).tasks.find((t: any) => t.id === current.id),
      current,
    );
    assert.deepEqual(await c.history(), prior);
  },
);
