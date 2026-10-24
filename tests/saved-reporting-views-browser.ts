import { chromium, type Browser, type Locator } from "playwright";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { start, stop, base } from "./harness";
import { inboxSetup } from "./team-review-inbox-fixture";
import { actionLabels } from "../src/lib/research-action-center";
import { taskActivityLabels } from "../src/lib/task-activity";
import { followUpWorkloadLabels } from "../src/lib/follow-up-workload";
import { operationsReportLabels } from "../src/lib/operations-report";
import { savedViewLabels } from "../src/lib/saved-review-views";
import { operationsLabels } from "../src/lib/research-operations";
async function guarded(l: Locator) {
  for (let n = 0; n < 50; n++) {
    if (await l.isDisabled()) return;
    await new Promise((r) => setTimeout(r, 50));
  }
  assert.equal(await l.isDisabled(), true);
}
let browser: Browser | undefined;
try {
  await start({ port: 3419 });
  const c = await inboxSetup(),
    g = await c.create("Saved reporting browser");
  const task = (
    await c.owner(`library/collections/${g.collection.id}/tasks`, "POST", {
      requestId: randomUUID(),
      title: "Synthetic saved report task",
      assigneeId: c.person.id,
      status: "open",
      dueDate: null,
      target: { kind: "interview", id: c.imports[0].interviewId },
    })
  ).task;
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
  const stored: any[] = [];
  async function openSaved(id: string) {
    await page.goto(base);
    await page
      .getByRole("button", { name: "Research library", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Operations home", exact: true })
      .click();
    await page
      .getByLabel(operationsLabels.en.choose, { exact: true })
      .selectOption(id);
    await page
      .getByRole("button", { name: operationsLabels.en.apply, exact: true })
      .click();
  }
  for (const language of ["en", "es", "fr"] as const) {
    const al = actionLabels[language],
      wl = followUpWorkloadLabels[language],
      hl = taskActivityLabels[language],
      rl = operationsReportLabels[language],
      sl = savedViewLabels[language];
    await page.goto(base);
    await page
      .getByRole("button", { name: "Research library", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Action center", exact: true })
      .click();
    if (language !== "en")
      await page
        .getByLabel(actionLabels.en.language, { exact: true })
        .selectOption(language);
    let panel = page.getByRole("region", { name: al.title, exact: true });
    await panel.getByRole("button", { name: wl.title, exact: true }).click();
    let workload = panel.getByRole("region", { name: wl.title, exact: true });
    await workload
      .getByLabel(al.collection, { exact: true })
      .selectOption(g.collection.id);
    await workload
      .getByLabel(wl.query, { exact: true })
      .fill("Synthetic saved");
    await workload.getByLabel(wl.rows, { exact: true }).selectOption("active");
    let report = workload.getByRole("region", { name: rl.title, exact: true });
    await report.getByLabel(rl.timeZone, { exact: true }).fill("Asia/Tokyo");
    let saved = report.getByRole("region", {
      name: sl.reportTitle,
      exact: true,
    });
    await saved.getByRole("button", { name: sl.save, exact: true }).click();
    await saved
      .getByLabel(sl.name, { exact: true })
      .fill("Workload report " + language);
    await saved
      .getByLabel(sl.visibility, { exact: true })
      .selectOption("shared");
    await guarded(
      report.getByRole("button", { name: rl.generate, exact: true }),
    );
    await guarded(workload.getByLabel(wl.query, { exact: true }));
    await guarded(panel.getByLabel(al.language, { exact: true }));
    await saved.getByRole("button", { name: sl.save, exact: true }).click();
    await saved.getByText(sl.saved, { exact: true }).waitFor();
    const workloadId = await saved
      .getByLabel(sl.choose, { exact: true })
      .inputValue();
    await openSaved(workloadId);
    panel = page.getByRole("region", { name: al.title, exact: true });
    workload = panel.getByRole("region", { name: wl.title, exact: true });
    await workload.getByLabel(wl.query, { exact: true }).waitFor();
    assert.equal(
      await panel.getByLabel(al.language, { exact: true }).inputValue(),
      language,
    );
    assert.equal(
      await workload.getByLabel(wl.query, { exact: true }).inputValue(),
      "Synthetic saved",
    );
    assert.equal(
      await workload.getByLabel(wl.rows, { exact: true }).inputValue(),
      "active",
    );
    report = workload.getByRole("region", { name: rl.title, exact: true });
    assert.equal(
      await report.getByLabel(rl.timeZone, { exact: true }).inputValue(),
      "Asia/Tokyo",
    );
    assert.equal(await report.getByRole("checkbox").count(), 0);
    await report
      .getByRole("button", { name: rl.generate, exact: true })
      .click();
    await report.getByText(rl.rows + ": 2", { exact: true }).waitFor();
    await guarded(
      report
        .getByRole("region", { name: sl.reportTitle, exact: true })
        .getByRole("button", { name: sl.save, exact: true }),
    );
    assert.equal(
      await report.getByLabel(rl.reviewed, { exact: true }).isChecked(),
      false,
    );
    await report.getByRole("button", { name: rl.close, exact: true }).click();
    await panel.getByRole("button", { name: hl.title, exact: true }).click();
    const history = panel.getByRole("region", { name: hl.title, exact: true });
    await history.getByLabel(hl.task, { exact: true }).selectOption(task.id);
    await history.getByText(hl.matches + ": 1", { exact: true }).waitFor();
    report = history.getByRole("region", { name: rl.title, exact: true });
    await report.getByLabel(rl.timeZone, { exact: true }).fill("UTC");
    saved = report.getByRole("region", { name: sl.reportTitle, exact: true });
    await saved.getByRole("button", { name: sl.save, exact: true }).click();
    await saved
      .getByLabel(sl.name, { exact: true })
      .fill("Activity report " + language);
    await saved.getByRole("button", { name: sl.save, exact: true }).click();
    await saved.getByText(sl.saved, { exact: true }).waitFor();
    const activityId = await saved
      .getByLabel(sl.choose, { exact: true })
      .inputValue();
    stored.push({ language, workloadId, activityId });
    await openSaved(activityId);
    report = page.getByRole("region", { name: rl.title, exact: true });
    await report.getByLabel(rl.timeZone, { exact: true }).waitFor();
    assert.equal(
      await report.getByLabel(rl.timeZone, { exact: true }).inputValue(),
      "UTC",
    );
    assert.equal(
      await page.getByLabel(hl.task, { exact: true }).inputValue(),
      task.id,
    );
    assert.equal(await report.getByRole("checkbox").count(), 0);
    await report
      .getByRole("button", { name: rl.generate, exact: true })
      .click();
    await report.getByText(rl.rows + ": 1", { exact: true }).waitFor();
    await report.getByLabel(rl.reviewed, { exact: true }).check();
    const [download] = await Promise.all([
      page.waitForEvent("download"),
      report.getByRole("button", { name: rl.csv, exact: true }).click(),
    ]);
    assert.ok(
      (await readFile((await download.path())!, "utf8")).includes(task.id),
    );
    await report.getByRole("button", { name: rl.close, exact: true }).click();
    await report
      .getByRole("region", { name: sl.reportTitle, exact: true })
      .screenshot({
        path: `test-results/saved-reporting-views-${language}.png`,
      });
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth,
      ),
      false,
    );
  }
  // Reader copies stay private and cached updates require explicit refresh.
  await c.local.db
    .prepare("UPDATE users SET role='viewer' WHERE id=?")
    .run(c.person.id);
  const reader = await browser.newContext({
      viewport: { width: 390, height: 844 },
    }),
    rp = await reader.newPage();
  rp.on("pageerror", (e) => errors.push(e.message));
  await reader.request.post(base + "/api/auth/login", {
    data: { email: c.person.email, password: c.person.password },
  });
  await rp.goto(base);
  await rp
    .getByRole("button", { name: "Research library", exact: true })
    .click();
  await rp
    .getByRole("button", { name: "Operations home", exact: true })
    .click();
  assert.equal(
    await rp
      .getByLabel(operationsLabels.en.choose, { exact: true })
      .locator(`option[value="${stored[0].activityId}"]`)
      .count(),
    0,
  );
  await rp
    .getByLabel(operationsLabels.en.choose, { exact: true })
    .selectOption(stored[0].workloadId);
  await rp
    .getByRole("button", { name: operationsLabels.en.apply, exact: true })
    .click();
  const rs = rp.getByRole("region", {
    name: savedViewLabels.en.reportTitle,
    exact: true,
  });
  await rs
    .getByLabel(savedViewLabels.en.choose, { exact: true })
    .selectOption(stored[0].workloadId);
  assert.equal(
    await rs
      .getByRole("button", { name: savedViewLabels.en.update, exact: true })
      .count(),
    0,
  );
  await rs
    .getByRole("button", { name: savedViewLabels.en.copy, exact: true })
    .click();
  await rs.getByText(savedViewLabels.en.copied, { exact: true }).waitFor();
  const copyId = await rs
    .getByLabel(savedViewLabels.en.choose, { exact: true })
    .inputValue();
  assert.equal(
    (await c.owner("library/saved-review-views/" + copyId)).status,
    404,
  );
  await rs
    .getByLabel(savedViewLabels.en.choose, { exact: true })
    .selectOption(stored[0].workloadId);
  const old = (
    await c.owner("library/saved-review-views/" + stored[0].workloadId)
  ).view;
  await c.owner("library/saved-review-views/" + old.id, "PUT", {
    version: old.version,
    name: old.name,
    visibility: old.visibility,
    config: {
      ...old.config,
      report: {
        ...old.config.report,
        filters: { ...old.config.report.filters, query: "Changed elsewhere" },
      },
    },
  });
  await rs
    .getByRole("button", { name: savedViewLabels.en.apply, exact: true })
    .click();
  await rs.getByRole("alert").waitFor();
  assert.equal(
    await rp
      .getByLabel(followUpWorkloadLabels.en.query, { exact: true })
      .inputValue(),
    "Synthetic saved",
  );
  await rs
    .getByRole("button", { name: savedViewLabels.en.refresh, exact: true })
    .click();
  await rs
    .getByLabel(savedViewLabels.en.choose, { exact: true })
    .selectOption(old.id);
  await rs
    .getByRole("button", { name: savedViewLabels.en.apply, exact: true })
    .click();
  await rp
    .getByText(followUpWorkloadLabels.en.empty, { exact: true })
    .waitFor();
  // A persisted erased task scope opens exactly that scope and still requires a fresh preview.
  await c.owner(
    `studies/${c.imports[0].s.id}/responses/${c.imports[0].interviewId}`,
    "DELETE",
  );
  await openSaved(stored[0].activityId);
  const report = page.getByRole("region", {
    name: operationsReportLabels.en.title,
    exact: true,
  });
  await report
    .getByLabel(operationsReportLabels.en.timeZone, { exact: true })
    .waitFor();
  assert.equal(
    await page
      .getByLabel(taskActivityLabels.en.task, { exact: true })
      .inputValue(),
    task.id,
  );
  await report
    .getByRole("button", {
      name: operationsReportLabels.en.generate,
      exact: true,
    })
    .click();
  await report
    .getByText(operationsReportLabels.en.rows + ": 0", { exact: true })
    .waitFor();
  assert.equal(
    await report
      .getByLabel(operationsReportLabels.en.reviewed, { exact: true })
      .isChecked(),
    false,
  );
  assert.deepEqual(errors, []);
  await reader.close();
  await ctx.close();
  console.log(
    "Saved reporting views EN/ES/FR mobile: workload/history configuration persistence, language/timezone/visibility restoration, fresh preview/download review, guarded controls, private reader copies, stale recovery and exact erased scopes passed.",
  );
} finally {
  await browser?.close();
  await stop();
}
