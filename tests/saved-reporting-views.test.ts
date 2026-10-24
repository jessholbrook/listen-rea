import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { start, stop } from "./harness";
import { client } from "./image-review-fixture";
import { workloadSetup } from "./review-workload-fixture";
import { defaultTaskActivityFilters } from "../src/lib/task-activity";
import { savedReportViewConfig } from "../src/lib/saved-review-views";
before(() => start({ port: 3418 }), { timeout: 90000 });
after(stop);
const root = "library/saved-review-views",
  reports = "library/operations-report/";
const workload = (collectionId = "") => ({
  kind: "report_workload",
  report: {
    kind: "workload",
    filters: { collectionId, query: "Synthetic", show: "active" },
    language: "es",
    timeZone: "Europe/Paris",
  },
});
const activity = (collectionId = "", taskId = "") => {
  const { page: _, ...filters } = defaultTaskActivityFilters;
  return {
    kind: "report_activity",
    report: {
      kind: "task_activity",
      filters: { ...filters, collectionId, taskId },
      language: "fr",
      timeZone: "America/Los_Angeles",
    },
  };
};
const content = (
  config: any,
  visibility = "private",
  name = "Synthetic reporting view",
) => ({ name, visibility, config });
const path = (v: any) => root + "/" + v.id;
test(
  "saved reports persist exact kind, filters, language and timezone; strict schemas exclude previews, acknowledgement, paging, authority and invalid settings",
  { timeout: 120000 },
  async () => {
    const c = await workloadSetup();
    for (const cfg of [workload(), activity()]) {
      const p = await c.person.call(root, "POST", content(cfg));
      assert.equal(p.status, 200);
      assert.deepEqual(p.view.config, cfg);
      const separate = await client();
      await separate("auth/login", "POST", {
        email: c.person.email,
        password: c.person.password,
      });
      assert.deepEqual((await separate(path(p.view))).view.config, cfg);
    }
    for (const cfg of [
      { ...workload(), signature: "x" },
      { ...workload(), report: { ...workload().report, reviewed: true } },
      { ...activity(), report: { ...activity().report, rows: [] } },
      {
        ...activity(),
        report: {
          ...activity().report,
          filters: { ...activity().report.filters, page: 0 },
        },
      },
      { ...workload(), report: { ...workload().report, timeZone: "invalid" } },
      { ...workload(), report: { ...workload().report, language: "de" } },
      {
        ...activity(),
        report: {
          ...activity().report,
          filters: { ...activity().report.filters, from: "2027-02-29" },
        },
      },
      { kind: "report_activity", report: workload().report },
      { ...activity(), canEdit: true },
    ]) {
      assert.equal(savedReportViewConfig.safeParse(cfg).success, false);
      assert.equal((await c.owner(root, "POST", content(cfg))).status, 400);
    }
    for (let i = 0; i < 25; i++)
      assert.equal(
        (await c.owner(root, "POST", content(i % 2 ? workload() : activity())))
          .status,
        200,
      );
    assert.equal(
      (await c.owner(root, "POST", content(workload()))).status,
      409,
    );
  },
);
test(
  "private reporting settings stay invisible to admins; shared creators/admins and reader copies keep current-role and version protections",
  { timeout: 120000 },
  async () => {
    const c = await workloadSetup();
    await c.local.db
      .prepare("UPDATE users SET role='viewer' WHERE id=?")
      .run(c.replacement.id);
    for (const cfg of [workload(), activity()]) {
      const hidden = (await c.person.call(root, "POST", content(cfg))).view,
        shared = (await c.person.call(root, "POST", content(cfg, "shared")))
          .view;
      assert.equal((await c.owner(path(hidden))).status, 404);
      assert.equal((await c.replacement.call(path(hidden))).status, 404);
      assert.equal((await c.owner(path(shared))).view.canManage, true);
      assert.equal(
        (await c.owner(path(shared))).view.canChangeVisibility,
        false,
      );
      assert.equal(
        (await c.replacement.call(path(shared))).view.canManage,
        false,
      );
      assert.equal(
        (await c.replacement.call(root, "POST", content(cfg, "shared"))).status,
        403,
      );
      const copy = (await c.replacement.call(root, "POST", content(cfg))).view;
      assert.equal((await c.owner(path(copy))).status, 404);
      assert.equal(
        (await c.owner(path(shared), "PUT", { ...content(cfg), version: 1 }))
          .status,
        403,
      );
      const competing = await Promise.all([
        c.owner(path(shared), "PUT", {
          ...content(cfg, "shared", "Admin changed"),
          version: 1,
        }),
        c.person.call(path(shared), "PUT", {
          ...content(cfg, "shared", "Creator changed"),
          version: 1,
        }),
      ]);
      assert.deepEqual(competing.map((r) => r.status).sort(), [200, 409]);
      assert.equal(
        (await c.replacement.call(path(shared) + "?version=1")).status,
        409,
      );
      assert.equal(
        (
          await c.person.call(path(shared), "PUT", {
            ...content(cfg),
            version: 2,
          })
        ).status,
        200,
      );
      assert.equal(
        (await c.replacement.call(path(shared) + "?version=2")).status,
        404,
      );
      await c.local.db
        .prepare("UPDATE users SET role='viewer' WHERE id=?")
        .run(c.person.id);
      assert.equal(
        (
          await c.person.call(path(hidden), "PUT", {
            ...content(cfg),
            version: 1,
          })
        ).status,
        200,
      );
      assert.equal(
        (await c.person.call(root, "POST", content(cfg, "shared"))).status,
        403,
      );
      await c.local.db
        .prepare("UPDATE users SET role='researcher' WHERE id=?")
        .run(c.person.id);
    }
    const shared = (
      await c.person.call(root, "POST", content(workload(), "shared"))
    ).view;
    await c.local.db
      .prepare("UPDATE users SET workspace_id=? WHERE id=?")
      .run(randomUUID(), c.person.id);
    const list = await c.owner(root);
    assert.equal(
      list.views.filter(
        (v: any) => v.owner.id === c.person.id && v.visibility === "private",
      ).length,
      0,
    );
    assert.equal(
      list.views.find((v: any) => v.id === shared.id).owner.name,
      null,
    );
  },
);
test(
  "applying stored configuration grants no report approval; current data, foreign scope, source erasure and stateless download checks remain enforced",
  { timeout: 120000 },
  async () => {
    const c = await workloadSetup(),
      g = await c.create("Saved reporting context"),
      task = (
        await c.owner(`library/collections/${g.collection.id}/tasks`, "POST", {
          requestId: randomUUID(),
          title: "Synthetic report task",
          assigneeId: c.person.id,
          dueDate: null,
          status: "open",
          target: { kind: "interview", id: c.imports[0].interviewId },
        })
      ).task;
    const before = await c.local.list(
      "libraryTaskActivity",
      c.actor.workspaceId,
    );
    const saved = [];
    for (const cfg of [
      workload(g.collection.id),
      activity(g.collection.id, task.id),
    ]) {
      const v = (await c.owner(root, "POST", content(cfg, "shared"))).view;
      saved.push(v);
      const restored = (await c.replacement.call(path(v) + "?version=1")).view
        .config;
      assert.equal(
        (
          await c.replacement.call(reports + "export", "POST", {
            config: restored.report,
            reviewed: true,
            format: "csv",
          })
        ).status,
        400,
      );
      const fresh = await c.replacement.call(reports + "preview", "POST", {
        config: restored.report,
      });
      assert.equal(fresh.status, 200);
      assert.equal(
        (
          await c.replacement.call(reports + "export", "POST", {
            config: restored.report,
            reviewed: true,
            signature: fresh.signature,
            format: "txt",
          })
        ).status,
        200,
      );
    }
    assert.deepEqual(
      await c.local.list("libraryTaskActivity", c.actor.workspaceId),
      before,
    );
    const old = await c.owner(reports + "preview", "POST", {
      config: saved[1].config.report,
    });
    await c.owner(
      `studies/${c.imports[0].s.id}/responses/${c.imports[0].interviewId}`,
      "DELETE",
    );
    for (const v of saved)
      assert.deepEqual((await c.owner(path(v))).view.config, v.config);
    assert.equal(
      (
        await c.owner(reports + "export", "POST", {
          config: saved[1].config.report,
          reviewed: true,
          signature: old.signature,
          format: "csv",
        })
      ).status,
      409,
    );
    assert.equal(
      (
        await c.owner(reports + "preview", "POST", {
          config: saved[1].config.report,
        })
      ).rows.length,
      0,
    );
    const foreign = await client();
    await foreign("auth/signup", "POST", {
      name: "Foreign",
      email: randomUUID() + "@example.test",
      password: "synthetic-report-foreign",
    });
    assert.equal((await foreign(path(saved[0]))).status, 404);
    assert.equal((await (await client())(root)).status, 401);
  },
);
