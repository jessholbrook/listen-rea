import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { start, stop } from "./harness";
import { client } from "./image-review-fixture";
import { combinedSetup } from "./combined-planning-fixture";
import { feedbackAction } from "./team-review-inbox-fixture";
import { unifiedLabels, planningRows } from "../src/lib/unified-planning";
import { unifiedReportLabels } from "../src/lib/unified-report";
before(() => start({ port: 3428 }), { timeout: 90000 });
after(stop);
const views = "library/saved-review-views",
  reports = "library/operations-report/",
  pins = "library/operations-pins";
const wrap = (config: any) => ({ kind: "report_unified", report: config });
const content = (config: any, visibility = "private") => ({
  name: "Combined scope",
  visibility,
  config,
});
const path = (v: any) => views + "/" + v.id;
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
test(
  "combined view/report configurations persist exact queue/person/calendar/completion/language/time-zone settings and reject invalid scopes, priority completion and copied approvals",
  { timeout: 120000 },
  async () => {
    const c = await combinedSetup();
    for (const language of ["en", "es", "fr"])
      for (const config of [
        { ...c.config, language },
        wrap({ ...c.config, language }),
      ]) {
        const saved = await c.owner(views, "POST", content(config));
        assert.equal(saved.status, 200);
        assert.deepEqual(saved.view.config, config);
      }
    for (const config of [
      { ...c.config, selected: [randomUUID()] },
      { ...c.config, reviewed: true },
      { ...c.config, language: "de" },
      { ...c.config, timeZone: "invalid" },
      ...[
        { month: "2101-01" },
        { month: "2028-13" },
        { day: "2028-03-01" },
        { day: "2028-02-30" },
        { window: "week", day: "2028-02-29" },
        { window: "undated", includeFinished: true },
        { kind: "packet" },
        { person: "admin" },
        { includeFinished: "true" },
        { query: "x".repeat(161) },
        { page: 1 },
      ].map((f) => ({ ...c.config, filters: { ...c.config.filters, ...f } })),
    ]) {
      for (const value of [config, wrap(config)])
        assert.equal(
          (await c.owner(views, "POST", content(value))).status,
          400,
        );
      assert.equal((await preview(c, config)).status, 400);
    }
    const stored = JSON.stringify(
      await c.local.list("librarySavedReviewView", c.actor.workspaceId),
    );
    for (const word of [
      "=COMBINED_TITLE",
      "signature",
      "reviewed",
      "rows",
      "PRIVATE_INBOX_SUMMARY",
      "selected",
    ])
      assert.equal(stored.includes(word), false);
  },
);
test(
  "private combined settings stay hidden from admins, shared views and pins preserve current permissions/versions, and readers can keep private copies across sessions",
  { timeout: 120000 },
  async () => {
    const c = await combinedSetup(),
      v = (await c.person.call(views, "POST", content(c.config))).view,
      shared = (await c.owner(views, "POST", content(wrap(c.config), "shared")))
        .view;
    assert.equal((await c.owner(path(v))).status, 404);
    assert.equal((await c.replacement.call(path(v))).status, 404);
    await c.local.db
      .prepare("UPDATE users SET role='viewer' WHERE id=?")
      .run(c.person.id);
    assert.equal(
      (await c.person.call(views, "POST", content(c.config, "shared"))).status,
      403,
    );
    assert.equal(
      (
        await c.person.call(path(shared), "PUT", {
          ...content(shared.config, "shared"),
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
          viewIds: [v.id, copy.id],
        })
      ).status,
      200,
    );
    assert.equal(
      (await c.owner(pins + "/shared", "PUT", { version: 0, viewIds: [v.id] }))
        .status,
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
      (await separate(path(v) + "?version=1")).view.config,
      c.config,
    );
    const changed = {
      ...c.config,
      filters: { ...c.config.filters, kind: "reviews", person: "mine" },
    };
    const edited = await c.person.call(path(v), "PUT", {
      ...content(changed),
      version: 1,
    });
    assert.equal(edited.view.version, 2);
    assert.equal((await separate(path(v) + "?version=1")).status, 409);
    assert.deepEqual(
      (await separate(path(v) + "?version=2")).view.config,
      changed,
    );
    assert.equal(
      (await separate(path(v), "DELETE", { version: 1 })).status,
      409,
    );
    assert.equal((await (await client())(views)).status, 401);
  },
);
test(
  "EN/ES/FR combined reports include every individual review request and task with current versions/coordinates, exact kind/person/day scopes and formula-safe files without research/history writes",
  { timeout: 120000 },
  async () => {
    const c = await combinedSetup();
    await c.owner("library/unified-planning");
    const snapshot = await c.local.db
      .prepare(
        "SELECT kind,id,data FROM documents WHERE workspace_id=? ORDER BY kind,id",
      )
      .all(c.actor.workspaceId);
    for (const language of ["en", "es", "fr"] as const) {
      const config = { ...c.config, language },
        p = await preview(c, config);
      assert.equal(p.status, 200);
      assert.equal(p.rows.length, 3);
      assert.equal(p.headers[9], unifiedReportLabels[language].reviewVersion);
      const requests = p.rows.filter(
        (r: any) => r[0] === unifiedLabels[language].reviews,
      );
      assert.equal(requests.length, 2);
      assert.equal(requests[0][11], requests[1][11]);
      assert.notEqual(requests[0][12], requests[1][12]);
      assert.equal(typeof requests[0][9], "number");
      for (const format of ["csv", "txt"]) {
        const file = await download(c, config, p, { format });
        assert.equal(file.status, 200);
        assert.ok(file.bytes.toString().includes(c.tasks[0].id));
        assert.ok(file.bytes.toString().includes(c.g.d.packet.id));
        assert.equal(file.bytes.toString().includes(c.person.email), false);
        assert.equal(
          file.bytes.toString().includes("PRIVATE_INBOX_SUMMARY"),
          false,
        );
        if (format === "csv")
          assert.ok(file.bytes.toString().includes("'=COMBINED_TITLE"));
      }
      for (const [extra, count] of [
        [{ kind: "tasks" }, 1],
        [{ kind: "reviews" }, 2],
        [{ person: "mine" }, 2],
        [{ includeFinished: true }, 4],
        [{ day: "2028-02-29" }, 3],
        [{ window: "undated" }, 1],
        [{ collectionId: randomUUID() }, 0],
        [{ person: randomUUID() }, 0],
      ] as [any, number][]) {
        assert.equal(
          (
            await preview(c, {
              ...config,
              filters: { ...config.filters, ...extra },
            })
          ).rows.length,
          count,
        );
      }
    }
    assert.deepEqual(
      await c.local.db
        .prepare(
          "SELECT kind,id,data FROM documents WHERE workspace_id=? ORDER BY kind,id",
        )
        .all(c.actor.workspaceId),
      snapshot,
    );
  },
);
test(
  "report fingerprints reject changed review coordination even when dates return to their original values, task versions, actor/role/config changes and unreviewed downloads",
  { timeout: 120000 },
  async () => {
    const c = await combinedSetup(),
      cfg = { ...c.config, filters: { ...c.config.filters, kind: "reviews" } },
      p = await preview(c, cfg);
    for (const extra of [
      { reviewed: false },
      { signature: "forged" },
      { rows: [] },
      { format: "pdf" },
    ])
      assert.equal((await download(c, cfg, p, extra)).status, 400);
    let d = await c.owner(c.g.path);
    for (const dueDate of ["2028-03-12", "2028-02-29"])
      d = await c.owner(
        c.g.path + "/feedback",
        "POST",
        feedbackAction(d, { op: "deadline", reviewerId: c.actor.id, dueDate }),
      );
    assert.equal((await download(c, cfg, p)).status, 409);
    const fresh = await preview(c, c.config),
      t = c.tasks[0];
    await c.owner(
      `library/collections/${t.collectionId}/tasks/${t.id}`,
      "PUT",
      {
        version: t.version,
        title: t.title,
        assigneeId: t.assigneeId,
        status: "open",
        dueDate: "2028-03-10",
      },
    );
    assert.equal((await download(c, c.config, fresh)).status, 409);
    const current = await preview(c, cfg);
    assert.equal(
      (await download(c, { ...cfg, timeZone: "UTC" }, current)).status,
      409,
    );
    const other = await c.person.call(reports + "export", "POST", {
      config: cfg,
      signature: current.signature,
      reviewed: true,
      format: "txt",
    });
    assert.equal(other.status, 409);
    await c.local.db
      .prepare("UPDATE users SET role='viewer' WHERE id=?")
      .run(c.actor.id);
    assert.equal((await download(c, cfg, current)).status, 409);
    const viewer = await preview(c, cfg);
    assert.equal((await download(c, cfg, viewer)).status, 200);
  },
);
test(
  "source erasure revokes combined exports while settings and pins retain exact empty scopes; foreign workspaces never receive rows from either kind",
  { timeout: 120000 },
  async () => {
    const c = await combinedSetup(),
      v = (await c.owner(views, "POST", content(c.config, "shared"))).view,
      r = (await c.owner(views, "POST", content(wrap(c.config), "shared")))
        .view;
    await c.owner(pins + "/shared", "PUT", {
      version: 0,
      viewIds: [v.id, r.id],
    });
    const p = await preview(c, c.config);
    const foreign = await client();
    await foreign("auth/signup", "POST", {
      name: "Foreign planner",
      email: randomUUID() + "@example.test",
      password: "combined-test-password",
    });
    assert.equal(
      (await foreign(reports + "preview", "POST", { config: c.config })).rows
        .length,
      0,
    );
    assert.equal(
      (
        await foreign(reports + "export", "POST", {
          config: c.config,
          signature: p.signature,
          reviewed: true,
          format: "csv",
        })
      ).status,
      409,
    );
    await c.owner(
      `studies/${c.imports[0].s.id}/responses/${c.imports[0].interviewId}`,
      "DELETE",
    );
    assert.equal((await download(c, c.config, p)).status, 409);
    for (const x of [v, r])
      assert.deepEqual(
        (await c.owner(path(x) + "?version=1")).view.config,
        x.config,
      );
    assert.deepEqual((await c.owner(pins)).shared.viewIds, [v.id, r.id]);
    const empty = await preview(c, c.config);
    assert.equal(empty.rows.length, 0);
    assert.equal((await download(c, c.config, empty)).status, 200);
  },
);
test(
  "combined reports reject over 1000 matching requests/tasks rather than truncate while narrowed scopes remain exportable",
  { timeout: 120000 },
  async () => {
    const c = await combinedSetup(),
      record = (
        await c.local.list<any>("libraryCollectionTask", c.actor.workspaceId)
      )[0];
    for (let i = 0; i < 1001; i++)
      await c.local.put("libraryCollectionTask", {
        ...record,
        id: randomUUID(),
        requestId: randomUUID(),
        title: "Bounded combined task",
        dueDate: "2028-02-01",
        status: "open",
      });
    assert.equal((await preview(c, c.config)).status, 413);
    const narrow = {
      ...c.config,
      filters: { ...c.config.filters, kind: "reviews" },
    };
    assert.equal((await preview(c, narrow)).rows.length, 2);
  },
);
