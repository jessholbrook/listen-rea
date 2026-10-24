import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { start, stop } from "./harness";
import { client } from "./image-review-fixture";
import {
  inboxSetup,
  feedbackAction,
  finalReview,
} from "./team-review-inbox-fixture";
import { triageLabels } from "../src/lib/operations-triage";
before(() => start({ port: 3408 }), { timeout: 90000 });
after(stop);
const root = "library/operations-triage/",
  target = (t: any) => ({
    id: t.id,
    collectionId: t.collectionId,
    version: t.version,
  });
const changes = (
  assignee: any = { mode: "clear" },
  dueDate: any = { mode: "set", date: "2028-02-29" },
) => ({ assignee, dueDate });
async function setup() {
  const c = await inboxSetup(),
    g = await c.create("Triage collection", [c.actor.id, c.person.id]),
    tasks: any[] = [];
  for (const status of ["open", "in_progress", "completed"]) {
    const r = await c.owner(
      `library/collections/${g.collection.id}/tasks`,
      "POST",
      {
        requestId: randomUUID(),
        title: "Triage follow-up " + status,
        assigneeId: c.actor.id,
        dueDate: "2028-02-27",
        status,
        target: { kind: "interview", id: c.imports[0].interviewId },
      },
    );
    assert.equal(r.status, 201);
    tasks.push(r.task);
  }
  const path = (t: any) =>
    `library/collections/${t.collectionId}/tasks/${t.id}`;
  const row = async (t: any) =>
    (await c.owner(`library/collections/${t.collectionId}/tasks`)).tasks.find(
      (r: any) => r.id === t.id,
    );
  const edit = async (t: any, extra: any) =>
    c.owner(path(t), "PUT", {
      version: t.version,
      title: t.title,
      status: t.status,
      assigneeId: t.assigneeId,
      dueDate: t.dueDate,
      ...extra,
    });
  g.d = await c.owner(g.path);
  for (const call of [c.owner, c.person.call])
    g.d = await call(
      g.path + "/feedback",
      "POST",
      feedbackAction(g.d, { op: "decision", approved: true }),
    );
  g.d = await c.owner(g.path + "/review", "POST", finalReview(g.d));
  assert.equal(g.d.packet.canExport, true);
  return { ...c, g, tasks, path, row, edit };
}
test(
  "triage previews minimal current before/after values without changing tasks or approved handoff decisions",
  { timeout: 120000 },
  async () => {
    const c = await setup(),
      b = await c.owner(c.g.path),
      h = await c.owner("library/review-activity"),
      t = c.tasks[0];
    const r = await c.owner(root + "preview", "POST", {
      changes: changes(),
      tasks: [target(t)],
    });
    assert.equal(r.status, 200);
    assert.equal(r.tasks[0].status, "ready");
    assert.equal(r.tasks[0].before.assignee.id, c.actor.id);
    assert.equal(r.tasks[0].after.assignee, null);
    assert.equal(r.tasks[0].after.dueDate, "2028-02-29");
    for (const word of [
      "transcript",
      "PRIVATE_INBOX_SUMMARY",
      "target",
      "requestId",
      "workspaceId",
      "inputHash",
      "signature",
    ])
      assert.equal(JSON.stringify(r).includes(word), false, word);
    assert.deepEqual(await c.row(t), t);
    assert.deepEqual(await c.owner(c.g.path), b);
    assert.deepEqual(await c.owner("library/review-activity"), h);
  },
);
test(
  "apply preserves titles, status, completion and source links, invalidates handoff approval under current rules, and rejects old-version replay",
  { timeout: 120000 },
  async () => {
    const c = await setup(),
      input = {
        changes: changes({ mode: "set", id: c.person.id }),
        tasks: c.tasks.map(target),
        acknowledged: true,
      };
    const r = await c.owner(root + "apply", "POST", input);
    assert.deepEqual(
      r.tasks.map((t: any) => t.status),
      ["applied", "applied", "applied"],
    );
    for (const old of c.tasks) {
      const updated = await c.row(old);
      for (const key of [
        "title",
        "status",
        "completedAt",
        "target",
        "createdAt",
      ])
        assert.deepEqual(updated[key], old[key], key);
      assert.equal(updated.assigneeId, c.person.id);
      assert.equal(updated.dueDate, "2028-02-29");
      assert.equal(updated.version, old.version + 1);
    }
    const g = await c.owner(c.g.path);
    assert.equal(g.packet.canExport, false);
    assert.equal(g.packet.reviewedAt, null);
    assert.ok(g.feedback.reviewers.every((r: any) => !r.approvedAt));
    const h = await c.owner("library/review-activity");
    assert.deepEqual(
      (await c.owner(root + "apply", "POST", input)).tasks.map(
        (t: any) => t.status,
      ),
      ["conflict", "conflict", "conflict"],
    );
    assert.deepEqual(await c.owner("library/review-activity"), h);
  },
);
test(
  "mixed stale, removed and current tasks commit independently in input order without overwriting concurrent edits",
  { timeout: 120000 },
  async () => {
    const c = await setup(),
      [a, b, d] = c.tasks;
    await c.edit(a, { title: "Concurrent task rename", dueDate: "2028-03-10" });
    await c.owner(c.path(b), "DELETE", { version: b.version });
    const r = await c.owner(root + "apply", "POST", {
      changes: changes(),
      acknowledged: true,
      tasks: [a, b, d].map(target),
    });
    assert.deepEqual(
      r.tasks.map((t: any) => t.id),
      [a, b, d].map((t) => t.id),
    );
    assert.deepEqual(
      r.tasks.map((t: any) => t.status),
      ["conflict", "unavailable", "applied"],
    );
    assert.equal((await c.row(a)).dueDate, "2028-03-10");
    assert.equal((await c.row(d)).dueDate, "2028-02-29");
  },
);
test(
  "unchanged edits never bump task versions or reset approved reviews; clear and keep have independent semantics",
  { timeout: 120000 },
  async () => {
    const c = await setup(),
      t = c.tasks[0],
      b = await c.owner(c.g.path);
    const r = await c.owner(root + "apply", "POST", {
      changes: changes({ mode: "keep" }, { mode: "set", date: t.dueDate }),
      tasks: [target(t)],
      acknowledged: true,
    });
    assert.equal(r.tasks[0].status, "unchanged");
    assert.deepEqual(await c.row(t), t);
    assert.deepEqual(await c.owner(c.g.path), b);
    const clear = await c.owner(root + "apply", "POST", {
      changes: changes({ mode: "keep" }, { mode: "clear" }),
      tasks: [target(t)],
      acknowledged: true,
    });
    assert.equal(clear.tasks[0].status, "applied");
    assert.equal((await c.row(t)).assigneeId, t.assigneeId);
    assert.equal((await c.row(t)).dueDate, null);
  },
);
test(
  "strict bounded schemas reject bad dates, duplicate targets, injected content and missing acknowledgement before writes",
  { timeout: 120000 },
  async () => {
    const c = await setup(),
      t = target(c.tasks[0]),
      base = { changes: changes(), tasks: [t] };
    for (const input of [
      { ...base, tasks: [] },
      {
        ...base,
        tasks: Array.from({ length: 26 }, () => ({ ...t, id: randomUUID() })),
      },
      { ...base, tasks: [t, t] },
      { ...base, changes: changes({ mode: "keep" }, { mode: "keep" }) },
      { ...base, changes: changes({ mode: "set", id: randomUUID() }) },
      {
        ...base,
        changes: changes({ mode: "keep" }, { mode: "set", date: "2027-02-29" }),
      },
      {
        ...base,
        changes: changes({ mode: "keep" }, { mode: "set", date: "2101-01-01" }),
      },
      { ...base, tasks: [{ ...t, status: "completed" }] },
      { ...base, changes: { ...changes(), title: "injected" } },
    ])
      assert.ok(
        [400, 409].includes(
          (await c.owner(root + "preview", "POST", input)).status,
        ),
      );
    for (const acknowledged of [undefined, false])
      assert.equal(
        (await c.owner(root + "apply", "POST", { ...base, acknowledged }))
          .status,
        400,
      );
    assert.equal(
      (await c.owner(root + "preview?scope=all", "POST", base)).status,
      400,
    );
    assert.equal((await c.owner(root + "preview")).status, 405);
    assert.equal((await c.owner(root + "unknown", "POST", base)).status, 404);
    assert.deepEqual(await c.row(c.tasks[0]), c.tasks[0]);
    for (const l of Object.values(triageLabels))
      assert.deepEqual(
        Object.keys(l).sort(),
        Object.keys(triageLabels.en).sort(),
      );
  },
);
test(
  "reader, foreign, anonymous and departed assignee boundaries hold, including actors changed after authentication",
  { timeout: 120000 },
  async () => {
    const c = await setup(),
      input = { changes: changes(), tasks: [target(c.tasks[0])] },
      anon = await client();
    assert.equal((await anon(root + "preview", "POST", input)).status, 401);
    const foreign = await client();
    await foreign("auth/signup", "POST", {
      name: "Other triage user",
      email: randomUUID() + "@example.test",
      password: "triage-test-password",
    });
    assert.equal(
      (await foreign(root + "preview", "POST", input)).tasks[0].status,
      "unavailable",
    );
    await c.local.db
      .prepare("UPDATE users SET role='viewer' WHERE id=?")
      .run(c.person.id);
    assert.equal(
      (await c.person.call(root + "preview", "POST", input)).status,
      403,
    );
    const service = await import("../src/lib/operations-triage-server");
    await c.local.db
      .prepare("UPDATE users SET role='viewer' WHERE id=?")
      .run(c.actor.id);
    await assert.rejects(
      service.dispatchOperationsTriage(
        new Request("http://test/api/" + root + "apply", {
          method: "POST",
          body: JSON.stringify({ ...input, acknowledged: true }),
        }),
        ["library", "operations-triage", "apply"],
        c.actor,
      ),
      /Edit access unavailable/,
    );
    await c.local.db
      .prepare("UPDATE users SET role='admin' WHERE id=?")
      .run(c.actor.id);
    await c.local.db
      .prepare("UPDATE users SET workspace_id=? WHERE id=?")
      .run(randomUUID(), c.person.id);
    assert.equal(
      (
        await c.owner(root + "apply", "POST", {
          ...input,
          changes: changes({ mode: "set", id: c.person.id }),
          acknowledged: true,
        })
      ).status,
      409,
    );
    assert.deepEqual(await c.row(c.tasks[0]), c.tasks[0]);
  },
);
test(
  "source erasure cannot revive selected tasks and competing batches serialize at the current task version",
  { timeout: 120000 },
  async () => {
    const c = await setup(),
      t = c.tasks[0],
      input = { changes: changes(), tasks: [target(t)], acknowledged: true };
    const outcomes = await Promise.all([
      c.owner(root + "apply", "POST", input),
      c.owner(root + "apply", "POST", {
        ...input,
        changes: changes(
          { mode: "clear" },
          { mode: "set", date: "2028-03-01" },
        ),
      }),
    ]);
    assert.deepEqual(outcomes.map((o) => o.tasks[0].status).sort(), [
      "applied",
      "conflict",
    ]);
    await c.owner(
      `studies/${c.imports[0].s.id}/responses/${c.imports[0].interviewId}`,
      "DELETE",
    );
    const erased = await c.owner(root + "apply", "POST", input);
    assert.equal(erased.tasks[0].status, "unavailable");
    assert.equal((await c.owner("library/action-center")).tasks.length, 0);
    assert.equal((await c.owner("library/review-activity")).events.length, 0);
  },
);
