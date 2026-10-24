import { chromium, type Browser } from "playwright";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { start, stop, base } from "./harness";
import { transcriptSetup } from "./library-transcript-answers-fixture";
import { actionLabels } from "../src/lib/research-action-center";
import { dashboardLabels } from "../src/lib/collection-review";
import { libraryAnswerLabels } from "../src/lib/library-answers";
import { briefLabels } from "../src/lib/library-briefs";
let browser: Browser | undefined;
try {
  await start({ port: 3381 });
  const c = await transcriptSetup(),
    groups: any[] = [];
  async function collection(title: string, briefIds: string[] = []) {
    return (
      await c.owner("library/collections", "POST", {
        requestId: randomUUID(),
        title,
        interviewIds: c.imports.map((i) => i.interviewId),
        briefIds,
      })
    ).collection;
  }
  async function task(col: any, target: any = null, extra: any = {}) {
    const r = await c.owner(`library/collections/${col.id}/tasks`, "POST", {
      requestId: randomUUID(),
      title: "Synthetic action task",
      assigneeId: c.actor.id,
      dueDate: "2026-10-21",
      status: "open",
      target,
      ...extra,
    });
    assert.equal(r.status, 201);
    return r.task;
  }
  for (const language of ["en", "es", "fr"] as const) {
    const a = await collection("Synthetic action Alpha " + language),
      b = await collection("Synthetic action Beta " + language),
      answerId = (await c.ask({ collectionId: a.id })).result.savedAnswerId;
    const sourceTask = await task(
        a,
        { kind: "interview", id: c.imports[0].interviewId },
        { title: "Synthetic assigned overdue " + language },
      ),
      answerTask = await task(
        a,
        { kind: "answer", id: answerId },
        {
          title: "Synthetic answer review " + language,
          assigneeId: null,
          dueDate: "2026-10-22",
        },
      ),
      general = await task(b, null, {
        title: "Synthetic coordination " + language,
        assigneeId: null,
        dueDate: null,
      });
    groups.push({ language, a, b, sourceTask, answerTask, general, answerId });
  }
  const brief = await c.create(),
    briefCollection = await collection("Synthetic brief navigation", [
      brief.id,
    ]),
    briefTask = await task(briefCollection, { kind: "brief", id: brief.id });
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
  await page.clock.install({ time: new Date("2026-10-22T18:00:00Z") });
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
  await page
    .getByRole("button", { name: "Action center", exact: true })
    .click();
  let panel = page.getByRole("region", {
    name: actionLabels.en.title,
    exact: true,
  });
  await panel
    .locator(`[data-action-task="${briefTask.id}"]`)
    .getByRole("button", { name: actionLabels.en.review, exact: true })
    .click();
  await page.getByLabel(briefLabels.en.name, { exact: true }).waitFor();
  assert.equal(
    await page.getByLabel(briefLabels.en.name, { exact: true }).inputValue(),
    brief.title,
  );
  await page
    .getByRole("button", { name: "Action center", exact: true })
    .click();
  let previous = "en" as "en" | "es" | "fr";
  for (const g of groups) {
    const l = actionLabels[g.language as "en"];
    await page
      .getByLabel(actionLabels[previous].language, { exact: true })
      .selectOption(g.language);
    previous = g.language;
    panel = page.getByRole("region", { name: l.title, exact: true });
    await panel.locator(`[data-action-task="${g.general.id}"]`).waitFor();
    await panel.getByLabel(l.collection, { exact: true }).selectOption(g.a.id);
    assert.equal(await panel.locator("[data-action-task]").count(), 2);
    await panel.getByLabel(l.assignee, { exact: true }).selectOption("mine");
    await panel.getByLabel(l.due, { exact: true }).selectOption("overdue");
    assert.equal(await panel.locator("[data-action-task]").count(), 1);
    await panel.getByLabel(l.query, { exact: true }).fill("does not match");
    await panel.getByText(l.empty, { exact: true }).waitFor();
    await panel.getByLabel(l.query, { exact: true }).fill("");
    let row = panel.locator(`[data-action-task="${g.sourceTask.id}"]`);
    await row.getByRole("button", { name: l.review, exact: true }).click();
    await page
      .getByRole("dialog", { name: "Library source", exact: true })
      .getByRole("button", { name: "Close dialog", exact: true })
      .click();
    await row.getByRole("button", { name: l.edit, exact: true }).click();
    let form = panel.getByRole("form", { name: l.edit, exact: true });
    if (g.language === "en") {
      const t = (await c.owner("library/action-center")).tasks.find(
        (t: any) => t.id === g.sourceTask.id,
      );
      await c.owner(
        `library/collections/${t.collectionId}/tasks/${t.id}`,
        "PUT",
        {
          version: t.version,
          title: t.title,
          assigneeId: t.assigneeId,
          dueDate: t.dueDate,
          status: "in_progress",
        },
      );
      await form
        .getByLabel(l.status, { exact: true })
        .selectOption("completed");
      await form.getByRole("button", { name: l.save, exact: true }).click();
      await panel.getByRole("alert").waitFor();
      assert.equal(await panel.locator("[data-action-task]").count(), 0);
      await panel.getByRole("button", { name: l.refresh, exact: true }).click();
      await row.waitFor();
      await row.getByRole("button", { name: l.edit, exact: true }).click();
      form = panel.getByRole("form", { name: l.edit, exact: true });
    }
    await form.getByLabel(l.status, { exact: true }).selectOption("completed");
    await form.getByRole("button", { name: l.save, exact: true }).click();
    await panel.getByText(l.saved, { exact: true }).waitFor();
    await panel.getByText(l.empty, { exact: true }).waitFor();
    await panel.getByLabel(l.due, { exact: true }).selectOption("");
    await panel.getByLabel(l.status, { exact: true }).selectOption("completed");
    await row.waitFor();
    await row.getByRole("button", { name: l.edit, exact: true }).click();
    form = panel.getByRole("form", { name: l.edit, exact: true });
    await form.getByLabel(l.status, { exact: true }).selectOption("open");
    await form.getByLabel(l.assignee, { exact: true }).selectOption("");
    await form.getByLabel(l.dueDate, { exact: true }).fill("");
    await form.getByRole("button", { name: l.save, exact: true }).click();
    await panel.getByText(l.saved, { exact: true }).waitFor();
    await panel.getByRole("button", { name: l.reset, exact: true }).click();
    await panel.getByLabel(l.collection, { exact: true }).selectOption(g.a.id);
    await panel.getByLabel(l.due, { exact: true }).selectOption("today");
    assert.equal(await panel.locator("[data-action-task]").count(), 1);
    await panel
      .locator(`[data-action-task="${g.answerTask.id}"]`)
      .getByRole("button", { name: l.review, exact: true })
      .click();
    await page
      .getByRole("dialog", {
        name: libraryAnswerLabels[g.language as "en"].open,
        exact: true,
      })
      .getByRole("button", { name: "Close dialog", exact: true })
      .click();
    await panel.locator(`[data-action-task="${g.answerTask.id}"]`).waitFor();
    assert.equal(
      (await c.owner("library/answers/" + g.answerId)).answer.history.at(-1)
        .reviewed,
      false,
    );
    await panel.getByLabel(l.due, { exact: true }).selectOption("");
    await panel
      .locator(`[data-action-task="${g.sourceTask.id}"]`)
      .getByRole("button", { name: l.openCollection, exact: true })
      .click();
    const dashboard = page.getByRole("region", {
      name: dashboardLabels[g.language as "en"].title,
      exact: true,
    });
    await dashboard
      .getByRole("button", {
        name: dashboardLabels[g.language as "en"].close,
        exact: true,
      })
      .click();
    await panel.locator(`[data-action-task="${g.sourceTask.id}"]`).waitFor();
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth + 1,
      ),
      true,
    );
    await page.screenshot({
      path: `test-results/action-center-${g.language}.png`,
      fullPage: true,
    });
  }
  // Bounded rendering and filter retention after an explicitly selected collection disappears.
  await page
    .getByLabel(actionLabels.fr.language, { exact: true })
    .selectOption("en");
  const l = actionLabels.en;
  panel = page.getByRole("region", { name: l.title, exact: true });
  await panel.getByLabel(l.collection, { exact: true }).waitFor();
  const paged = await collection("Synthetic paginated action queue"),
    seed = await task(paged, null, {
      title: "Synthetic paginated 00",
      dueDate: null,
    }),
    stored = await c.local.get<any>(
      "libraryCollectionTask",
      seed.id,
      c.actor.workspaceId,
    );
  await c.local.transaction(async () => {
    for (let n = 1; n <= 50; n++)
      await c.local.put("libraryCollectionTask", {
        ...stored,
        id: randomUUID(),
        requestId: randomUUID(),
        title: "Synthetic paginated " + String(n).padStart(2, "0"),
        createdAt: new Date(Date.parse(stored.createdAt) + n).toISOString(),
      });
  });
  await panel.getByRole("button", { name: l.refresh, exact: true }).click();
  await panel.getByLabel(l.collection, { exact: true }).selectOption(paged.id);
  assert.equal(await panel.locator("[data-action-task]").count(), 50);
  await panel.getByRole("button", { name: l.next, exact: true }).click();
  assert.equal(await panel.locator("[data-action-task]").count(), 1);
  await panel.getByLabel(l.query, { exact: true }).fill("paginated 50");
  assert.equal(await panel.locator("[data-action-task]").count(), 1);
  await c.owner("library/collections/" + paged.id, "DELETE", {
    version: paged.version,
  });
  await panel.getByRole("button", { name: l.refresh, exact: true }).click();
  await panel.getByText(l.empty, { exact: true }).waitFor();
  assert.equal(
    await panel.getByLabel(l.collection, { exact: true }).inputValue(),
    paged.id,
  );
  assert.equal(
    await panel
      .getByLabel(l.collection, { exact: true })
      .locator("option:checked")
      .innerText(),
    l.unavailableCollection,
  );
  // Source erasure from the actual parent source viewer refreshes the queue immediately.
  await panel.getByRole("button", { name: l.reset, exact: true }).click();
  const g = groups[0];
  await panel.getByLabel(l.collection, { exact: true }).selectOption(g.a.id);
  await panel
    .locator(`[data-action-task="${g.sourceTask.id}"]`)
    .getByRole("button", { name: l.review, exact: true })
    .click();
  page.once("dialog", (d) => void d.accept());
  await page
    .getByRole("dialog", { name: "Library source", exact: true })
    .getByRole("button", { name: "Delete source", exact: true })
    .click();
  await panel.getByText(l.empty, { exact: true }).waitFor();
  assert.equal(
    (await c.owner("library/action-center")).tasks.some(
      (t: any) => t.id === g.sourceTask.id || t.id === g.answerTask.id,
    ),
    false,
  );
  assert.deepEqual(errors, []);
  console.log(
    "EN/ES/FR mobile cross-collection filtering, in-place task edits, stale-edit recovery, completion/reopening, direct source/answer/brief/dashboard navigation, pagination, removed-scope retention and source-erasure refresh passed.",
  );
} finally {
  await browser?.close();
  await stop();
}
