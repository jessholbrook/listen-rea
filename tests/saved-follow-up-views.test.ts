import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { start, stop } from "./harness";
import { inboxSetup } from "./team-review-inbox-fixture";
import { client } from "./image-review-fixture";
import {
  defaultActionFilters,
  selectActionTasks,
} from "../src/lib/research-action-center";
import { defaultTaskActivityFilters } from "../src/lib/task-activity";
import { followUpViewConfig } from "../src/lib/saved-review-views";
before(() => start({ port: 3412 }), { timeout: 90000 });
after(stop);
const root = "library/saved-review-views";
const queue = (extra = {}) => ({
  kind: "tasks",
  filters: { ...defaultActionFilters, ...extra },
});
const history = (extra = {}) => {
  const { page: _, ...filters } = defaultTaskActivityFilters;
  return { kind: "task_activity", filters: { ...filters, ...extra } };
};
const content = (config: any, visibility = "private") => ({
  name: "Synthetic follow-up view",
  visibility,
  config,
});
const path = (v: any) => root + "/" + v.id;
test("strict follow-up presets exclude pages, timezone, task selections, authority and research copies", async () => {
  const c = await inboxSetup(false);
  for (const config of [
    queue(),
    history(),
    queue({ assignee: "mine", due: "week" }),
    history({
      personId: "system",
      action: "assignee_unavailable",
      field: "assignee",
      from: "2028-02-29",
      to: "2028-03-01",
    }),
  ]) {
    assert.equal((await c.owner(root, "POST", content(config))).status, 200);
  }
  for (const config of [
    queue({ status: "pending" }),
    queue({ assignee: "admin" }),
    queue({ query: "x".repeat(161) }),
    queue({ page: 1 }),
    history({ page: 0 }),
    history({ timeZone: "UTC" }),
    history({ from: "2027-02-29" }),
    history({ from: "2028-03-01", to: "2028-02-29" }),
    history({ action: "edited" }),
    history({ field: "source" }),
    { ...queue(), selected: [randomUUID()] },
    { ...history(), canEdit: true },
  ]) {
    assert.equal(followUpViewConfig.safeParse(config).success, false);
    assert.equal((await c.owner(root, "POST", content(config))).status, 400);
  }
});
test(
  "both kinds persist across sessions with private isolation, reader copies, current role gates and versioned updates",
  { timeout: 120000 },
  async () => {
    const c = await inboxSetup();
    for (const config of [
      queue({ assignee: "mine", due: "overdue" }),
      history({ personId: "system", field: "assignee" }),
    ]) {
      const privateView = (await c.person.call(root, "POST", content(config)))
        .view;
      const shared = (
        await c.person.call(root, "POST", content(config, "shared"))
      ).view;
      assert.equal((await c.owner(path(privateView))).status, 404);
      assert.equal(
        (await c.owner(root)).views.some((v: any) => v.id === privateView.id),
        false,
      );
      const session = await client();
      await session("auth/login", "POST", {
        email: c.person.email,
        password: c.person.password,
      });
      assert.deepEqual((await session(path(privateView))).view.config, config);
      await c.local.db
        .prepare("UPDATE users SET role='viewer' WHERE id=?")
        .run(c.person.id);
      assert.equal((await session(path(shared))).view.canManage, false);
      assert.equal(
        (
          await session(path(shared), "PUT", {
            ...content(config, "shared"),
            version: 1,
          })
        ).status,
        403,
      );
      assert.equal((await session(root, "POST", content(config))).status, 200);
      assert.equal(
        (await session(root, "POST", content(config, "shared"))).status,
        403,
      );
      assert.equal(
        (
          await c.owner(path(shared), "PUT", {
            ...content(config, "private"),
            version: 1,
          })
        ).status,
        403,
      );
      assert.equal(
        (
          await c.owner(path(shared), "PUT", {
            ...content(config, "shared"),
            name: "Admin updated",
            version: 1,
          })
        ).status,
        200,
      );
      assert.equal((await session(path(shared) + "?version=1")).status, 409);
      assert.equal(
        (await c.owner(path(shared), "DELETE", { version: 1 })).status,
        409,
      );
      assert.equal(
        (await c.owner(path(shared), "DELETE", { version: 2 })).status,
        200,
      );
      await c.local.db
        .prepare("UPDATE users SET role='researcher' WHERE id=?")
        .run(c.person.id);
    }
  },
);
test(
  "applying saved mine resolves the current viewer; erased and foreign scopes never widen or restore research",
  { timeout: 120000 },
  async () => {
    const c = await inboxSetup(),
      g = await c.create("Saved follow-up scope");
    const task = (
      await c.owner(`library/collections/${g.collection.id}/tasks`, "POST", {
        requestId: randomUUID(),
        title: "Synthetic targeted follow-up",
        assigneeId: c.person.id,
        dueDate: "2028-02-29",
        status: "open",
        target: { kind: "interview", id: c.imports[0].interviewId },
      })
    ).task;
    const mine = (
      await c.owner(
        root,
        "POST",
        content(queue({ assignee: "mine" }), "shared"),
      )
    ).view;
    for (const [call, n] of [
      [c.owner, 0],
      [c.person.call, 1],
    ] as const) {
      const cfg = (await call(path(mine) + "?version=1")).view.config;
      const live = await call("library/action-center");
      assert.equal(
        selectActionTasks(live, cfg.filters, "2028-02-28").length,
        n,
      );
    }
    const configs = [
      queue({ collectionId: g.collection.id }),
      history({ collectionId: g.collection.id, taskId: task.id }),
    ];
    const saved = [];
    for (const cfg of configs)
      saved.push((await c.owner(root, "POST", content(cfg))).view);
    const snapshot = await c.local.list(
      "libraryTaskActivity",
      c.actor.workspaceId,
    );
    for (const v of saved) await c.owner(path(v) + "?version=1");
    assert.deepEqual(
      await c.local.list("libraryTaskActivity", c.actor.workspaceId),
      snapshot,
    );
    assert.equal(
      (
        await c.owner(
          `studies/${c.imports[0].s.id}/responses/${c.imports[0].interviewId}`,
          "DELETE",
        )
      ).status,
      200,
    );
    for (const [i, v] of saved.entries())
      assert.deepEqual((await c.owner(path(v))).view.config, configs[i]);
    assert.equal(
      (await c.owner("library/action-center")).tasks.some(
        (t: any) => t.id === task.id,
      ),
      false,
    );
    assert.equal(
      (
        await c.owner(
          "library/task-activity?" +
            new URLSearchParams({
              collectionId: g.collection.id,
              taskId: task.id,
            }),
        )
      ).total,
      0,
    );
    const foreign = await client();
    await foreign("auth/signup", "POST", {
      name: "Foreign",
      email: randomUUID() + "@example.test",
      password: "synthetic-foreign-password",
    });
    assert.equal((await foreign(path(mine))).status, 404);
    const foreignCfg = queue({ collectionId: g.collection.id });
    assert.equal(
      (await foreign(root, "POST", content(foreignCfg))).status,
      200,
    );
    assert.equal(
      selectActionTasks(
        await foreign("library/action-center"),
        foreignCfg.filters,
        "2028-02-28",
      ).length,
      0,
    );
  },
);
test(
  "competing preset updates commit once and stale unshared presets cannot be applied",
  { timeout: 120000 },
  async () => {
    const c = await inboxSetup(),
      v = (await c.person.call(root, "POST", content(history(), "shared")))
        .view;
    const results = await Promise.all([
      c.owner(path(v), "PUT", {
        ...content(history({ field: "status" }), "shared"),
        version: 1,
      }),
      c.person.call(path(v), "PUT", {
        ...content(history({ field: "dueDate" }), "shared"),
        version: 1,
      }),
    ]);
    assert.deepEqual(results.map((r) => r.status).sort(), [200, 409]);
    assert.equal((await c.owner(path(v) + "?version=1")).status, 409);
    const latest = (await c.person.call(path(v))).view;
    assert.equal(
      (
        await c.person.call(path(v), "PUT", {
          ...content(latest.config),
          version: latest.version,
        })
      ).status,
      200,
    );
    assert.equal(
      (await c.owner(path(v) + "?version=" + latest.version)).status,
      404,
    );
  },
);
