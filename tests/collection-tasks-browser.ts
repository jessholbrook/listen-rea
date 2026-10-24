import { chromium, type Browser } from "playwright";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { start, stop, base } from "./harness";
import { transcriptSetup } from "./library-transcript-answers-fixture";
import { collectionLabels } from "../src/lib/library-collections";
import { dashboardLabels } from "../src/lib/collection-review";
import { taskLabels } from "../src/lib/collection-tasks";
let browser: Browser | undefined;
try {
  await start({ port: 3378 });
  const c = await transcriptSetup(),
    collections: any[] = [];
  for (const language of ["en", "es", "fr"] as const) {
    const collection = (
      await c.owner("library/collections", "POST", {
        requestId: randomUUID(),
        title: "Synthetic follow-up plan " + language,
        interviewIds: c.imports.map((i) => i.interviewId),
        briefIds: [],
      })
    ).collection;
    const asked = await c.ask({ collectionId: collection.id });
    collections.push({
      collection,
      language,
      answerId: asked.result.savedAnswerId,
    });
  }
  browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_PATH || "/usr/bin/chromium",
    args: ["--no-sandbox"],
  });
  const context = await browser.newContext({
      viewport: { width: 390, height: 844 },
    }),
    page = await context.newPage(),
    errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  assert.ok(
    (
      await context.request.post(base + "/api/auth/login", {
        data: { email: c.email, password: "saved-library-password" },
      })
    ).ok(),
  );
  await page.goto(base);
  await page
    .getByRole("button", { name: "Research library", exact: true })
    .click();
  await page.getByRole("button", { name: "Collections", exact: true }).click();
  let previous = "en" as "en" | "es" | "fr";
  for (const { collection, language, answerId } of collections) {
    const l = taskLabels[language as "en"],
      d = dashboardLabels[language as "en"];
    await page
      .getByLabel(collectionLabels[previous].language, { exact: true })
      .selectOption(language);
    previous = language;
    await page
      .locator(`[data-collection-id="${collection.id}"]`)
      .getByRole("button", { name: d.open, exact: true })
      .click();
    const dashboard = page.getByRole("region", { name: d.title, exact: true }),
      panel = page.getByRole("region", { name: l.title, exact: true });
    await panel.getByRole("button", { name: l.add, exact: true }).waitFor();
    await dashboard
      .locator(`[data-dashboard-interview="${c.imports[0].interviewId}"]`)
      .getByRole("button", { name: l.follow, exact: true })
      .click();
    let form = panel.getByRole("form", { name: l.add, exact: true });
    await form.waitFor();
    assert.equal(
      await form.getByLabel(l.target, { exact: true }).inputValue(),
      `interview:${c.imports[0].interviewId}`,
    );
    await form
      .getByLabel(l.task, { exact: true })
      .fill("Synthetic assigned follow-up " + language);
    await form.getByLabel(l.assignee, { exact: true }).selectOption(c.actor.id);
    await form.getByLabel(l.due, { exact: true }).fill("2001-01-01");
    await form.getByRole("button", { name: l.save, exact: true }).click();
    await panel.getByText(l.saved, { exact: true }).waitFor();
    const path = `library/collections/${collection.id}/tasks`;
    let task = (await c.owner(path)).tasks[0];
    assert.equal(task.assigneeId, c.actor.id);
    assert.equal(task.status, "open");
    await panel.getByLabel(l.filter, { exact: true }).selectOption("mine");
    let row = panel.locator(`[data-collection-task="${task.id}"]`);
    await row.waitFor();
    await panel.getByLabel(l.filter, { exact: true }).selectOption("overdue");
    await row.waitFor();
    await row.getByRole("button", { name: l.edit, exact: true }).click();
    form = panel.getByRole("form", { name: l.edit, exact: true });
    assert.equal(
      await form.getByLabel(l.target, { exact: true }).isDisabled(),
      true,
    );
    await form.getByLabel(l.status, { exact: true }).selectOption("completed");
    await form.getByRole("button", { name: l.save, exact: true }).click();
    await panel.getByText(l.saved, { exact: true }).waitFor();
    await panel.getByText(l.empty, { exact: true }).waitFor();
    await panel.getByLabel(l.filter, { exact: true }).selectOption("completed");
    await row.waitFor();
    task = (await c.owner(path)).tasks[0];
    assert.ok(task.completedAt);
    assert.equal(
      (await c.owner("library/answers/" + answerId)).answer.history.at(-1)
        .reviewed,
      false,
    );
    await row.getByRole("button", { name: l.edit, exact: true }).click();
    form = panel.getByRole("form", { name: l.edit, exact: true });
    if (language === "en") {
      await c.owner(path + "/" + task.id, "PUT", {
        version: task.version,
        title: task.title,
        assigneeId: task.assigneeId,
        dueDate: task.dueDate,
        status: "in_progress",
      });
      await form.getByLabel(l.status, { exact: true }).selectOption("open");
      await form.getByRole("button", { name: l.save, exact: true }).click();
      await panel.getByRole("alert").waitFor();
      assert.match(await panel.getByRole("alert").innerText(), /changed/);
      await panel.getByRole("button", { name: l.refresh, exact: true }).click();
      await panel.getByLabel(l.filter, { exact: true }).selectOption("all");
      await row.waitFor();
      await row.getByRole("button", { name: l.edit, exact: true }).click();
      form = panel.getByRole("form", { name: l.edit, exact: true });
    }
    await form.getByLabel(l.status, { exact: true }).selectOption("open");
    await form.getByLabel(l.due, { exact: true }).fill("");
    await form.getByRole("button", { name: l.save, exact: true }).click();
    await panel.getByText(l.saved, { exact: true }).waitFor();
    await panel.getByLabel(l.filter, { exact: true }).selectOption("all");
    task = (await c.owner(path)).tasks[0];
    assert.equal(task.completedAt, null);
    assert.equal(task.dueDate, null);
    await dashboard.getByRole("button", { name: d.close, exact: true }).click();
    await page
      .locator(`[data-collection-id="${collection.id}"]`)
      .getByRole("button", { name: d.open, exact: true })
      .click();
    await panel.locator(`[data-collection-task="${task.id}"]`).waitFor();
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth + 1,
      ),
      true,
    );
    await page.screenshot({
      path: `test-results/collection-tasks-${language}.png`,
      fullPage: true,
    });
    if (language === "en") {
      await c.owner(`library/collections/${collection.id}`, "PUT", {
        version: collection.version,
        title: collection.title,
        interviewIds: [c.imports[1].interviewId],
        briefIds: [],
      });
      await dashboard
        .getByRole("button", { name: d.refresh, exact: true })
        .click();
      await panel.getByText(l.empty, { exact: true }).waitFor();
      assert.equal((await c.owner(path)).tasks.length, 0);
      await panel.getByRole("button", { name: l.add, exact: true }).click();
      form = panel.getByRole("form", { name: l.add, exact: true });
      await form
        .getByLabel(l.task, { exact: true })
        .fill("Synthetic collection coordination");
      assert.equal(
        await form.getByLabel(l.target, { exact: true }).inputValue(),
        "",
      );
      await form.getByRole("button", { name: l.save, exact: true }).click();
      await panel.getByText(l.saved, { exact: true }).waitFor();
      task = (await c.owner(path)).tasks[0];
    }
    page.once("dialog", (dialog) => void dialog.accept());
    await panel
      .locator(`[data-collection-task="${task.id}"]`)
      .getByRole("button", { name: l.remove, exact: true })
      .click();
    await panel.getByText(l.deleted, { exact: true }).waitFor();
    assert.equal((await c.owner(path)).tasks.length, 0);
    await dashboard.getByRole("button", { name: d.close, exact: true }).click();
  }
  assert.deepEqual(errors, []);
  console.log(
    "EN/ES/FR mobile linked task creation, assignments, due dates, mine/overdue/completed filters, completion/reopening, stale edit rejection/recovery, persistence and deletion passed.",
  );
} finally {
  await browser?.close();
  await stop();
}
