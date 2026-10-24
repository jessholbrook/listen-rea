import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { start, stop } from "./harness";
import { transcriptSetup } from "./library-transcript-answers-fixture";
import { client } from "./image-review-fixture";
before(
  () =>
    start({ port: process.env.RESEARCH_TEST_PRODUCTION === "1" ? 3377 : 3376 }),
  { timeout: 90000 },
);
after(stop);
const content = (extra: any = {}) => ({
  title: "Synthetic follow-up task",
  assigneeId: null,
  dueDate: "2028-02-29",
  status: "open",
  ...extra,
});
const create = (extra: any = {}) => ({
  ...content(),
  requestId: randomUUID(),
  target: null,
  ...extra,
});
const edit = (t: any, extra: any = {}) => ({
  ...content({
    title: t.title,
    assigneeId: t.assigneeId,
    dueDate: t.dueDate,
    status: t.status,
  }),
  version: t.version,
  ...extra,
});
const collectionEdit = (c: any, extra: any = {}) => ({
  title: c.title,
  interviewIds: c.interviewIds,
  briefIds: c.briefIds,
  version: c.version,
  ...extra,
});
async function setup() {
  const c = await transcriptSetup();
  const collection = (
    await c.owner("library/collections", "POST", {
      title: "Synthetic task collection",
      requestId: randomUUID(),
      interviewIds: c.imports.map((i) => i.interviewId),
      briefIds: [],
    })
  ).collection;
  return {
    ...c,
    collection,
    path: `library/collections/${collection.id}/tasks`,
  };
}
test(
  "assigned follow-ups create idempotently, enforce optimistic concurrency, complete/reopen without approving research, and cannot resurrect after deletion",
  { timeout: 120000 },
  async () => {
    const c = await setup(),
      input = create({
        assigneeId: c.actor.id,
        target: { kind: "interview", id: c.imports[0].interviewId },
      });
    const asked = await c.ask({ collectionId: c.collection.id });
    const [a, b] = await Promise.all([
      c.owner(c.path, "POST", input),
      c.owner(c.path, "POST", input),
    ]);
    assert.deepEqual([a.status, b.status].sort(), [200, 201]);
    assert.equal(a.task.id, b.task.id);
    assert.equal(
      (await c.owner(c.path, "POST", { ...input, title: "Different request" }))
        .status,
      409,
    );
    let t = a.task;
    assert.equal(t.version, 1);
    assert.equal(t.completedAt, null);
    assert.equal(t.workspaceId, undefined);
    assert.equal(t.inputHash, undefined);
    assert.equal(t.requestId, undefined);
    const plan = await c.owner(c.path);
    assert.equal(plan.tasks.length, 1);
    assert.equal(plan.userId, c.actor.id);
    assert.equal(plan.members[0].email, undefined);
    const [one, two] = await Promise.all([
      c.owner(c.path + "/" + t.id, "PUT", edit(t, { status: "in_progress" })),
      c.owner(
        c.path + "/" + t.id,
        "PUT",
        edit(t, { title: "Concurrent task update" }),
      ),
    ]);
    assert.deepEqual([one.status, two.status].sort(), [200, 409]);
    t = one.task || two.task;
    assert.equal(
      (await c.owner(c.path + "/" + t.id, "PUT", edit(t, { version: 999 })))
        .status,
      409,
    );
    t = (
      await c.owner(
        c.path + "/" + t.id,
        "PUT",
        edit(t, { status: "completed" }),
      )
    ).task;
    assert.ok(t.completedAt);
    const completedAt = t.completedAt;
    const duplicate = await c.owner(
      c.path + "/" + t.id,
      "PUT",
      edit(t, { version: t.version - 1 }),
    );
    assert.equal(duplicate.reused, true);
    assert.equal(duplicate.task.completedAt, completedAt);
    assert.equal(
      (
        await c.owner("library/answers/" + asked.result.savedAnswerId)
      ).answer.history.at(-1).reviewed,
      false,
    );
    assert.equal(
      await c.local.get(
        "libraryCollectionReview",
        c.collection.id,
        c.actor.workspaceId,
      ),
      undefined,
    );
    t = (await c.owner(c.path + "/" + t.id, "PUT", edit(t, { status: "open" })))
      .task;
    assert.equal(t.completedAt, null);
    assert.equal(
      (await c.owner(c.path + "/" + t.id, "DELETE", { version: t.version - 1 }))
        .status,
      409,
    );
    assert.equal(
      (await c.owner(c.path + "/" + t.id, "DELETE", { version: t.version }))
        .status,
      200,
    );
    assert.equal((await c.owner(c.path, "POST", input)).status, 409);
    assert.equal(
      (await c.owner(c.path + "/" + t.id, "PUT", edit(t))).status,
      404,
    );
    const tomb = (
      await c.local.list<any>(
        "libraryCollectionTaskTombstone",
        c.actor.workspaceId,
      )
    )[0];
    assert.deepEqual(Object.keys(tomb).sort(), [
      "createdAt",
      "id",
      "workspaceId",
    ]);
  },
);
test(
  "task scope, roles, assignees, immutable links and strict calendar dates reject unsafe or stale input",
  { timeout: 120000 },
  async () => {
    const c = await setup(),
      anon = await client();
    assert.equal((await anon(c.path)).status, 401);
    const service = await import("../src/lib/collection-tasks-server"),
      p = ["library", "collections", c.collection.id, "tasks"];
    const req = (method = "GET", data: any = undefined) =>
      new Request("http://localhost/api/" + c.path, {
        method,
        ...(data ? { body: JSON.stringify(data) } : {}),
      });
    const view = await service.dispatchCollectionTasks(req(), p, {
      ...c.actor,
      role: "viewer" as any,
    });
    assert.equal((await view!.json()).canEdit, false);
    await assert.rejects(
      () =>
        service.dispatchCollectionTasks(req("POST", create()), p, {
          ...c.actor,
          role: "viewer" as any,
        }),
      /edit access/,
    );
    await assert.rejects(
      () =>
        service.dispatchCollectionTasks(req(), p, {
          ...c.actor,
          workspaceId: randomUUID(),
        }),
      /unavailable/,
    );
    for (const bad of [
      create({ dueDate: "2027-02-29" }),
      create({ dueDate: "2028-99-01" }),
      create({ dueDate: "2028-01-01T12:00:00Z" }),
      create({ status: "approved" }),
      create({
        target: { kind: "interview", id: randomUUID(), title: "private" },
      }),
      create({ title: "x" }),
      create({ description: "unbounded extra" }),
    ])
      assert.equal(
        (await c.owner(c.path, "POST", bad)).status,
        400,
        JSON.stringify(bad),
      );
    assert.equal(
      (await c.owner(c.path, "POST", create({ assigneeId: randomUUID() })))
        .status,
      404,
    );
    for (const kind of ["interview", "answer", "brief"])
      assert.equal(
        (
          await c.owner(
            c.path,
            "POST",
            create({ target: { kind, id: randomUUID() } }),
          )
        ).status,
        404,
      );
    const global = (await c.ask()).result.savedAnswerId;
    assert.equal(
      (
        await c.owner(
          c.path,
          "POST",
          create({ target: { kind: "answer", id: global } }),
        )
      ).status,
      404,
    );
    const brief = await c.create();
    assert.equal(
      (
        await c.owner(
          c.path,
          "POST",
          create({ target: { kind: "brief", id: brief.id } }),
        )
      ).status,
      404,
    );
    const t = (await c.owner(c.path, "POST", create())).task;
    assert.equal(
      (await c.owner(c.path + "/" + t.id, "PUT", { ...edit(t), target: null }))
        .status,
      400,
    );
    assert.equal((await c.owner(c.path, "PUT", {})).status, 405);
    assert.equal((await c.owner(c.path + "/" + t.id)).status, 405);
    assert.equal((await c.owner(c.path + "/" + t.id + "/other")).status, 404);
  },
);
test(
  "collection membership, answer removal, brief unlink and source erasure purge linked task text; request tombstones prevent replay",
  { timeout: 120000 },
  async () => {
    const c = await setup();
    let collection = c.collection;
    const asked = await c.ask({ collectionId: collection.id });
    const answerId = asked.result.savedAnswerId;
    const brief = await c.create();
    collection = (
      await c.owner(
        "library/collections/" + collection.id,
        "PUT",
        collectionEdit(collection, { briefIds: [brief.id] }),
      )
    ).collection;
    const inputs = [
      create({
        title: "MARKED_INTERVIEW_TASK",
        target: { kind: "interview", id: c.imports[0].interviewId },
      }),
      create({
        title: "MARKED_ANSWER_TASK",
        target: { kind: "answer", id: answerId },
      }),
      create({
        title: "MARKED_BRIEF_TASK",
        target: { kind: "brief", id: brief.id },
      }),
      create({ title: "Collection coordination" }),
    ];
    for (const input of inputs)
      assert.equal((await c.owner(c.path, "POST", input)).status, 201);
    collection = (
      await c.owner(
        "library/collections/" + collection.id,
        "PUT",
        collectionEdit(collection, { briefIds: [] }),
      )
    ).collection;
    assert.equal((await c.owner(c.path)).tasks.length, 3);
    assert.equal((await c.owner(c.path, "POST", inputs[2])).status, 409);
    const a = (await c.owner("library/answers/" + answerId)).answer;
    assert.equal(
      (
        await c.owner("library/answers/" + answerId, "DELETE", {
          version: a.history.at(-1).version,
        })
      ).status,
      200,
    );
    assert.equal((await c.owner(c.path)).tasks.length, 2);
    assert.equal((await c.owner(c.path, "POST", inputs[1])).status, 409);
    collection = (
      await c.owner(
        "library/collections/" + collection.id,
        "PUT",
        collectionEdit(collection, {
          interviewIds: [c.imports[1].interviewId],
        }),
      )
    ).collection;
    assert.equal((await c.owner(c.path)).tasks.length, 1);
    assert.equal((await c.owner(c.path, "POST", inputs[0])).status, 409);
    collection = (
      await c.owner(
        "library/collections/" + collection.id,
        "PUT",
        collectionEdit(collection, {
          interviewIds: c.imports.map((i) => i.interviewId),
        }),
      )
    ).collection;
    const eraseInput = create({
      title: "MARKED_ERASE_TASK",
      target: { kind: "interview", id: c.imports[0].interviewId },
    });
    await c.owner(c.path, "POST", eraseInput);
    assert.equal(
      (
        await c.owner(
          `studies/${c.imports[0].s.id}/responses/${c.imports[0].interviewId}`,
          "DELETE",
        )
      ).status,
      200,
    );
    const tasks = await c.local.list<any>(
      "libraryCollectionTask",
      c.actor.workspaceId,
    );
    assert.equal(tasks.length, 1);
    assert.equal(JSON.stringify(tasks).includes("MARKED_"), false);
    assert.equal((await c.owner(c.path, "POST", eraseInput)).status, 409);
    collection = (await c.owner("library/collections/" + collection.id))
      .collection;
    assert.equal(
      (
        await c.owner("library/collections/" + collection.id, "DELETE", {
          version: collection.version,
        })
      ).status,
      200,
    );
    assert.equal(
      (await c.local.list("libraryCollectionTask", c.actor.workspaceId)).length,
      0,
    );
    assert.equal((await c.owner(c.path)).status, 404);
  },
);
test(
  "removed assignees are unassigned with a version change; collection task limit is enforced",
  { timeout: 120000 },
  async () => {
    const c = await setup(),
      member = randomUUID();
    await c.local.db
      .prepare(
        "INSERT INTO users(id,email,name,password,workspace_id,role) VALUES(?,?,?,?,?,?)",
      )
      .run(
        member,
        member + "@example.test",
        "Synthetic assignee",
        "unused",
        c.actor.workspaceId,
        "collaborator",
      );
    const t = (await c.owner(c.path, "POST", create({ assigneeId: member })))
      .task;
    await c.local.db.prepare("DELETE FROM users WHERE id=?").run(member);
    const plan = await c.owner(c.path);
    assert.equal(plan.tasks[0].assigneeId, null);
    assert.equal(plan.tasks[0].version, t.version + 1);
    assert.equal(
      plan.members.some((m: any) => m.id === member),
      false,
    );
    assert.equal(
      (
        await c.owner(
          c.path + "/" + t.id,
          "PUT",
          edit(t, { assigneeId: null, title: "Stale assignee update" }),
        )
      ).status,
      409,
    );
    const stored = await c.local.get<any>(
      "libraryCollectionTask",
      t.id,
      c.actor.workspaceId,
    );
    await c.local.transaction(async () => {
      for (let n = 0; n < 99; n++)
        await c.local.put("libraryCollectionTask", {
          ...stored,
          id: randomUUID(),
          requestId: randomUUID(),
        });
    });
    assert.equal((await c.owner(c.path, "POST", create())).status, 409);
  },
);
