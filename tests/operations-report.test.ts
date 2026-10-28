import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { start, stop } from "./harness";
import { inboxSetup } from "./team-review-inbox-fixture";
import { client } from "./image-review-fixture";
import { defaultTaskActivityFilters } from "../src/lib/task-activity";
import { operationsReportFile } from "../src/lib/operations-report";
before(() => start({ port: 3416 }), { timeout: 90000 });
after(stop);
const root = "library/operations-report/";
const workload = (collectionId = "", extra: any = {}) => ({
  kind: "workload",
  filters: { collectionId, query: "", show: "all" },
  language: "en",
  timeZone: "America/Los_Angeles",
  ...extra,
});
const history = (collectionId = "", extra: any = {}) => {
  const { page: _, ...f } = defaultTaskActivityFilters;
  return {
    kind: "task_activity",
    filters: { ...f, collectionId, ...extra },
    language: "en",
    timeZone: "America/Los_Angeles",
  };
};
const preview = (c: any, config: any) =>
  c.owner(root + "preview", "POST", { config });
const download = (c: any, config: any, p: any, extra: any = {}) =>
  c.owner(root + "export", "POST", {
    config,
    signature: p.signature,
    reviewed: true,
    format: "csv",
    ...extra,
  });
async function setup() {
  const c = await inboxSetup(),
    g = await c.create("Synthetic operations report");
  const t = (
    await c.owner(`library/collections/${g.collection.id}/tasks`, "POST", {
      requestId: randomUUID(),
      title: "PRIVATE_COORDINATION_TITLE",
      assigneeId: c.person.id,
      dueDate: "2028-02-29",
      status: "open",
      target: { kind: "interview", id: c.imports[0].interviewId },
    })
  ).task;
  return { ...c, g, t };
}
test(
  "reports strictly validate explicit filters, dates, timezone, format and acknowledgement; anonymous and foreign workspaces cannot export another workspace",
  { timeout: 120000 },
  async () => {
    const c = await setup(),
      cfg = workload(c.g.collection.id),
      p = await preview(c, cfg);
    assert.equal(p.status, 200);
    for (const config of [
      { ...cfg, today: "2028-01-01" },
      { ...cfg, language: "de" },
      { ...cfg, timeZone: "invalid" },
      { ...cfg, filters: { ...cfg.filters, page: 0 } },
      history("", { from: "2027-02-29" }),
      history("", { from: "2028-03-01", to: "2028-02-29" }),
      history("", { action: "unknown" }),
      history("", { page: 0 }),
    ])
      assert.equal((await preview(c, config)).status, 400);
    for (const extra of [
      { reviewed: false },
      { reviewed: undefined },
      { format: "pdf" },
      { signature: "forged" },
      { rows: [["injected"]] },
    ])
      assert.equal((await download(c, cfg, p, extra)).status, 400);
    assert.equal((await c.owner(root + "preview")).status, 405);
    assert.equal(
      (await c.owner(root + "preview?x=1", "POST", { config: cfg })).status,
      400,
    );
    assert.equal((await c.owner(root + "other", "POST", {})).status, 404);
    assert.equal(
      (await (await client())(root + "preview", "POST", { config: cfg }))
        .status,
      401,
    );
    const foreign = await client();
    await foreign("auth/signup", "POST", {
      name: "Foreign",
      email: randomUUID() + "@example.test",
      password: "synthetic-report-password",
    });
    const f = await foreign(root + "preview", "POST", { config: cfg });
    assert.equal(
      JSON.stringify(f).includes("PRIVATE_COORDINATION_TITLE"),
      false,
    );
    assert.equal(f.rows[0][1], 0);
    assert.equal(
      (
        await foreign(root + "export", "POST", {
          config: cfg,
          signature: p.signature,
          format: "csv",
          reviewed: true,
        })
      ).status,
      409,
    );
  },
);
test(
  "workload exports current scoped totals and row visibility in every language without changing original tasks, history or review state",
  { timeout: 120000 },
  async () => {
    const c = await setup(),
      snap = await c.local.list("libraryTaskActivity", c.actor.workspaceId),
      tasks = await c.local.list("libraryCollectionTask", c.actor.workspaceId),
      handoff = await c.owner(c.g.path);
    for (const language of ["en", "es", "fr"]) {
      const cfg = workload(c.g.collection.id, { language });
      cfg.filters.show = "active";
      const p = await preview(c, cfg);
      assert.equal(p.rows.length, 2);
      assert.equal(p.rows[0][1], 1);
      assert.equal(p.rows[1][0], c.person.name);
      for (const format of ["csv", "txt"]) {
        const r = await download(c, cfg, p, { format });
        assert.equal(r.status, 200);
        for (const label of p.headers)
          assert.ok(r.bytes.toString().includes(label));
        for (const forbidden of [
          "PRIVATE_INBOX_SUMMARY",
          c.person.email,
          "transcript",
          "source.scope",
        ])
          assert.equal(r.bytes.toString().includes(forbidden), false);
      }
    }
    assert.deepEqual(
      await c.local.list("libraryTaskActivity", c.actor.workspaceId),
      snap,
    );
    assert.deepEqual(
      await c.local.list("libraryCollectionTask", c.actor.workspaceId),
      tasks,
    );
    assert.deepEqual((await c.owner(c.g.path)).packet, handoff.packet);
  },
);
test(
  "activity reports include every filtered retained event beyond UI pagination and respect local dates, current names, title flags and retention metadata",
  { timeout: 120000 },
  async () => {
    const c = await setup();
    let t = c.t;
    for (let i = 0; i < 21; i++)
      t = (
        await c.person.call(
          `library/collections/${t.collectionId}/tasks/${t.id}`,
          "PUT",
          {
            version: t.version,
            title: i % 2 ? "Current report task" : "Renamed report task",
            assigneeId: t.assigneeId,
            dueDate: t.dueDate,
            status: i % 2 ? "open" : "in_progress",
          },
        )
      ).task;
    const record = (
      await c.local.list<any>("libraryTaskActivity", c.actor.workspaceId)
    ).find((r: any) => r.id === t.id);
    record.events.forEach(
      (e: any, i: number) =>
        (e.at =
          i === 0 ? "2028-02-29T07:30:00.000Z" : "2028-02-29T08:30:00.000Z"),
    );
    record.omitted = 5;
    await c.local.put("libraryTaskActivity", record);
    let cfg = history(t.collectionId),
      p = await preview(c, cfg);
    assert.equal(p.rows.length, 22);
    assert.equal(
      (await c.owner("library/task-activity?collectionId=" + t.collectionId))
        .events.length,
      20,
    );
    assert.equal(p.metadata.at(-1)[1], "5");
    cfg = history(t.collectionId, {
      from: "2028-02-29",
      to: "2028-02-29",
      personId: c.person.id,
      action: "task_updated",
      field: "title",
    });
    p = await preview(c, cfg);
    assert.equal(p.rows.length, 21);
    const csv = await download(c, cfg, p);
    assert.equal(csv.status, 200);
    assert.equal(
      csv.bytes.toString().includes("PRIVATE_COORDINATION_TITLE"),
      false,
    );
    assert.equal(
      p.rows.every((r: any[]) => r[2] === t.title),
      true,
    );
    await c.local.db
      .prepare("UPDATE users SET name='Renamed current reporter' WHERE id=?")
      .run(c.person.id);
    assert.equal((await download(c, cfg, p)).status, 409);
    p = await preview(c, cfg);
    assert.equal(
      p.rows.every((r: any[]) => r[3] === "Renamed current reporter"),
      true,
    );
  },
);
test(
  "download revalidates reviewed content, role, filters and source erasure; readers can generate fresh reports without shared storage",
  { timeout: 120000 },
  async () => {
    const c = await setup(),
      cfg = workload(c.g.collection.id),
      p = await preview(c, cfg),
      hcfg = history(c.t.collectionId),
      hp = await preview(c, hcfg);
    await c.local.db
      .prepare("UPDATE users SET role='viewer' WHERE id=?")
      .run(c.actor.id);
    assert.equal((await download(c, cfg, p)).status, 409);
    const reader = await preview(c, cfg);
    assert.equal((await download(c, cfg, reader)).status, 200);
    await c.local.db
      .prepare("UPDATE users SET role='admin' WHERE id=?")
      .run(c.actor.id);
    const changed = (
      await c.owner(
        `library/collections/${c.t.collectionId}/tasks/${c.t.id}`,
        "PUT",
        {
          version: c.t.version,
          title: c.t.title,
          assigneeId: c.t.assigneeId,
          dueDate: null,
          status: "completed",
        },
      )
    ).task;
    assert.ok(changed);
    assert.equal((await download(c, cfg, p)).status, 409);
    assert.equal((await download(c, hcfg, hp)).status, 409);
    const fresh = await preview(c, hcfg);
    await c.owner(
      `studies/${c.imports[0].s.id}/responses/${c.imports[0].interviewId}`,
      "DELETE",
    );
    assert.equal((await download(c, hcfg, fresh)).status, 409);
    const erased = await preview(c, hcfg);
    assert.equal(erased.rows.length, 0);
    assert.equal((await download(c, hcfg, erased)).status, 200);
    assert.equal(
      JSON.stringify(
        await c.local.list("libraryCollectionTask", c.actor.workspaceId),
      ).includes(c.t.title),
      false,
    );
  },
);
test(
  "CSV neutralizes spreadsheet formulas and quotes multiline user labels; activity caps reject oversized reports rather than truncate",
  { timeout: 120000 },
  async () => {
    const file = operationsReportFile(
      {
        signature: "",
        generatedAt: "2028-01-01",
        metadata: [[" =FORMULA", 'quote"\nline']],
        headers: ["name"],
        rows: [["@SUM(1,1)"], ["\t=1"], ["-1"], ["normal,comma"]],
      },
      "csv",
    );
    assert.ok(file.includes('"\' =FORMULA"'));
    assert.ok(file.includes('"quote""\nline"'));
    assert.ok(file.includes('"\'@SUM(1,1)"'));
    assert.ok(file.includes('"\'\t=1"'));
    assert.ok(file.includes('"normal,comma"'));
    const c = await setup(),
      record = (
        await c.local.list<any>("libraryTaskActivity", c.actor.workspaceId)
      )[0];
    record.events = Array.from({ length: 1001 }, (_, i) => ({
      ...record.events[0],
      id: randomUUID(),
      sequence: i + 1,
    }));
    await c.local.put("libraryTaskActivity", record);
    assert.equal((await preview(c, history(c.t.collectionId))).status, 413);
    assert.equal(
      (await preview(c, history(c.t.collectionId, { taskId: randomUUID() })))
        .status,
      200,
    );
  },
);
