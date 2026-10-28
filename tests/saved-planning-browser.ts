import { chromium, type Browser, type Locator } from "playwright";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { start, stop, base } from "./harness";
import { inboxSetup } from "./team-review-inbox-fixture";
import { calendarLabels } from "../src/lib/follow-up-calendar";
import { actionLabels } from "../src/lib/research-action-center";
import { operationsReportLabels } from "../src/lib/operations-report";
import { savedViewLabels } from "../src/lib/saved-review-views";
import { operationsLabels } from "../src/lib/research-operations";
import { operationsWorkspaceLabels } from "../src/lib/operations-workspace";
async function guarded(l: Locator) {
  for (let i = 0; i < 50; i++) {
    if (await l.isDisabled()) return;
    await new Promise((r) => setTimeout(r, 50));
  }
  assert.equal(await l.isDisabled(), true);
}
let browser: Browser | undefined;
try {
  await start({ port: 3425 });
  const c = await inboxSetup(),
    groups: any[] = [];
  for (const language of ["en", "es", "fr"] as const) {
    const g: any = await c.create("Saved planning " + language);
    g.language = language;
    g.tasks = [];
    for (const dueDate of ["2028-02-29", "2028-03-01", null]) {
      const r = await c.owner(
        `library/collections/${g.collection.id}/tasks`,
        "POST",
        {
          requestId: randomUUID(),
          title: `Planning ${language} ${g.tasks.length}`,
          assigneeId: c.actor.id,
          status: "open",
          dueDate,
          target: { kind: "interview", id: c.imports[0].interviewId },
        },
      );
      assert.equal(r.status, 201);
      g.tasks.push(r.task);
    }
    groups.push(g);
  }
  browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_PATH || "/usr/bin/chromium",
    args: ["--no-sandbox"],
  });
  const ctx = await browser.newContext({
      viewport: { width: 390, height: 844 },
      timezoneId: "America/Los_Angeles",
      acceptDownloads: true,
    }),
    page = await ctx.newPage(),
    errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await ctx.request.post(base + "/api/auth/login", {
    data: { email: c.email, password: "saved-library-password" },
  });
  async function home() {
    await page.goto(base);
    await page
      .getByRole("button", { name: "Research library", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Operations home", exact: true })
      .click();
    await page
      .getByLabel(operationsLabels.en.choose, { exact: true })
      .waitFor();
  }
  async function openSaved(id: string) {
    await home();
    await page
      .getByLabel(operationsLabels.en.choose, { exact: true })
      .selectOption(id);
    await page
      .getByRole("button", { name: operationsLabels.en.apply, exact: true })
      .click();
  }
  async function save(
    saved: Locator,
    sl: any,
    name: string,
    visibility = "shared",
  ) {
    await saved.getByRole("button", { name: sl.save, exact: true }).click();
    await saved.getByLabel(sl.name, { exact: true }).fill(name);
    await saved
      .getByLabel(sl.visibility, { exact: true })
      .selectOption(visibility);
    await saved.getByRole("button", { name: sl.save, exact: true }).click();
    await saved.getByText(sl.saved, { exact: true }).waitFor();
    return saved.getByLabel(sl.choose, { exact: true }).inputValue();
  }
  for (const g of groups) {
    const lang = g.language as "en",
      a = actionLabels[lang],
      l = calendarLabels[lang],
      r = operationsReportLabels[lang],
      s = savedViewLabels[lang];
    await page.goto(base);
    await page
      .getByRole("button", { name: "Research library", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Action center", exact: true })
      .click();
    if (lang !== "en")
      await page
        .getByLabel(actionLabels.en.language, { exact: true })
        .selectOption(lang);
    let panel = page.getByRole("region", { name: a.title, exact: true });
    await panel.getByRole("button", { name: l.title, exact: true }).click();
    let cal = panel.getByRole("region", { name: l.title, exact: true });
    await cal
      .getByLabel(a.collection, { exact: true })
      .selectOption(g.collection.id);
    await cal.getByLabel(l.month, { exact: true }).fill("2028-02");
    await cal.locator('[data-calendar-day="2028-02-29"]').click();
    await cal.getByLabel(a.assignee, { exact: true }).selectOption("mine");
    await cal.getByLabel(a.query, { exact: true }).fill("Planning " + lang);
    let report = cal.getByRole("region", { name: r.title, exact: true });
    await report.getByLabel(r.timeZone, { exact: true }).fill("Asia/Tokyo");
    let planning = panel.getByRole("region", {
      name: s.calendarTitle,
      exact: true,
    });
    await planning.getByRole("button", { name: s.save, exact: true }).click();
    await planning
      .getByLabel(s.name, { exact: true })
      .fill("Planning view " + lang);
    await planning
      .getByLabel(s.visibility, { exact: true })
      .selectOption("shared");
    await guarded(cal.getByLabel(l.month, { exact: true }));
    await guarded(panel.getByLabel(a.language, { exact: true }));
    await planning.getByRole("button", { name: s.save, exact: true }).click();
    await planning.getByText(s.saved, { exact: true }).waitFor();
    g.viewId = await planning
      .getByLabel(s.choose, { exact: true })
      .inputValue();
    await openSaved(g.viewId);
    panel = page.getByRole("region", { name: a.title, exact: true });
    cal = panel.getByRole("region", { name: l.title, exact: true });
    report = cal.getByRole("region", { name: r.title, exact: true });
    await cal.locator(`[data-calendar-task="${g.tasks[0].id}"]`).waitFor();
    assert.equal(
      await cal.getByLabel(l.month, { exact: true }).inputValue(),
      "2028-02",
    );
    assert.equal(
      await cal
        .locator('[data-calendar-day="2028-02-29"]')
        .getAttribute("aria-pressed"),
      "true",
    );
    assert.equal(
      await cal.getByLabel(a.assignee, { exact: true }).inputValue(),
      "mine",
    );
    assert.equal(
      await report.getByLabel(r.timeZone, { exact: true }).inputValue(),
      "Asia/Tokyo",
    );
    assert.equal(await report.getByRole("checkbox").count(), 0);
    const reportSaved = report.getByRole("region", {
      name: s.reportTitle,
      exact: true,
    });
    g.reportId = await save(reportSaved, s, "Deadline report " + lang);
    await report.getByRole("button", { name: r.generate, exact: true }).click();
    await report.getByText(`${r.rows}: 1`, { exact: true }).waitFor();
    await guarded(cal.getByLabel(l.month, { exact: true }));
    await guarded(
      panel
        .getByRole("region", { name: s.calendarTitle, exact: true })
        .getByRole("button", { name: s.apply, exact: true }),
    );
    await guarded(cal.getByRole("button", { name: l.reschedule, exact: true }));
    assert.equal(
      await report
        .getByRole("button", { name: r.csv, exact: true })
        .isDisabled(),
      true,
    );
    await report.getByLabel(r.reviewed, { exact: true }).check();
    const downloadPromise = page.waitForEvent("download");
    await report.getByRole("button", { name: r.csv, exact: true }).click();
    const file = await downloadPromise;
    const path = await file.path();
    assert.ok(path);
    const bytes = await readFile(path!, "utf8");
    assert.ok(bytes.includes(g.tasks[0].id));
    assert.equal(bytes.includes(g.tasks[1].id), false);
    await report.screenshot({
      path: `test-results/planning-report-${lang}.png`,
    });
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth,
      ),
      false,
    );
    await report.getByRole("button", { name: r.close, exact: true }).click();
    await home();
    await page
      .getByLabel(operationsLabels.en.choose, { exact: true })
      .selectOption(g.viewId);
    await page
      .getByRole("button", {
        name: operationsWorkspaceLabels.en.pinTeam,
        exact: true,
      })
      .click();
    await page.locator(`[data-operation-pin="${g.viewId}"]`).waitFor();
    await page
      .locator(`[data-operation-pin="${g.viewId}"]`)
      .getByRole("button", {
        name: operationsWorkspaceLabels.en.open,
        exact: true,
      })
      .click();
    await page
      .getByRole("region", { name: l.title, exact: true })
      .getByLabel(l.month, { exact: true })
      .waitFor();
    await openSaved(g.reportId);
    report = page.getByRole("region", { name: r.title, exact: true });
    await report.getByLabel(r.timeZone, { exact: true }).waitFor();
    assert.equal(await report.getByRole("checkbox").count(), 0);
    assert.equal(
      await page.getByLabel(a.query, { exact: true }).inputValue(),
      "Planning " + lang,
    );
  }
  // Stale planning views fail rather than opening a changed scope.
  await home();
  await page
    .getByLabel(operationsLabels.en.choose, { exact: true })
    .selectOption(groups[0].viewId);
  const old = (await c.owner(`library/saved-review-views/${groups[0].viewId}`))
    .view;
  await c.owner(`library/saved-review-views/${old.id}`, "PUT", {
    version: old.version,
    name: old.name,
    visibility: old.visibility,
    config: {
      ...old.config,
      filters: { ...old.config.filters, query: "changed" },
    },
  });
  await page
    .getByRole("button", { name: operationsLabels.en.apply, exact: true })
    .click();
  await page
    .getByText(operationsLabels.en.unavailable, { exact: true })
    .waitFor();
  // A changed task revokes the reviewed export; regenerating after source erasure yields an empty exact scope.
  await openSaved(groups[0].reportId);
  const r = operationsReportLabels.en;
  let report = page.getByRole("region", { name: r.title, exact: true });
  await report.getByRole("button", { name: r.generate, exact: true }).click();
  await report.getByText(`${r.rows}: 1`, { exact: true }).waitFor();
  const t = groups[0].tasks[0];
  await c.owner(`library/collections/${t.collectionId}/tasks/${t.id}`, "PUT", {
    version: t.version,
    title: t.title,
    assigneeId: t.assigneeId,
    status: "open",
    dueDate: "2028-03-01",
  });
  await report.getByLabel(r.reviewed, { exact: true }).check();
  await report.getByRole("button", { name: r.csv, exact: true }).click();
  await report.getByRole("alert").waitFor();
  assert.equal(await report.getByLabel(r.reviewed, { exact: true }).count(), 0);
  await c.owner(
    `studies/${c.imports[0].s.id}/responses/${c.imports[0].interviewId}`,
    "DELETE",
  );
  await openSaved(groups[0].reportId);
  report = page.getByRole("region", { name: r.title, exact: true });
  await report.getByRole("button", { name: r.generate, exact: true }).click();
  await report.getByText(`${r.rows}: 0`, { exact: true }).waitFor();
  await report.getByRole("button", { name: r.close, exact: true }).click();
  await c.local.db
    .prepare("UPDATE users SET role='viewer' WHERE id=?")
    .run(c.person.id);
  const reader = await browser.newContext({
    viewport: { width: 390, height: 844 },
  });
  await reader.request.post(base + "/api/auth/login", {
    data: { email: c.person.email, password: c.person.password },
  });
  const rp = await reader.newPage();
  await rp.goto(base);
  await rp
    .getByRole("button", { name: "Research library", exact: true })
    .click();
  await rp
    .getByRole("button", { name: "Operations home", exact: true })
    .click();
  await rp
    .locator(`[data-operation-pin="${groups[1].viewId}"]`)
    .getByRole("button", {
      name: operationsWorkspaceLabels.en.open,
      exact: true,
    })
    .click();
  await rp
    .getByRole("region", { name: calendarLabels.es.title, exact: true })
    .waitFor();
  assert.equal(
    await rp
      .getByRole("button", { name: calendarLabels.es.reschedule, exact: true })
      .count(),
    0,
  );
  const readerSaved = rp.getByRole("region", {
    name: savedViewLabels.es.calendarTitle,
    exact: true,
  });
  await readerSaved
    .getByLabel(savedViewLabels.es.choose, { exact: true })
    .selectOption(groups[1].viewId);
  await readerSaved
    .getByRole("button", { name: savedViewLabels.es.copy, exact: true })
    .click();
  await readerSaved
    .getByText(savedViewLabels.es.copied, { exact: true })
    .waitFor();
  await reader.close();
  assert.deepEqual(errors, []);
  await ctx.close();
  console.log(
    "EN/ES/FR mobile saved planning: exact month/day/assignment/language/time-zone restoration, draft/report locks, reviewed CSV, team pins, fresh report presets, stale-view rejection, changed-row export recovery, erased-source empty scopes and reader copies passed.",
  );
} finally {
  await browser?.close();
  await stop();
}
