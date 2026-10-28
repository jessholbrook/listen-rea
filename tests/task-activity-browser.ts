import { chromium, type Browser } from "playwright";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { start, stop, base } from "./harness";
import { inboxSetup } from "./team-review-inbox-fixture";
import { actionLabels } from "../src/lib/research-action-center";
import { taskActivityLabels } from "../src/lib/task-activity";
let browser: Browser | undefined;
try {
  await start({ port: 3411 });
  const c = await inboxSetup(),
    groups: any[] = [];
  async function edit(t: any, extra: any = {}, call = c.owner) {
    const r = await call(
      `library/collections/${t.collectionId}/tasks/${t.id}`,
      "PUT",
      {
        version: t.version,
        title: t.title,
        assigneeId: t.assigneeId,
        dueDate: t.dueDate,
        status: t.status,
        ...extra,
      },
    );
    assert.equal(r.status, 200);
    return r.task;
  }
  for (const language of ["en", "es", "fr"] as const) {
    const g = await c.create("Task history " + language),
      t = (
        await c.owner(`library/collections/${g.collection.id}/tasks`, "POST", {
          requestId: randomUUID(),
          title: "Follow-up " + language,
          assigneeId: c.actor.id,
          dueDate: "2028-02-27",
          status: "open",
          target: { kind: "interview", id: c.imports[0].interviewId },
        })
      ).task;
    let current = await edit(
      t,
      { assigneeId: c.person.id, dueDate: "2028-02-29", status: "in_progress" },
      c.person.call,
    );
    const batch = await c.owner("library/operations-triage/apply", "POST", {
      changes: {
        assignee: { mode: "clear" },
        dueDate: { mode: "set", date: "2028-03-01" },
      },
      tasks: [
        { id: t.id, collectionId: t.collectionId, version: current.version },
      ],
      acknowledged: true,
    });
    assert.equal(batch.tasks[0].status, "applied");
    current = (
      await c.owner(`library/collections/${g.collection.id}/tasks`)
    ).tasks.find((r: any) => r.id === t.id);
    groups.push({ ...g, language, t: current });
  }
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
  assert.ok(
    (
      await context.request.post(base + "/api/auth/login", {
        data: { email: c.email, password: "saved-library-password" },
      })
    ).ok(),
  );
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
    return page.getByRole("region", {
      name: actionLabels[language].title,
      exact: true,
    });
  }
  for (const g of groups) {
    const language = g.language as "en",
      l = taskActivityLabels[language],
      al = actionLabels[language],
      panel = await open(language);
    await panel
      .locator(`[data-action-task="${g.t.id}"]`)
      .getByRole("button", { name: l.view, exact: true })
      .click();
    const history = panel.getByRole("region", { name: l.title, exact: true });
    await history.getByText(l.matches + ": 3", { exact: true }).waitFor();
    assert.equal(
      await history.getByLabel(l.task, { exact: true }).inputValue(),
      g.t.id,
    );
    assert.equal(
      await history.getByLabel(l.collection, { exact: true }).inputValue(),
      g.collection.id,
    );
    await history
      .getByLabel(l.person, { exact: true })
      .selectOption(c.person.id);
    await history
      .getByLabel(l.action, { exact: true })
      .selectOption("task_updated");
    await history.getByLabel(l.field, { exact: true }).selectOption("status");
    await history.getByText(l.matches + ": 1", { exact: true }).waitFor();
    const event = history.locator("[data-task-event]").first();
    await event
      .getByText(c.person.name + " ·", { exact: false })
      .first()
      .waitFor();
    await event.getByText(l.before, { exact: true }).waitFor();
    await event.getByText(l.after, { exact: true }).waitFor();
    await history.screenshot({
      path: `test-results/task-history-${language}.png`,
    });
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth,
      ),
      false,
    );
    await event.getByRole("button", { name: l.open, exact: true }).click();
    const form = panel.getByRole("form", { name: al.edit, exact: true });
    await form.getByLabel(al.titleField, { exact: true }).waitFor();
    assert.equal(
      await form.getByLabel(al.titleField, { exact: true }).inputValue(),
      g.t.title,
    );
    await form.getByLabel(al.status, { exact: true }).selectOption("completed");
    await form.getByRole("button", { name: al.save, exact: true }).click();
    await panel.getByText(al.saved, { exact: true }).waitFor();
    await panel.getByRole("button", { name: l.title, exact: true }).click();
    await history.getByText(l.matches + ": 1", { exact: true }).waitFor();
    assert.equal(
      await history.getByLabel(l.field, { exact: true }).inputValue(),
      "status",
    );
    assert.equal(
      await history.getByLabel(l.person, { exact: true }).inputValue(),
      c.person.id,
    );
    await history.getByRole("button", { name: l.reset, exact: true }).click();
    await history.getByLabel(l.task, { exact: true }).selectOption(g.t.id);
    await history.getByText(l.matches + ": 4", { exact: true }).waitFor();
  }
  // Date filters use the viewer's calendar; stable reads do not append events.
  let panel = await open(),
    l = taskActivityLabels.en,
    g = groups[0];
  await panel.getByRole("button", { name: l.title, exact: true }).click();
  let history = panel.getByRole("region", { name: l.title, exact: true });
  await history.getByText(l.matches + ": 12", { exact: true }).waitFor();
  const stored = await c.local.get<any>(
    "libraryTaskActivity",
    g.t.id,
    c.actor.workspaceId,
  );
  await c.local.put("libraryTaskActivity", {
    ...stored,
    events: Array.from({ length: 25 }, (_, n) => ({
      ...stored.events[0],
      id: randomUUID(),
      sequence: n + 1,
      at: "2028-03-01T00:30:00.000Z",
    })),
    omitted: 3,
  });
  await history.getByLabel(l.task, { exact: true }).selectOption(g.t.id);
  await history.getByLabel(l.from, { exact: true }).fill("2028-02-29");
  await history.getByLabel(l.to, { exact: true }).fill("2028-02-29");
  await history.getByText(l.matches + ": 25", { exact: true }).waitFor();
  assert.equal(await history.locator("[data-task-event]").count(), 20);
  await history.getByRole("button", { name: l.next, exact: true }).click();
  await history.getByText(l.page + " 2/2", { exact: true }).waitFor();
  assert.equal(await history.locator("[data-task-event]").count(), 5);
  await history.getByText(l.omitted + ": 3", { exact: true }).waitFor();
  await history.getByLabel(l.to, { exact: true }).fill("2028-02-28");
  await history.getByRole("alert").waitFor();
  await history.getByRole("button", { name: l.reset, exact: true }).click();
  await history
    .getByLabel(l.task, { exact: true })
    .selectOption(groups[1].t.id);
  await history
    .getByLabel(l.action, { exact: true })
    .selectOption("task_updated");
  await history.getByText(l.matches + ": 2", { exact: true }).waitFor();
  await c.local.db
    .prepare("UPDATE users SET name='Renamed follow-up reviewer' WHERE id=?")
    .run(c.person.id);
  await history.getByRole("button", { name: l.refresh, exact: true }).click();
  await history
    .locator("[data-task-event]")
    .getByText("Renamed follow-up reviewer ·", { exact: false })
    .first()
    .waitFor();
  assert.equal((await history.textContent())!.includes(c.person.name), false);
  // Duplicate titles can span pages; a history link must focus the original ID.
  for (let n = 0; n < 51; n++) {
    assert.equal(
      (
        await c.owner(
          `library/collections/${groups[1].collection.id}/tasks`,
          "POST",
          {
            requestId: randomUUID(),
            title: groups[1].t.title,
            assigneeId: null,
            dueDate: "2028-01-01",
            status: "completed",
            target: { kind: "interview", id: c.imports[0].interviewId },
          },
        )
      ).status,
      201,
    );
  }
  // Readers see history and the current task without editor controls.
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
  await rp.getByRole("button", { name: "Action center", exact: true }).click();
  let readPanel = rp.getByRole("region", {
    name: actionLabels.en.title,
    exact: true,
  });
  await readPanel.getByRole("button", { name: l.title, exact: true }).click();
  let readHistory = readPanel.getByRole("region", {
    name: l.title,
    exact: true,
  });
  await readHistory
    .getByLabel(l.task, { exact: true })
    .selectOption(groups[1].t.id);
  await readHistory
    .locator("[data-task-event]")
    .first()
    .getByRole("button", { name: l.open, exact: true })
    .click();
  await readPanel.locator(`[data-action-task="${groups[1].t.id}"]`).waitFor();
  await rp.waitForFunction(
    (id) => document.activeElement?.getAttribute("data-action-task") === id,
    groups[1].t.id,
  );
  await rp.evaluate(
    () =>
      new Promise<void>((done) =>
        requestAnimationFrame(() => requestAnimationFrame(() => done())),
      ),
  );
  assert.equal(
    await readPanel
      .locator(`[data-action-task="${groups[1].t.id}"]`)
      .isVisible(),
    true,
  );
  assert.equal(
    await readPanel
      .getByRole("button", { name: actionLabels.en.edit, exact: true })
      .count(),
    0,
  );
  assert.equal(
    await readPanel
      .getByLabel(actionLabels.en.status, { exact: true })
      .inputValue(),
    "all",
  );
  await reader.close();
  // Departure masks old attribution and creates one automatic unassignment event.
  const current = (
    await c.owner(`library/collections/${groups[1].collection.id}/tasks`)
  ).tasks.find((t: any) => t.id === groups[1].t.id);
  await edit(current, { assigneeId: c.person.id });
  await c.local.db
    .prepare("UPDATE users SET workspace_id=? WHERE id=?")
    .run(randomUUID(), c.person.id);
  await history
    .getByLabel(l.action, { exact: true })
    .selectOption("assignee_unavailable");
  await history.getByText(l.matches + ": 1", { exact: true }).waitFor();
  await history
    .locator("[data-task-event]")
    .getByText(l.former, { exact: false })
    .waitFor();
  await c.owner(
    `studies/${c.imports[0].s.id}/responses/${c.imports[0].interviewId}`,
    "DELETE",
  );
  await history.getByRole("button", { name: l.refresh, exact: true }).click();
  await history.getByText(l.empty, { exact: true }).waitFor();
  assert.equal(
    await history.getByLabel(l.task, { exact: true }).inputValue(),
    groups[1].t.id,
  );
  assert.equal(
    await history
      .getByLabel(l.task, { exact: true })
      .locator("option:checked")
      .textContent(),
    l.unavailableTask,
  );
  assert.equal(await history.locator("[data-task-event]").count(), 0);
  assert.deepEqual(errors, []);
  await context.close();
  console.log(
    "EN/ES/FR mobile follow-up history: individual and triage events, intersecting filters, before/after values, current-task edit/reader navigation, retained filters, local leap-day dates, pagination, current/masked names, automatic unassignment and source-erasure scopes passed.",
  );
} finally {
  await browser?.close();
  await stop();
}
