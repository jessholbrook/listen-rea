import { chromium, type Browser, type Locator } from "playwright";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { start, stop, base } from "./harness";
import { inboxSetup } from "./team-review-inbox-fixture";
import { followUpWorkloadLabels as labels } from "../src/lib/follow-up-workload";
import { actionLabels } from "../src/lib/research-action-center";
import { operationsLabels } from "../src/lib/research-operations";
async function valueIs(l: Locator, v: string) {
  for (let n = 0; n < 100; n++) {
    if ((await l.inputValue().catch(() => null)) === v) return;
    await new Promise((r) => setTimeout(r, 50));
  }
  assert.equal(await l.inputValue(), v);
}
let browser: Browser | undefined;
try {
  await start({ port: 3415 });
  const c = await inboxSetup(),
    g = await c.create("Workload primary"),
    other = await c.create("Workload secondary"),
    tasks: any[] = [];
  for (const [assigneeId, status, dueDate] of [
    [c.actor.id, "open", "2028-02-28"],
    [c.person.id, "in_progress", "2028-02-29"],
    [null, "open", null],
    [c.actor.id, "completed", "2028-02-27"],
  ])
    tasks.push(
      (
        await c.owner(`library/collections/${g.collection.id}/tasks`, "POST", {
          requestId: randomUUID(),
          title: "Scoped workload task",
          assigneeId,
          status,
          dueDate,
          target: { kind: "interview", id: c.imports[0].interviewId },
        })
      ).task,
    );
  await c.owner(`library/collections/${other.collection.id}/tasks`, "POST", {
    requestId: randomUUID(),
    title: "Other workload task",
    assigneeId: c.person.id,
    status: "open",
    dueDate: "2028-03-06",
    target: null,
  });
  for (let n = 0; n < 21; n++)
    await c.local.db
      .prepare(
        "INSERT INTO users(id,email,name,password,workspace_id,role) VALUES(?,?,?,?,?,?)",
      )
      .run(
        randomUUID(),
        randomUUID() + "@example.test",
        "Zero member " + n,
        c.local.passwordHash("synthetic-unused-password"),
        c.actor.workspaceId,
        "collaborator",
      );
  browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_PATH || "/usr/bin/chromium",
    args: ["--no-sandbox"],
  });
  const ctx = await browser.newContext({
      viewport: { width: 390, height: 844 },
      timezoneId: "America/Los_Angeles",
    }),
    page = await ctx.newPage(),
    errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.clock.setFixedTime(new Date("2028-02-29T20:00:00Z"));
  assert.ok(
    (
      await ctx.request.post(base + "/api/auth/login", {
        data: { email: c.email, password: "saved-library-password" },
      })
    ).ok(),
  );
  for (const language of ["en", "es", "fr"] as const) {
    const l = labels[language],
      al = actionLabels[language],
      ol = operationsLabels[language];
    await page.goto(base);
    await page
      .getByRole("button", { name: "Research library", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Operations home", exact: true })
      .click();
    if (language !== "en")
      await page
        .getByLabel(operationsLabels.en.language, { exact: true })
        .selectOption(language);
    await page.getByRole("button", { name: l.title, exact: true }).click();
    const workload = page.getByRole("region", { name: l.title, exact: true }),
      panel = page.getByRole("region", { name: al.title, exact: true });
    await workload.getByText(l.matching + ": 24", { exact: true }).waitFor();
    assert.equal(
      await workload.locator("article[data-workload-assignee]").count(),
      21,
    );
    await workload.getByRole("button", { name: l.next, exact: true }).click();
    await workload.getByText(l.page + " 2/2", { exact: true }).waitFor();
    assert.equal(
      await workload.locator("article[data-workload-assignee]").count(),
      5,
    );
    await workload
      .getByLabel(al.collection, { exact: true })
      .selectOption(g.collection.id);
    await workload.getByLabel(l.query, { exact: true }).fill("Scoped");
    const totals = workload.getByRole("article", {
      name: l.totals,
      exact: true,
    });
    await totals
      .locator('[data-workload-metric="active"]')
      .getByText(al.active + ": 3", { exact: true })
      .waitFor();
    for (const metric of [
      "overdue",
      "today",
      "week",
      "undated",
      "completed",
    ] as const)
      assert.equal(
        await totals.locator(`[data-workload-metric="${metric}"]`).innerText(),
        al[metric] + ": 1",
      );
    await workload.getByLabel(l.rows, { exact: true }).selectOption("active");
    await workload.getByText(l.matching + ": 3", { exact: true }).waitFor();
    await workload.screenshot({
      path: `test-results/follow-up-workload-${language}.png`,
    });
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth,
      ),
      false,
    );
    await workload
      .locator(
        `[data-workload-assignee="${c.actor.id}"] [data-workload-metric="overdue"]`,
      )
      .click();
    await valueIs(panel.getByLabel(al.assignee, { exact: true }), c.actor.id);
    assert.equal(
      await panel.getByLabel(al.collection, { exact: true }).inputValue(),
      g.collection.id,
    );
    assert.equal(
      await panel.getByLabel(al.query, { exact: true }).inputValue(),
      "Scoped",
    );
    assert.equal(
      await panel.getByLabel(al.due, { exact: true }).inputValue(),
      "overdue",
    );
    await panel.locator(`[data-action-task="${tasks[0].id}"]`).waitFor();
    assert.equal(await panel.locator("[data-action-task]").count(), 1);
    await panel.getByRole("button", { name: l.title, exact: true }).click();
    assert.equal(
      await workload.getByLabel(l.query, { exact: true }).inputValue(),
      "Scoped",
    );
    await workload
      .locator(
        '[data-workload-assignee="unassigned"] [data-workload-metric="active"]',
      )
      .click();
    await valueIs(panel.getByLabel(al.assignee, { exact: true }), "unassigned");
    await panel.locator(`[data-action-task="${tasks[2].id}"]`).waitFor();
    await panel.getByRole("button", { name: l.title, exact: true }).click();
    await workload
      .getByLabel(l.query, { exact: true })
      .fill("No matching task");
    await workload.getByLabel(l.rows, { exact: true }).selectOption("active");
    await workload.getByText(l.empty, { exact: true }).waitFor();
  }
  // Readers get the same scoped counts and original read-only queue links.
  await c.local.db
    .prepare("UPDATE users SET role='viewer' WHERE id=?")
    .run(c.person.id);
  const reader = await browser.newContext({
      viewport: { width: 390, height: 844 },
      timezoneId: "America/Los_Angeles",
    }),
    rp = await reader.newPage();
  rp.on("pageerror", (e) => errors.push(e.message));
  await rp.clock.setFixedTime(new Date("2028-02-29T20:00:00Z"));
  await reader.request.post(base + "/api/auth/login", {
    data: { email: c.person.email, password: c.person.password },
  });
  await rp.goto(base);
  await rp
    .getByRole("button", { name: "Research library", exact: true })
    .click();
  await rp.getByRole("button", { name: "Action center", exact: true }).click();
  await rp.getByRole("button", { name: labels.en.title, exact: true }).click();
  let w = rp.getByRole("region", { name: labels.en.title, exact: true });
  await w
    .locator(
      `[data-workload-assignee="${c.person.id}"] [data-workload-metric="today"]`,
    )
    .click();
  await rp.locator(`[data-action-task="${tasks[1].id}"]`).waitFor();
  assert.equal(
    await rp
      .getByRole("button", { name: actionLabels.en.edit, exact: true })
      .count(),
    0,
  );
  await rp.getByRole("button", { name: labels.en.title, exact: true }).click();
  // Failed refresh clears stale counts; explicit refresh restores them.
  await rp.route("**/api/library/action-center", (route) =>
    route.fulfill({
      status: 500,
      contentType: "application/json",
      body: JSON.stringify({ error: "Synthetic refresh failure" }),
    }),
  );
  await rp
    .getByRole("button", { name: actionLabels.en.refresh, exact: true })
    .click();
  await rp
    .getByRole("alert")
    .filter({ hasText: "Synthetic refresh failure" })
    .waitFor();
  assert.equal(await w.count(), 0);
  await rp.unroute("**/api/library/action-center");
  await rp
    .getByRole("button", { name: actionLabels.en.refresh, exact: true })
    .click();
  await w.waitFor();
  await w
    .getByLabel(actionLabels.en.collection, { exact: true })
    .selectOption(g.collection.id);
  await c.owner(
    `studies/${c.imports[0].s.id}/responses/${c.imports[0].interviewId}`,
    "DELETE",
  );
  await rp
    .getByRole("button", { name: actionLabels.en.refresh, exact: true })
    .click();
  await w
    .getByRole("article", { name: labels.en.totals, exact: true })
    .locator('[data-workload-metric="active"]')
    .getByText(actionLabels.en.active + ": 0", { exact: true })
    .waitFor();
  assert.equal(
    await w
      .getByLabel(actionLabels.en.collection, { exact: true })
      .inputValue(),
    g.collection.id,
  );
  await w
    .getByRole("article", { name: labels.en.totals, exact: true })
    .locator('[data-workload-metric="active"]')
    .click();
  await rp.getByText(actionLabels.en.empty, { exact: true }).waitFor();
  assert.equal(
    await rp
      .getByLabel(actionLabels.en.collection, { exact: true })
      .inputValue(),
    g.collection.id,
  );
  assert.deepEqual(errors, []);
  await reader.close();
  await ctx.close();
  console.log(
    "Follow-up workload EN/ES/FR mobile: exact scoped totals, local dates, assignee pagination, filtered queue navigation, retained scope, empty states, readers, refresh recovery and source erasure passed.",
  );
} finally {
  await browser?.close();
  await stop();
}
