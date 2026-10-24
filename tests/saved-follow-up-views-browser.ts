import { chromium, type Browser, type Locator } from "playwright";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { start, stop, base } from "./harness";
import { inboxSetup } from "./team-review-inbox-fixture";
import { actionLabels } from "../src/lib/research-action-center";
import { taskActivityLabels } from "../src/lib/task-activity";
import { savedViewLabels } from "../src/lib/saved-review-views";
import { operationsLabels } from "../src/lib/research-operations";
async function disabled(l: Locator) {
  for (let n = 0; n < 50; n++) {
    if (await l.isDisabled()) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  assert.equal(await l.isDisabled(), true);
}
async function valueIs(l: Locator, expected: string) {
  for (let n = 0; n < 100; n++) {
    if ((await l.inputValue().catch(() => null)) === expected) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  assert.equal(await l.inputValue(), expected);
}
let browser: Browser | undefined;
try {
  await start({ port: 3413 });
  const c = await inboxSetup(),
    g = await c.create("Saved follow-up browser");
  const task = (
    await c.owner(`library/collections/${g.collection.id}/tasks`, "POST", {
      requestId: randomUUID(),
      title: "Synthetic saved follow-up",
      assigneeId: c.actor.id,
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
    }),
    page = await context.newPage(),
    errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await context.request.post(base + "/api/auth/login", {
    data: { email: c.email, password: "saved-library-password" },
  });
  async function open(language: "en" | "es" | "fr" = "en") {
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
    const panel = page.getByRole("region", {
      name: actionLabels[language].title,
      exact: true,
    });
    await panel.locator(`[data-action-task="${task.id}"]`).waitFor();
    return panel;
  }
  const presets: any[] = [];
  for (const language of ["en", "es", "fr"] as const) {
    const al = actionLabels[language],
      hl = taskActivityLabels[language],
      sl = savedViewLabels[language];
    let panel = await open(language),
      saved = panel.getByRole("region", {
        name: sl.followUpTitle,
        exact: true,
      });
    await panel.getByLabel(al.assignee, { exact: true }).selectOption("mine");
    await panel
      .getByLabel(al.collection, { exact: true })
      .selectOption(g.collection.id);
    await saved.getByRole("button", { name: sl.save, exact: true }).click();
    await saved.getByLabel(sl.name, { exact: true }).fill("Queue " + language);
    await saved
      .getByLabel(sl.visibility, { exact: true })
      .selectOption("shared");
    await disabled(panel.getByLabel(al.language, { exact: true }));
    await disabled(panel.getByLabel(al.assignee, { exact: true }));
    await disabled(panel.getByRole("button", { name: hl.title, exact: true }));
    await disabled(
      panel
        .locator(`[data-action-task="${task.id}"]`)
        .getByRole("button", { name: al.edit, exact: true }),
    );
    await saved.getByRole("button", { name: sl.save, exact: true }).click();
    await saved.getByText(sl.saved, { exact: true }).waitFor();
    const queueId = await saved
      .getByLabel(sl.choose, { exact: true })
      .inputValue();
    panel = await open(language);
    saved = panel.getByRole("region", { name: sl.followUpTitle, exact: true });
    await saved.getByLabel(sl.choose, { exact: true }).selectOption(queueId);
    await saved.getByRole("button", { name: sl.apply, exact: true }).click();
    await panel.locator(`[data-action-task="${task.id}"]`).waitFor();
    await valueIs(panel.getByLabel(al.assignee, { exact: true }), "mine");
    assert.equal(
      await panel.getByLabel(al.collection, { exact: true }).inputValue(),
      g.collection.id,
    );
    await panel
      .locator(`[data-action-task="${task.id}"]`)
      .getByRole("button", { name: hl.view, exact: true })
      .click();
    const history = panel.getByRole("region", { name: hl.title, exact: true });
    await history.getByText(hl.matches + ": 1", { exact: true }).waitFor();
    await history.getByLabel(hl.field, { exact: true }).selectOption("status");
    await history.getByText(hl.matches + ": 1", { exact: true }).waitFor();
    saved = panel.getByRole("region", { name: sl.followUpTitle, exact: true });
    assert.equal(
      await saved
        .getByLabel(sl.choose, { exact: true })
        .locator("option")
        .filter({ hasText: "Queue " + language })
        .count(),
      0,
    );
    await saved.getByRole("button", { name: sl.save, exact: true }).click();
    await saved
      .getByLabel(sl.name, { exact: true })
      .fill("History " + language);
    await saved
      .getByLabel(sl.visibility, { exact: true })
      .selectOption("shared");
    await disabled(history.getByLabel(hl.field, { exact: true }));
    await saved.getByRole("button", { name: sl.save, exact: true }).click();
    await saved.getByText(sl.saved, { exact: true }).waitFor();
    const historyId = await saved
      .getByLabel(sl.choose, { exact: true })
      .inputValue();
    presets.push({ queueId, historyId });
    await saved.screenshot({
      path: `test-results/follow-up-views-${language}.png`,
    });
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth,
      ),
      false,
    );
    // Global saved views route each kind into its original screen and reset history pagination.
    for (const id of [queueId, historyId]) {
      await page.goto(base);
      await page
        .getByRole("button", { name: "Research library", exact: true })
        .click();
      await page
        .getByRole("button", { name: "Operations home", exact: true })
        .click();
      const ol = operationsLabels.en,
        home = page.getByRole("region", { name: ol.title, exact: true });
      await home.getByLabel(ol.choose, { exact: true }).selectOption(id);
      await home.getByRole("button", { name: ol.apply, exact: true }).click();
      if (id === queueId) {
        await page
          .getByLabel(actionLabels.en.assignee, { exact: true })
          .waitFor();
        assert.equal(
          await page
            .getByLabel(actionLabels.en.assignee, { exact: true })
            .inputValue(),
          "mine",
        );
      } else {
        const h = page.getByRole("region", {
          name: taskActivityLabels.en.title,
          exact: true,
        });
        await h
          .getByText(taskActivityLabels.en.matches + ": 1", { exact: true })
          .waitFor();
        assert.equal(
          await h
            .getByLabel(taskActivityLabels.en.task, { exact: true })
            .inputValue(),
          task.id,
        );
        assert.equal(
          await h
            .getByLabel(taskActivityLabels.en.field, { exact: true })
            .inputValue(),
          "status",
        );
      }
    }
  }
  // Reader sessions can apply shared filters and retain private copies without shared management.
  await c.local.db
    .prepare("UPDATE users SET role='viewer' WHERE id=?")
    .run(c.person.id);
  const reader = await browser.newContext({
    viewport: { width: 390, height: 844 },
  });
  const readerPage = await reader.newPage();
  readerPage.on("pageerror", (e) => errors.push(e.message));
  await reader.request.post(base + "/api/auth/login", {
    data: { email: c.person.email, password: c.person.password },
  });
  await readerPage.goto(base);
  await readerPage
    .getByRole("button", { name: "Research library", exact: true })
    .click();
  await readerPage
    .getByRole("button", { name: "Action center", exact: true })
    .click();
  const readerPanel = readerPage.getByRole("region", {
    name: actionLabels.en.title,
    exact: true,
  });
  let readerSaved = readerPanel.getByRole("region", {
    name: savedViewLabels.en.followUpTitle,
    exact: true,
  });
  await readerSaved
    .getByLabel(savedViewLabels.en.choose, { exact: true })
    .selectOption(presets[0].queueId);
  assert.equal(
    await readerSaved
      .getByRole("button", { name: savedViewLabels.en.update, exact: true })
      .count(),
    0,
  );
  await readerSaved
    .getByRole("button", { name: savedViewLabels.en.apply, exact: true })
    .click();
  await valueIs(
    readerPanel.getByLabel(actionLabels.en.assignee, { exact: true }),
    "mine",
  );
  await readerPanel.getByText(actionLabels.en.empty, { exact: true }).waitFor();
  assert.equal(
    await readerPanel
      .getByRole("button", { name: actionLabels.en.edit, exact: true })
      .count(),
    0,
  );
  await readerSaved
    .getByLabel(savedViewLabels.en.choose, { exact: true })
    .selectOption(presets[0].queueId);
  await readerSaved
    .getByRole("button", { name: savedViewLabels.en.copy, exact: true })
    .click();
  await readerSaved
    .getByText(savedViewLabels.en.copied, { exact: true })
    .waitFor();
  const copyId = await readerSaved
    .getByLabel(savedViewLabels.en.choose, { exact: true })
    .inputValue();
  assert.equal(
    (await c.owner("library/saved-review-views/" + copyId)).status,
    404,
  );
  await readerSaved
    .getByRole("button", { name: savedViewLabels.en.update, exact: true })
    .click();
  assert.equal(
    await readerSaved
      .getByLabel(savedViewLabels.en.visibility, { exact: true })
      .locator('option[value="shared"]')
      .getAttribute("disabled"),
    "",
  );
  await readerSaved
    .getByLabel(savedViewLabels.en.name, { exact: true })
    .fill("Reader private follow-up copy");
  await readerSaved
    .getByRole("button", { name: savedViewLabels.en.update, exact: true })
    .click();
  await readerSaved
    .getByText(savedViewLabels.en.saved, { exact: true })
    .waitFor();
  readerPage.once("dialog", (dialog) => dialog.accept());
  await readerSaved
    .getByRole("button", { name: savedViewLabels.en.remove, exact: true })
    .click();
  await valueIs(
    readerSaved.getByLabel(savedViewLabels.en.choose, { exact: true }),
    "",
  );
  await reader.close();
  // A stale cached preset must clear its catalog, preserve current filters and require explicit refresh.
  let panel = await open(),
    saved = panel.getByRole("region", {
      name: savedViewLabels.en.followUpTitle,
      exact: true,
    });
  await saved
    .getByLabel(savedViewLabels.en.choose, { exact: true })
    .selectOption(presets[0].queueId);
  const old = (
    await c.owner("library/saved-review-views/" + presets[0].queueId)
  ).view;
  await c.owner("library/saved-review-views/" + old.id, "PUT", {
    version: old.version,
    name: old.name,
    visibility: old.visibility,
    config: {
      ...old.config,
      filters: { ...old.config.filters, query: "Changed elsewhere" },
    },
  });
  await saved
    .getByRole("button", { name: savedViewLabels.en.apply, exact: true })
    .click();
  await saved.getByRole("alert").waitFor();
  assert.equal(
    await panel.getByLabel(actionLabels.en.query, { exact: true }).inputValue(),
    "",
  );
  await saved
    .getByRole("button", { name: savedViewLabels.en.refresh, exact: true })
    .click();
  await saved
    .getByLabel(savedViewLabels.en.choose, { exact: true })
    .selectOption(old.id);
  await saved
    .getByRole("button", { name: savedViewLabels.en.apply, exact: true })
    .click();
  await panel.getByText(actionLabels.en.empty, { exact: true }).waitFor();
  await valueIs(
    panel.getByLabel(actionLabels.en.query, { exact: true }),
    "Changed elsewhere",
  );
  // Source erasure retains the exact history scope and shows zero current events.
  await c.owner(
    `studies/${c.imports[0].s.id}/responses/${c.imports[0].interviewId}`,
    "DELETE",
  );
  await page.goto(base);
  await page
    .getByRole("button", { name: "Research library", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Operations home", exact: true })
    .click();
  await page
    .getByLabel(operationsLabels.en.choose, { exact: true })
    .selectOption(presets[0].historyId);
  await page
    .getByRole("button", { name: operationsLabels.en.apply, exact: true })
    .click();
  const h = page.getByRole("region", {
    name: taskActivityLabels.en.title,
    exact: true,
  });
  await h
    .getByText(taskActivityLabels.en.matches + ": 0", { exact: true })
    .waitFor();
  assert.equal(
    await h
      .getByLabel(taskActivityLabels.en.task, { exact: true })
      .inputValue(),
    task.id,
  );
  assert.deepEqual(errors, []);
  await context.close();
  console.log(
    "Saved follow-up views browser passed: EN/ES/FR mobile, cross-session queue/history persistence, guarded forms, operations routing, stale-version recovery and exact erased scopes.",
  );
} finally {
  await browser?.close();
  await stop();
}
