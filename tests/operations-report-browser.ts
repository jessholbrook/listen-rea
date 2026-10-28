import { chromium, type Browser, type Locator } from "playwright";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { start, stop, base } from "./harness";
import { inboxSetup } from "./team-review-inbox-fixture";
import { operationsReportLabels } from "../src/lib/operations-report";
import { followUpWorkloadLabels } from "../src/lib/follow-up-workload";
import { actionLabels } from "../src/lib/research-action-center";
import { taskActivityLabels } from "../src/lib/task-activity";
async function guarded(l: Locator) {
  for (let n = 0; n < 50; n++) {
    if (await l.isDisabled()) return;
    await new Promise((r) => setTimeout(r, 50));
  }
  assert.equal(await l.isDisabled(), true);
}
let browser: Browser | undefined;
try {
  await start({ port: 3417 });
  const c = await inboxSetup(),
    g = await c.create("Report browser scope");
  const task = (
    await c.owner(`library/collections/${g.collection.id}/tasks`, "POST", {
      requestId: randomUUID(),
      title: "SYNTHETIC_REPORT_TASK",
      assigneeId: c.person.id,
      dueDate: "2028-02-29",
      status: "open",
      target: { kind: "interview", id: c.imports[0].interviewId },
    })
  ).task;
  browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_PATH || "/usr/bin/chromium",
    args: ["--no-sandbox"],
  });
  const context = await browser.newContext({
      viewport: { width: 390, height: 844 },
      timezoneId: "America/Los_Angeles",
      acceptDownloads: true,
    }),
    page = await context.newPage(),
    errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await context.request.post(base + "/api/auth/login", {
    data: { email: c.email, password: "saved-library-password" },
  });
  const exports: any[] = [];
  page.on("response", (r) => {
    if (r.url().endsWith("/api/library/operations-report/export"))
      exports.push(r);
  });
  for (const language of ["en", "es", "fr"] as const) {
    const l = operationsReportLabels[language],
      al = actionLabels[language],
      wl = followUpWorkloadLabels[language],
      hl = taskActivityLabels[language];
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
    const panel = page.getByRole("region", { name: al.title, exact: true });
    await panel.getByRole("button", { name: wl.title, exact: true }).click();
    const workload = panel.getByRole("region", { name: wl.title, exact: true });
    await workload
      .getByLabel(al.collection, { exact: true })
      .selectOption(g.collection.id);
    await workload
      .getByLabel(wl.query, { exact: true })
      .fill("SYNTHETIC_REPORT_TASK");
    let report = workload.getByRole("region", { name: l.title, exact: true });
    await report.getByRole("button", { name: l.generate, exact: true }).click();
    await report.getByText(l.rows + ": 4", { exact: true }).waitFor();
    await guarded(panel.getByLabel(al.language, { exact: true }));
    await guarded(workload.getByLabel(wl.query, { exact: true }));
    await guarded(panel.getByRole("button", { name: hl.title, exact: true }));
    await guarded(report.getByRole("button", { name: l.csv, exact: true }));
    await report.getByLabel(l.reviewed, { exact: true }).check();
    for (const format of ["csv", "txt"] as const) {
      const [download] = await Promise.all([
        page.waitForEvent("download"),
        report.getByRole("button", { name: l[format], exact: true }).click(),
      ]);
      const file = await readFile((await download.path())!, "utf8");
      assert.ok(file.includes(wl.title));
      assert.ok(file.includes(c.person.name));
      assert.equal(file.includes("PRIVATE_INBOX_SUMMARY"), false);
      assert.equal(
        download.suggestedFilename(),
        `echo-lab-operations-workload.${format}`,
      );
    }
    await report.screenshot({
      path: `test-results/operations-report-${language}.png`,
    });
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth,
      ),
      false,
    );
    await report.getByRole("button", { name: l.close, exact: true }).click();
    await panel.getByRole("button", { name: hl.title, exact: true }).click();
    const history = panel.getByRole("region", { name: hl.title, exact: true });
    await history.getByLabel(hl.task, { exact: true }).selectOption(task.id);
    await history.getByText(hl.matches + ": 1", { exact: true }).waitFor();
    report = history.getByRole("region", { name: l.title, exact: true });
    await report.getByRole("button", { name: l.generate, exact: true }).click();
    await report.getByText(l.rows + ": 1", { exact: true }).waitFor();
    await report.getByLabel(l.reviewed, { exact: true }).check();
    const [download] = await Promise.all([
      page.waitForEvent("download"),
      report.getByRole("button", { name: l.csv, exact: true }).click(),
    ]);
    assert.ok(
      (await readFile((await download.path())!, "utf8")).includes(
        "SYNTHETIC_REPORT_TASK",
      ),
    );
    await report.getByRole("button", { name: l.close, exact: true }).click();
  }
  // A changed task invalidates the reviewed activity export; no file or automatic retry occurs.
  let report = page.getByRole("region", {
    name: operationsReportLabels.fr.title,
    exact: true,
  });
  await report
    .getByRole("button", {
      name: operationsReportLabels.fr.generate,
      exact: true,
    })
    .click();
  await report
    .getByLabel(operationsReportLabels.fr.reviewed, { exact: true })
    .check();
  await c.owner(
    `library/collections/${g.collection.id}/tasks/${task.id}`,
    "PUT",
    {
      version: task.version,
      title: "SYNTHETIC_RENAMED_REPORT_TASK",
      assigneeId: task.assigneeId,
      dueDate: task.dueDate,
      status: "completed",
    },
  );
  const count = exports.length;
  await report
    .getByRole("button", { name: operationsReportLabels.fr.csv, exact: true })
    .click();
  await report.getByRole("alert").waitFor();
  assert.equal(exports.length, count + 1);
  assert.equal(exports.at(-1).status(), 409);
  assert.equal(await report.getByRole("checkbox").count(), 0);
  // Reader downloads and source erasure use current access and data, even after an earlier preview.
  await c.local.db
    .prepare("UPDATE users SET role='viewer' WHERE id=?")
    .run(c.person.id);
  const reader = await browser.newContext({ acceptDownloads: true }),
    rp = await reader.newPage();
  rp.on("pageerror", (e) => errors.push(e.message));
  await reader.request.post(base + "/api/auth/login", {
    data: { email: c.person.email, password: c.person.password },
  });
  await rp.goto(base);
  await rp
    .getByRole("button", { name: "Research library", exact: true })
    .click();
  await rp.getByRole("button", { name: "Action center", exact: true }).click();
  await rp
    .getByRole("button", { name: taskActivityLabels.en.title, exact: true })
    .click();
  const h = rp.getByRole("region", {
    name: taskActivityLabels.en.title,
    exact: true,
  });
  await h
    .getByLabel(taskActivityLabels.en.task, { exact: true })
    .selectOption(task.id);
  await h
    .getByText(taskActivityLabels.en.matches + ": 2", { exact: true })
    .waitFor();
  const rr = h.getByRole("region", {
    name: operationsReportLabels.en.title,
    exact: true,
  });
  await rr
    .getByRole("button", {
      name: operationsReportLabels.en.generate,
      exact: true,
    })
    .click();
  await rr
    .getByLabel(operationsReportLabels.en.reviewed, { exact: true })
    .check();
  await c.owner(
    `studies/${c.imports[0].s.id}/responses/${c.imports[0].interviewId}`,
    "DELETE",
  );
  await rr
    .getByRole("button", { name: operationsReportLabels.en.txt, exact: true })
    .click();
  await rr.getByRole("alert").waitFor();
  await rr
    .getByRole("button", {
      name: operationsReportLabels.en.generate,
      exact: true,
    })
    .click();
  await rr
    .getByText(operationsReportLabels.en.rows + ": 0", { exact: true })
    .waitFor();
  await rr
    .getByLabel(operationsReportLabels.en.reviewed, { exact: true })
    .check();
  const [download] = await Promise.all([
    rp.waitForEvent("download"),
    rr
      .getByRole("button", { name: operationsReportLabels.en.txt, exact: true })
      .click(),
  ]);
  const file = await readFile((await download.path())!, "utf8");
  assert.equal(file.includes("SYNTHETIC_RENAMED_REPORT_TASK"), false);
  for (const r of exports.filter((r) => r.status() === 200)) {
    assert.equal(r.headers()["cache-control"], "no-store");
    assert.ok(r.headers()["content-disposition"].includes("attachment"));
  }
  assert.deepEqual(errors, []);
  await reader.close();
  await context.close();
  console.log(
    "Operations reports EN/ES/FR mobile: scoped previews, guarded filters/navigation, review gates, real CSV/text downloads, readers, stale rejection without retries and source-erasure regeneration passed.",
  );
} finally {
  await browser?.close();
  await stop();
}
