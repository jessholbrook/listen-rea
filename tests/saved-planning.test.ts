import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { start, stop } from "./harness";
import { workloadSetup } from "./review-workload-fixture";
import { client } from "./image-review-fixture";
import {
  initialCalendarState,
  calendarProjection,
} from "../src/lib/follow-up-calendar";
import { operationsReportLabels } from "../src/lib/operations-report";
import { actionLabels } from "../src/lib/research-action-center";
before(() => start({ port: 3424 }), { timeout: 90000 });
after(stop);
const views = "library/saved-review-views",
  reports = "library/operations-report/",
  pins = "library/operations-pins";
const cfg = (collectionId = "", extra: any = {}) => ({
  kind: "calendar",
  filters: { ...initialCalendarState("2028-02-29"), collectionId },
  language: "en",
  timeZone: "America/Los_Angeles",
  ...extra,
});
const wrap = (c: any) => ({ kind: "report_calendar", report: c });
const content = (config: any, visibility = "private") => ({
  name: "Synthetic planning view",
  visibility,
  config,
});
const target = (v: any) => `${views}/${v.id}`;
const preview = (c: any, config: any) =>
  c.owner(reports + "preview", "POST", { config });
const download = (c: any, config: any, p: any, extra: any = {}) =>
  c.owner(reports + "export", "POST", {
    config,
    signature: p.signature,
    reviewed: true,
    format: "csv",
    ...extra,
  });
async function setup() {
  const c = await workloadSetup(),
    g = await c.create("Planning scope"),
    tasks = [];
  for (const [assigneeId, status, dueDate] of [
    [c.actor.id, "open", "2028-02-28"],
    [c.person.id, "in_progress", "2028-02-29"],
    [null, "open", null],
    [c.actor.id, "completed", "2028-02-29"],
  ]) {
    const r = await c.owner(
      `library/collections/${g.collection.id}/tasks`,
      "POST",
      {
        requestId: randomUUID(),
        title:
          tasks.length === 0
            ? "=PRIVATE_PLANNING_FORMULA"
            : "Planning task " + tasks.length,
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
  "strict planning/report presets persist only exact bounded filters, language and time zone; invalid dates, incompatible day windows and copied authority/preview fields are rejected",
  { timeout: 120000 },
  async () => {
    const c = await setup(),
      config = cfg(c.g.collection.id),
      snapshot = await c.local.list(
        "libraryCollectionTask",
        c.actor.workspaceId,
      );
    for (const language of ["en", "es", "fr"])
      for (const configValue of [
        cfg(c.g.collection.id, { language }),
        wrap(cfg(c.g.collection.id, { language })),
      ]) {
        const r = await c.owner(views, "POST", content(configValue));
        assert.equal(r.status, 200);
        assert.deepEqual(r.view.config, configValue);
      }
    for (const bad of [
      { ...config, reviewed: true },
      { ...config, language: "de" },
      { ...config, timeZone: "invalid" },
      ...[
        { month: "1999-12" },
        { month: "2101-01" },
        { month: "2028-13" },
        { day: "2027-02-29" },
        { day: "2028-03-01" },
        { day: "2028-02-29", window: "week" },
        { window: "today" },
        { page: 2 },
        { selected: [randomUUID()] },
        { query: "x".repeat(161) },
        { assignee: "someone" },
        { status: "approved" },
      ].map((f) => ({ ...config, filters: { ...config.filters, ...f } })),
    ]) {
      for (const value of [bad, wrap(bad)])
        assert.equal(
          (await c.owner(views, "POST", content(value))).status,
          400,
        );
      assert.equal((await preview(c, bad)).status, 400);
    }
    const serialized = JSON.stringify(
      await c.local.list("librarySavedReviewView", c.actor.workspaceId),
    );
    for (const word of [
      "signature",
      "reviewed",
      "PRIVATE_PLANNING_FORMULA",
      "transcript",
      "selected",
      "rows",
    ])
      assert.equal(serialized.includes(word), false);
    assert.deepEqual(
      await c.local.list("libraryCollectionTask", c.actor.workspaceId),
      snapshot,
    );
  },
);
test(
  "private/shared planning views and pins respect ownership, reader copies and current versions across sessions",
  { timeout: 120000 },
  async () => {
    const c = await setup(),
      config = cfg(c.g.collection.id),
      privateView = (await c.person.call(views, "POST", content(config))).view,
      shared = (await c.owner(views, "POST", content(wrap(config), "shared")))
        .view;
    assert.equal((await c.owner(target(privateView))).status, 404);
    assert.equal((await c.replacement.call(target(privateView))).status, 404);
    await c.local.db
      .prepare("UPDATE users SET role='viewer' WHERE id=?")
      .run(c.person.id);
    assert.equal(
      (await c.person.call(views, "POST", content(config, "shared"))).status,
      403,
    );
    assert.equal(
      (
        await c.person.call(target(shared), "PUT", {
          ...content(config, "shared"),
          version: 1,
        })
      ).status,
      403,
    );
    const copy = (await c.person.call(views, "POST", content(shared.config)))
      .view;
    assert.equal(copy.owner.id, c.person.id);
    assert.equal(
      (
        await c.person.call(pins + "/private", "PUT", {
          version: 0,
          viewIds: [privateView.id, copy.id],
        })
      ).status,
      200,
    );
    assert.equal(
      (
        await c.owner(pins + "/shared", "PUT", {
          version: 0,
          viewIds: [privateView.id],
        })
      ).status,
      400,
    );
    assert.equal(
      (
        await c.owner(pins + "/shared", "PUT", {
          version: 0,
          viewIds: [shared.id],
        })
      ).status,
      200,
    );
    const separate = await client();
    await separate("auth/login", "POST", {
      email: c.person.email,
      password: c.person.password,
    });
    assert.deepEqual(
      (await separate(target(privateView) + "?version=1")).view.config,
      config,
    );
    const next = {
      ...config,
      filters: { ...config.filters, window: "undated" },
    };
    const edited = await c.person.call(target(privateView), "PUT", {
      ...content(next),
      version: 1,
    });
    assert.equal(edited.view.version, 2);
    assert.equal(
      (await separate(target(privateView) + "?version=1")).status,
      409,
    );
    assert.equal(
      (await c.person.call(target(privateView), "DELETE", { version: 1 }))
        .status,
      409,
    );
    assert.deepEqual(
      (await separate(target(privateView) + "?version=2")).view.config,
      next,
    );
    assert.equal(
      (await separate(reports + "preview", "POST", { config })).status,
      200,
    );
    assert.equal((await (await client())(views)).status, 401);
  },
);
test(
  "calendar reports include all matching current dates, names, progress, versions and exact coordinates in EN/ES/FR; CSV titles are neutralized and reads preserve research/history",
  { timeout: 120000 },
  async () => {
    const c = await setup(),
      tasksBefore = await c.local.list(
        "libraryCollectionTask",
        c.actor.workspaceId,
      ),
      historyBefore = await c.local.list(
        "libraryTaskActivity",
        c.actor.workspaceId,
      ),
      handoff = await c.owner(c.g.path);
    for (const language of ["en", "es", "fr"] as const) {
      const config = cfg(c.g.collection.id, { language }),
        p = await preview(c, config);
      assert.equal(p.status, 200);
      assert.equal(p.rows.length, 2);
      assert.deepEqual(
        p.rows.map((r: any) => r.at(-1)),
        c.tasks.slice(0, 2).map((t) => t.id),
      );
      assert.equal(p.rows[1][0], "2028-02-29");
      assert.equal(p.rows[1][3], c.person.name);
      assert.equal(p.rows[1][4], actionLabels[language].in_progress);
      assert.equal(p.headers[6], operationsReportLabels[language].version);
      for (const format of ["csv", "txt"]) {
        const file = await download(c, config, p, { format });
        assert.equal(file.status, 200);
        assert.ok(file.bytes.toString().includes(c.tasks[0].id));
        for (const forbidden of [
          "PRIVATE_INBOX_SUMMARY",
          c.person.email,
          "transcript",
          "source.scope",
        ])
          assert.equal(file.bytes.toString().includes(forbidden), false);
        if (format === "csv")
          assert.ok(
            file.bytes.toString().includes("'=PRIVATE_PLANNING_FORMULA"),
          );
      }
      const selected = {
        ...config,
        filters: { ...config.filters, day: "2028-02-29", status: "all" },
      };
      assert.equal((await preview(c, selected)).rows.length, 2);
      const undated = {
        ...config,
        filters: { ...config.filters, window: "undated" },
      };
      assert.equal((await preview(c, undated)).rows[0].at(-1), c.tasks[2].id);
      const mine = {
        ...config,
        filters: { ...config.filters, assignee: "mine" },
      };
      assert.equal((await preview(c, mine)).rows.length, 1);
    }
    assert.deepEqual(
      await c.local.list("libraryCollectionTask", c.actor.workspaceId),
      tasksBefore,
    );
    assert.deepEqual(
      await c.local.list("libraryTaskActivity", c.actor.workspaceId),
      historyBefore,
    );
    assert.deepEqual((await c.owner(c.g.path)).packet, handoff.packet);
  },
);
test(
  "reviewed deadline exports reject changed config, rows, versions, names, sessions and roles; preview and review cannot be forged",
  { timeout: 120000 },
  async () => {
    const c = await setup(),
      config = cfg(c.g.collection.id),
      p = await preview(c, config);
    for (const extra of [
      { reviewed: false },
      { reviewed: undefined },
      { signature: "forged" },
      { format: "pdf" },
      { rows: [] },
    ])
      assert.equal((await download(c, config, p, extra)).status, 400);
    assert.equal(
      (await download(c, { ...config, timeZone: "UTC" }, p)).status,
      409,
    );
    const separate = await client();
    await separate("auth/login", "POST", {
      email: c.person.email,
      password: c.person.password,
    });
    assert.equal(
      (
        await separate(reports + "export", "POST", {
          config,
          signature: p.signature,
          reviewed: true,
          format: "txt",
        })
      ).status,
      409,
    );
    await c.local.db
      .prepare("UPDATE users SET name='Current planning name' WHERE id=?")
      .run(c.person.id);
    assert.equal((await download(c, config, p)).status, 409);
    const fresh = await preview(c, config),
      t = c.tasks[0];
    await c.owner(
      `library/collections/${t.collectionId}/tasks/${t.id}`,
      "PUT",
      {
        version: t.version,
        title: t.title,
        assigneeId: t.assigneeId,
        status: "completed",
        dueDate: t.dueDate,
      },
    );
    assert.equal((await download(c, config, fresh)).status, 409);
    const newest = await preview(c, config);
    await c.local.db
      .prepare("UPDATE users SET role='viewer' WHERE id=?")
      .run(c.actor.id);
    assert.equal((await download(c, config, newest)).status, 409);
    const reader = await preview(c, config);
    assert.equal((await download(c, config, reader)).status, 200);
    const foreign = await client();
    await foreign("auth/signup", "POST", {
      name: "Foreign planner",
      email: randomUUID() + "@example.test",
      password: "planning-test-password",
    });
    const hidden = await foreign(reports + "preview", "POST", { config });
    assert.equal(hidden.rows.length, 0);
    assert.equal(JSON.stringify(hidden).includes(c.tasks[0].title), false);
  },
);
test(
  "erasure leaves exact planning/report presets and pins while revoking old exports and clearing current task rows without widening unavailable scopes",
  { timeout: 120000 },
  async () => {
    const c = await setup(),
      config = cfg(c.g.collection.id),
      a = (await c.owner(views, "POST", content(config, "shared"))).view,
      b = (await c.owner(views, "POST", content(wrap(config), "shared"))).view;
    await c.owner(pins + "/shared", "PUT", {
      version: 0,
      viewIds: [a.id, b.id],
    });
    const p = await preview(c, config);
    await c.owner(
      `studies/${c.imports[0].s.id}/responses/${c.imports[0].interviewId}`,
      "DELETE",
    );
    assert.equal((await download(c, config, p)).status, 409);
    for (const v of [a, b])
      assert.deepEqual(
        (await c.owner(target(v) + "?version=1")).view.config,
        v.config,
      );
    assert.deepEqual((await c.owner(pins)).shared.viewIds, [a.id, b.id]);
    const empty = await preview(c, config);
    assert.equal(empty.rows.length, 0);
    assert.equal((await download(c, config, empty)).status, 200);
    const unavailable = {
      ...config,
      filters: {
        ...config.filters,
        collectionId: randomUUID(),
        assignee: randomUUID(),
      },
    };
    assert.equal((await preview(c, unavailable)).rows.length, 0);
    assert.equal(
      JSON.stringify(await c.owner("library/action-center")).includes(
        c.tasks[0].title,
      ),
      false,
    );
  },
);
test(
  "calendar exports reject more than 1000 matching tasks instead of truncating and allow an exact narrower day",
  { timeout: 120000 },
  async () => {
    const c = await setup(),
      record = (
        await c.local.list<any>("libraryCollectionTask", c.actor.workspaceId)
      )[0];
    for (let i = 0; i < 1001; i++)
      await c.local.put("libraryCollectionTask", {
        ...record,
        id: randomUUID(),
        requestId: randomUUID(),
        title: "Bounded calendar task",
        dueDate: "2028-02-01",
        status: "open",
      });
    const config = cfg(c.g.collection.id);
    assert.equal((await preview(c, config)).status, 413);
    assert.equal(
      (
        await preview(c, {
          ...config,
          filters: { ...config.filters, day: "2028-02-29" },
        })
      ).rows.length,
      1,
    );
  },
);
