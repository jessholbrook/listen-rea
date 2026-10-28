import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { start, stop } from "./harness";
import { workloadSetup } from "./review-workload-fixture";
import { client } from "./image-review-fixture";
import { defaultActionFilters } from "../src/lib/research-action-center";
import { followUpPriorities } from "../src/lib/operations-workspace";
before(() => start({ port: 3420 }), { timeout: 90000 });
after(stop);
const root = "library/operations-pins",
  views = "library/saved-review-views";
const cfg = (collectionId = "") => ({
  kind: "tasks",
  filters: {
    ...defaultActionFilters,
    collectionId,
    query: "PRIVATE_PIN_CONFIG_QUERY",
  },
});
async function view(
  c: any,
  visibility = "private",
  config: any = cfg(),
  call = c.owner,
) {
  return (
    await call(views, "POST", {
      name: "PRIVATE_PIN_VIEW_NAME",
      visibility,
      config,
    })
  ).view;
}
const save = (call: any, scope: string, version: number, viewIds: string[]) =>
  call(root + "/" + scope, "PUT", { version, viewIds });
test(
  "personal pins are isolated even from admins, team pins only reference shared views, readers can manage personal pins, and records copy no view content",
  { timeout: 120000 },
  async () => {
    const c = await workloadSetup(),
      privateView = await view(c, "private", cfg(), c.person.call),
      shared = await view(c, "shared");
    assert.deepEqual((await c.owner(root)).private, {
      version: 0,
      viewIds: [],
    });
    assert.equal(
      (await save(c.person.call, "private", 0, [privateView.id, shared.id]))
        .status,
      200,
    );
    assert.deepEqual((await c.owner(root)).private.viewIds, []);
    assert.deepEqual((await c.replacement.call(root)).private.viewIds, []);
    assert.equal(
      (await save(c.owner, "shared", 0, [privateView.id])).status,
      400,
    );
    assert.equal(
      (await save(c.person.call, "shared", 0, [privateView.id])).status,
      400,
    );
    assert.equal((await save(c.owner, "shared", 0, [shared.id])).status, 200);
    assert.deepEqual((await c.person.call(root)).shared.viewIds, [shared.id]);
    await c.local.db
      .prepare("UPDATE users SET role='viewer' WHERE id=?")
      .run(c.person.id);
    assert.equal((await c.person.call(root)).canManageShared, false);
    assert.equal((await save(c.person.call, "shared", 1, [])).status, 403);
    assert.equal(
      (await save(c.person.call, "private", 1, [shared.id, privateView.id]))
        .status,
      200,
    );
    const records = await c.local.list(
      "libraryOperationsPins",
      c.actor.workspaceId,
    );
    const serialized = JSON.stringify(records);
    for (const forbidden of [
      "PRIVATE_PIN_VIEW_NAME",
      "PRIVATE_PIN_CONFIG_QUERY",
      "filters",
      "report",
      "signature",
      "reviewed",
    ])
      assert.equal(serialized.includes(forbidden), false);
    const same = await c.local.list(
      "libraryOperationsPins",
      c.actor.workspaceId,
    );
    await c.person.call(root);
    assert.deepEqual(
      await c.local.list("libraryOperationsPins", c.actor.workspaceId),
      same,
    );
    const foreign = await client();
    await foreign("auth/signup", "POST", {
      name: "Foreign",
      email: randomUUID() + "@example.test",
      password: "synthetic-pin-password",
    });
    assert.deepEqual((await foreign(root)).shared.viewIds, []);
    assert.equal((await save(foreign, "private", 0, [shared.id])).status, 404);
    assert.equal((await (await client())(root)).status, 401);
  },
);
test(
  "bounded ordered pins persist across sessions; no-op writes are stable and competing versions cannot silently reorder or duplicate entries",
  { timeout: 120000 },
  async () => {
    const c = await workloadSetup(),
      ids = [];
    for (let n = 0; n < 13; n++) ids.push((await view(c, "shared")).id);
    assert.equal((await save(c.owner, "shared", 0, ids)).status, 400);
    assert.equal(
      (await save(c.owner, "shared", 0, [ids[0], ids[0]])).status,
      400,
    );
    let r = await save(c.owner, "shared", 0, ids.slice(0, 12));
    assert.equal(r.board.version, 1);
    const before = await c.local.list(
      "libraryOperationsPins",
      c.actor.workspaceId,
    );
    r = await save(c.owner, "shared", 1, ids.slice(0, 12));
    assert.equal(r.board.version, 1);
    assert.deepEqual(
      await c.local.list("libraryOperationsPins", c.actor.workspaceId),
      before,
    );
    const outcomes = await Promise.all([
      save(c.owner, "shared", 1, [ids[1], ids[0]]),
      save(c.replacement.call, "shared", 1, [ids[0], ids[2]]),
    ]);
    assert.deepEqual(outcomes.map((r) => r.status).sort(), [200, 409]);
    const another = await client();
    await another("auth/login", "POST", {
      email: c.email,
      password: "saved-library-password",
    });
    assert.equal((await another(root)).shared.version, 2);
    assert.deepEqual(
      (await another(root)).shared.viewIds,
      outcomes.find((r) => r.status === 200).board.viewIds,
    );
    assert.equal((await save(c.owner, "shared", 1, [])).status, 409);
    for (const payload of [
      { version: 2, viewIds: ["invalid"] },
      { version: -1, viewIds: [] },
      { version: 2, viewIds: [], ownerId: c.person.id },
      { version: 2, viewIds: [], names: ["injection"] },
    ])
      assert.equal(
        (await c.owner(root + "/shared", "PUT", payload)).status,
        400,
      );
    assert.equal((await c.owner(root, "POST", {})).status, 405);
    assert.equal((await c.owner(root + "/private")).status, 405);
    assert.equal((await c.owner(root + "/private/" + c.person.id)).status, 404);
    assert.equal((await c.owner(root + "?ownerId=" + c.person.id)).status, 400);
  },
);
test(
  "unsharing, deleting and departing private owners prune inaccessible pins with new versions while surviving shared views stay current",
  { timeout: 120000 },
  async () => {
    const c = await workloadSetup(),
      v = await view(c, "shared", cfg(), c.person.call);
    await save(c.owner, "private", 0, [v.id]);
    await save(c.owner, "shared", 0, [v.id]);
    await save(c.person.call, "private", 0, [v.id]);
    await c.person.call(views + "/" + v.id, "PUT", {
      name: "Now private",
      visibility: "private",
      config: v.config,
      version: 1,
    });
    let boards = await c.owner(root);
    assert.deepEqual(boards.private, { version: 2, viewIds: [] });
    assert.deepEqual(boards.shared, { version: 2, viewIds: [] });
    assert.deepEqual((await c.person.call(root)).private.viewIds, [v.id]);
    assert.equal((await save(c.owner, "shared", 1, [])).status, 409);
    await c.person.call(views + "/" + v.id, "DELETE", { version: 2 });
    assert.deepEqual((await c.person.call(root)).private, {
      version: 2,
      viewIds: [],
    });
    const shared = await view(c, "shared", cfg(), c.person.call),
      hidden = await view(c, "private", cfg(), c.person.call);
    await save(c.owner, "shared", 2, [shared.id]);
    await save(c.person.call, "private", 2, [hidden.id]);
    await c.local.db
      .prepare("UPDATE users SET workspace_id=? WHERE id=?")
      .run(randomUUID(), c.person.id);
    boards = await c.owner(root);
    assert.deepEqual(boards.shared.viewIds, [shared.id]);
    assert.equal(
      (await c.owner(views + "/" + shared.id)).view.owner.name,
      null,
    );
    assert.equal(
      (
        await c.local.list<any>("libraryOperationsPins", c.actor.workspaceId)
      ).some((r) => r.ownerId === c.person.id),
      false,
    );
  },
);
test(
  "priorities use current original queue semantics, exclude completed work and preserve personal/date intersections after source erasure",
  { timeout: 120000 },
  async () => {
    const c = await workloadSetup(),
      g = await c.create("Workspace priorities"),
      tasks = [];
    for (const [assigneeId, status, dueDate] of [
      [c.actor.id, "open", "2028-02-29"],
      [null, "in_progress", "2028-02-29"],
      [null, "completed", "2028-02-29"],
      [c.person.id, "open", "2028-02-28"],
    ])
      tasks.push(
        (
          await c.owner(
            `library/collections/${g.collection.id}/tasks`,
            "POST",
            {
              requestId: randomUUID(),
              title: "Priority task",
              assigneeId,
              status,
              dueDate,
              target: { kind: "interview", id: c.imports[0].interviewId },
            },
          )
        ).task,
      );
    const snapshot = await c.local.list(
        "libraryTaskActivity",
        c.actor.workspaceId,
      ),
      data = await c.owner("library/action-center"),
      p = followUpPriorities(data, "2028-02-29");
    assert.deepEqual(
      p.map((r) => [r.kind, r.count]),
      [
        ["today", 2],
        ["unassigned", 1],
        ["mine", 1],
      ],
    );
    assert.equal(followUpPriorities(data, "2028-03-01")[0].count, 0);
    assert.deepEqual(
      await c.local.list("libraryTaskActivity", c.actor.workspaceId),
      snapshot,
    );
    const v = await view(c, "shared", {
      kind: "tasks",
      filters: { ...defaultActionFilters, collectionId: g.collection.id },
    });
    await save(c.owner, "shared", 0, [v.id]);
    await c.owner(
      `studies/${c.imports[0].s.id}/responses/${c.imports[0].interviewId}`,
      "DELETE",
    );
    assert.deepEqual(
      followUpPriorities(
        await c.owner("library/action-center"),
        "2028-02-29",
      ).map((r) => r.count),
      [0, 0, 0],
    );
    assert.deepEqual((await c.owner(root)).shared.viewIds, [v.id]);
    assert.equal(
      (await c.owner(views + "/" + v.id)).view.config.filters.collectionId,
      g.collection.id,
    );
  },
);
