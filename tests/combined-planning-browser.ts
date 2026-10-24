import { chromium, type Browser, type Locator } from "playwright";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { start, stop, base } from "./harness";
import { combinedSetup } from "./combined-planning-fixture";
import { unifiedLabels } from "../src/lib/unified-planning";
import { calendarLabels } from "../src/lib/follow-up-calendar";
import { actionLabels } from "../src/lib/research-action-center";
import { savedViewLabels } from "../src/lib/saved-review-views";
import { operationsReportLabels } from "../src/lib/operations-report";
import { operationsLabels } from "../src/lib/research-operations";
import { operationsWorkspaceLabels } from "../src/lib/operations-workspace";
import { feedbackAction } from "./team-review-inbox-fixture";
async function guarded(control: Locator) {
  for (let i = 0; i < 50; i++) {
    if (await control.isDisabled()) return;
    await new Promise((r) => setTimeout(r, 50));
  }
  assert.equal(await control.isDisabled(), true);
}
let browser: Browser | undefined;
try {
  await start({ port: 3429 });
  const c = await combinedSetup();
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
    errors: string[] = [],
    stored: any[] = [];
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
  async function save(saved: Locator, s: any, name: string) {
    await saved.getByRole("button", { name: s.save, exact: true }).click();
    await saved.getByLabel(s.name, { exact: true }).fill(name);
    await saved
      .getByLabel(s.visibility, { exact: true })
      .selectOption("shared");
    await saved.getByRole("button", { name: s.save, exact: true }).click();
    await saved.getByText(s.saved, { exact: true }).waitFor();
    return saved.getByLabel(s.choose, { exact: true }).inputValue();
  }
  for (const language of ["en", "es", "fr"] as const) {
    const l = unifiedLabels[language],
      a = actionLabels[language],
      cl = calendarLabels[language],
      s = savedViewLabels[language],
      r = operationsReportLabels[language];
    await page.goto(base);
    await page
      .getByRole("button", { name: "Research library", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Research planning", exact: true })
      .click();
    if (language !== "en")
      await page
        .getByLabel(actionLabels.en.language, { exact: true })
        .selectOption(language);
    let panel = page.getByRole("region", { name: l.title, exact: true });
    await panel
      .getByLabel(a.collection, { exact: true })
      .selectOption(c.g.collection.id);
    await panel.getByLabel(cl.month, { exact: true }).fill("2028-02");
    await panel.locator('[data-planning-day="2028-02-29"]').click();
    await panel.getByLabel(l.person, { exact: true }).selectOption("mine");
    let report = panel.getByRole("region", { name: r.title, exact: true });
    await report.getByLabel(r.timeZone, { exact: true }).fill("Asia/Tokyo");
    const settings = panel.getByRole("region", {
      name: s.unifiedTitle,
      exact: true,
    });
    await settings.getByRole("button", { name: s.save, exact: true }).click();
    await settings
      .getByLabel(s.name, { exact: true })
      .fill("Combined view " + language);
    await settings
      .getByLabel(s.visibility, { exact: true })
      .selectOption("shared");
    await guarded(panel.getByLabel(cl.month, { exact: true }));
    await guarded(panel.getByLabel(a.language, { exact: true }));
    await settings.getByRole("button", { name: s.save, exact: true }).click();
    await settings.getByText(s.saved, { exact: true }).waitFor();
    const viewId = await settings
      .getByLabel(s.choose, { exact: true })
      .inputValue();
    await openSaved(viewId);
    panel = page.getByRole("region", { name: l.title, exact: true });
    await panel
      .locator(`[data-planning-item="task:${c.tasks[0].id}"]`)
      .waitFor();
    report = panel.getByRole("region", { name: r.title, exact: true });
    assert.equal(
      await panel.getByLabel(l.person, { exact: true }).inputValue(),
      "mine",
    );
    assert.equal(
      await panel.getByLabel(cl.month, { exact: true }).inputValue(),
      "2028-02",
    );
    assert.equal(
      await panel
        .locator('[data-planning-day="2028-02-29"]')
        .getAttribute("aria-pressed"),
      "true",
    );
    assert.equal(
      await report.getByLabel(r.timeZone, { exact: true }).inputValue(),
      "Asia/Tokyo",
    );
    assert.equal(await report.getByRole("checkbox").count(), 0);
    const reportId = await save(
      report.getByRole("region", { name: s.reportTitle, exact: true }),
      s,
      "Combined report " + language,
    );
    stored.push({ language, viewId, reportId });
    await report.getByRole("button", { name: r.generate, exact: true }).click();
    await report.getByText(`${r.rows}: 2`, { exact: true }).waitFor();
    await guarded(panel.getByLabel(cl.month, { exact: true }));
    await guarded(panel.getByLabel(a.language, { exact: true }));
    await guarded(
      panel.getByRole("button", { name: l.taskSchedule, exact: true }),
    );
    await guarded(panel.getByRole("button", { name: l.schedule, exact: true }));
    assert.equal(
      await report
        .getByRole("button", { name: r.csv, exact: true })
        .isDisabled(),
      true,
    );
    await report.getByLabel(r.reviewed, { exact: true }).check();
    const event = page.waitForEvent("download");
    await report.getByRole("button", { name: r.csv, exact: true }).click();
    const file = await event,
      path = await file.path();
    assert.ok(path);
    const bytes = await readFile(path!, "utf8");
    assert.ok(bytes.includes(c.tasks[0].id));
    assert.ok(bytes.includes(c.g.d.packet.id));
    assert.ok(bytes.includes(c.actor.id));
    assert.equal(bytes.includes(c.person.email), false);
    await report.screenshot({
      path: `test-results/combined-report-${language}.png`,
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
      .selectOption(viewId);
    await page
      .getByRole("button", {
        name: operationsWorkspaceLabels.en.pinTeam,
        exact: true,
      })
      .click();
    await page
      .locator(`[data-operation-pin="${viewId}"]`)
      .getByRole("button", {
        name: operationsWorkspaceLabels.en.open,
        exact: true,
      })
      .click();
    await page
      .getByRole("region", { name: l.title, exact: true })
      .getByLabel(l.person, { exact: true })
      .waitFor();
    await openSaved(reportId);
    report = page.getByRole("region", { name: r.title, exact: true });
    await report.getByLabel(r.timeZone, { exact: true }).waitFor();
    assert.equal(await report.getByRole("checkbox").count(), 0);
    assert.equal(
      await report.getByLabel(r.timeZone, { exact: true }).inputValue(),
      "Asia/Tokyo",
    );
  }
  // A cached view cannot apply changed settings.
  await home();
  await page
    .getByLabel(operationsLabels.en.choose, { exact: true })
    .selectOption(stored[0].viewId);
  const old = (await c.owner(`library/saved-review-views/${stored[0].viewId}`))
    .view;
  await c.owner(`library/saved-review-views/${old.id}`, "PUT", {
    version: old.version,
    name: old.name,
    visibility: old.visibility,
    config: {
      ...old.config,
      filters: { ...old.config.filters, kind: "reviews" },
    },
  });
  await page
    .getByRole("button", { name: operationsLabels.en.apply, exact: true })
    .click();
  await page
    .getByText(operationsLabels.en.unavailable, { exact: true })
    .waitFor();
  // Date changes followed by restoration still invalidate the old report via review version.
  await openSaved(stored[0].reportId);
  const r = operationsReportLabels.en;
  let report = page.getByRole("region", { name: r.title, exact: true });
  await report.getByRole("button", { name: r.generate, exact: true }).click();
  await report.getByText(`${r.rows}: 2`, { exact: true }).waitFor();
  let d = await c.owner(c.g.path);
  for (const dueDate of ["2028-03-12", "2028-02-29"])
    d = await c.owner(
      c.g.path + "/feedback",
      "POST",
      feedbackAction(d, { op: "deadline", reviewerId: c.actor.id, dueDate }),
    );
  await report.getByLabel(r.reviewed, { exact: true }).check();
  await report.getByRole("button", { name: r.csv, exact: true }).click();
  await report.getByRole("alert").waitFor();
  assert.equal(await report.getByLabel(r.reviewed, { exact: true }).count(), 0);
  await report.getByRole("button", { name: r.generate, exact: true }).click();
  await report.getByText(`${r.rows}: 2`, { exact: true }).waitFor();
  await report.getByRole("button", { name: r.close, exact: true }).click();
  // Readers open pinned combined views, generate current reports and keep private copies.
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
    .locator(`[data-operation-pin="${stored[1].viewId}"]`)
    .getByRole("button", {
      name: operationsWorkspaceLabels.en.open,
      exact: true,
    })
    .click();
  const sl = savedViewLabels.es,
    ul = unifiedLabels.es;
  await rp.getByRole("region", { name: ul.title, exact: true }).waitFor();
  assert.equal(
    await rp.getByRole("button", { name: ul.schedule, exact: true }).count(),
    0,
  );
  const saved = rp.getByRole("region", { name: sl.unifiedTitle, exact: true });
  await saved
    .getByLabel(sl.choose, { exact: true })
    .selectOption(stored[1].viewId);
  await saved.getByRole("button", { name: sl.copy, exact: true }).click();
  await saved.getByText(sl.copied, { exact: true }).waitFor();
  const rr = rp.getByRole("region", {
    name: operationsReportLabels.es.title,
    exact: true,
  });
  await rr
    .getByRole("button", {
      name: operationsReportLabels.es.generate,
      exact: true,
    })
    .click();
  await rr
    .getByText(`${operationsReportLabels.es.rows}: 1`, { exact: true })
    .waitFor();
  await reader.close();
  await c.owner(
    `studies/${c.imports[0].s.id}/responses/${c.imports[0].interviewId}`,
    "DELETE",
  );
  await openSaved(stored[0].reportId);
  report = page.getByRole("region", { name: r.title, exact: true });
  await report.getByRole("button", { name: r.generate, exact: true }).click();
  await report.getByText(`${r.rows}: 0`, { exact: true }).waitFor();
  assert.deepEqual(errors, []);
  await ctx.close();
  console.log(
    "EN/ES/FR mobile combined settings/reports: exact queue/person/month/day/language/time-zone restoration, draft/report locks, actual reviewed CSV, team pins, fresh report presets, stale-view recovery, restored-date review-version rejection, reader copies/reports and erased exact scopes passed.",
  );
} finally {
  await browser?.close();
  await stop();
}
