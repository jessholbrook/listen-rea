import { chromium, type Browser } from "playwright";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { start, stop, base } from "./harness";
import { inboxSetup } from "./team-review-inbox-fixture";
import { calendarLabels } from "../src/lib/follow-up-calendar";
import { triageLabels } from "../src/lib/operations-triage";
import { actionLabels } from "../src/lib/research-action-center";
let browser: Browser | undefined;
try {
  await start({ port: 3423 });
  const c = await inboxSetup(),
    groups: any[] = [];
  for (const language of ["en", "es", "fr"] as const) {
    const g: any = await c.create("Calendar browser " + language);
    g.language = language;
    g.tasks = [];
    for (const [dueDate, status] of [
      ["2028-02-28", "open"],
      ["2028-02-29", "in_progress"],
      ["2028-02-29", "completed"],
    ]) {
      const r = await c.owner(
        `library/collections/${g.collection.id}/tasks`,
        "POST",
        {
          requestId: randomUUID(),
          title: `Calendar ${language} task ${g.tasks.length}`,
          dueDate,
          status,
          assigneeId: c.actor.id,
          target: { kind: "interview", id: c.imports[0].interviewId },
        },
      );
      assert.equal(r.status, 201);
      g.tasks.push(r.task);
    }
    groups.push(g);
  }
  const read = async (t: any) =>
    (await c.owner(`library/collections/${t.collectionId}/tasks`)).tasks.find(
      (r: any) => r.id === t.id,
    );
  const edit = async (t: any, date: string) =>
    c.owner(`library/collections/${t.collectionId}/tasks/${t.id}`, "PUT", {
      version: t.version,
      title: t.title,
      status: t.status,
      assigneeId: t.assigneeId,
      dueDate: date,
    });
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
  await page.clock.setFixedTime(new Date("2028-02-29T20:00:00Z"));
  assert.ok(
    (
      await context.request.post(base + "/api/auth/login", {
        data: { email: c.email, password: "saved-library-password" },
      })
    ).ok(),
  );
  async function open(g: any) {
    const language = g.language as "en",
      l = calendarLabels[language],
      a = actionLabels[language],
      t = triageLabels[language];
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
    const panel = page.getByRole("region", { name: a.title, exact: true });
    await panel.getByRole("button", { name: l.title, exact: true }).click();
    const cal = panel.getByRole("region", { name: l.title, exact: true });
    await cal
      .getByLabel(a.collection, { exact: true })
      .selectOption(g.collection.id);
    await cal.getByLabel(l.month, { exact: true }).fill("2028-02");
    return { panel, cal, l, a, t };
  }
  for (const g of groups) {
    let { panel, cal, l, a, t } = await open(g);
    assert.equal(
      await cal
        .locator('[data-calendar-day="2028-02-29"] strong')
        .textContent(),
      "1",
    );
    await cal.getByLabel(a.status, { exact: true }).selectOption("all");
    await page.waitForFunction(
      () =>
        document.querySelector('[data-calendar-day="2028-02-29"] strong')
          ?.textContent === "2",
    );
    await cal.getByLabel(a.status, { exact: true }).selectOption("active");
    await cal.locator('[data-calendar-day="2028-02-28"]').click();
    await cal.getByRole("button", { name: l.reschedule, exact: true }).click();
    let triage = cal.getByRole("region", { name: l.reschedule, exact: true });
    assert.equal(
      await triage.getByLabel(t.assignee, { exact: true }).count(),
      0,
    );
    await triage
      .locator(`[data-triage-task="${g.tasks[0].id}"]`)
      .getByRole("checkbox")
      .check();
    await cal.locator('[data-calendar-day="2028-02-29"]').click();
    await triage
      .locator(`[data-triage-task="${g.tasks[1].id}"]`)
      .getByRole("checkbox")
      .check();
    await triage
      .getByText(`${t.selected}: 2/25 · ${t.hidden}: 1`, { exact: true })
      .waitFor();
    await triage.getByLabel(t.due, { exact: true }).selectOption("set");
    await triage.getByLabel(t.date, { exact: true }).fill("2028-03-12");
    await triage.getByRole("button", { name: t.preview, exact: true }).click();
    await triage.getByText(t.ready, { exact: true }).first().waitFor();
    assert.equal(
      await panel.getByLabel(a.language, { exact: true }).isDisabled(),
      true,
    );
    assert.equal(
      await cal.getByLabel(l.month, { exact: true }).isDisabled(),
      true,
    );
    assert.equal(
      await triage
        .getByRole("button", { name: t.apply, exact: true })
        .isDisabled(),
      true,
    );
    await cal.screenshot({
      path: `test-results/calendar-preview-${g.language}.png`,
    });
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth,
      ),
      false,
    );
    await triage.getByRole("button", { name: t.cancel, exact: true }).click();
    await cal.locator(`[data-calendar-task="${g.tasks[1].id}"]`).waitFor();
    assert.deepEqual(await read(g.tasks[0]), g.tasks[0]);
    await cal.getByRole("button", { name: l.whole, exact: true }).click();
    await cal.getByRole("button", { name: l.reschedule, exact: true }).click();
    triage = cal.getByRole("region", { name: l.reschedule, exact: true });
    for (const task of g.tasks.slice(0, 2))
      await triage
        .locator(`[data-triage-task="${task.id}"]`)
        .getByRole("checkbox")
        .check();
    await triage.getByLabel(t.due, { exact: true }).selectOption("set");
    await triage.getByLabel(t.date, { exact: true }).fill("2028-03-12");
    await triage.getByRole("button", { name: t.preview, exact: true }).click();
    await triage.getByText(t.ready, { exact: true }).first().waitFor();
    assert.equal((await edit(g.tasks[1], "2028-03-14")).status, 200);
    await triage.getByLabel(t.ack, { exact: true }).check();
    await triage.getByRole("button", { name: t.apply, exact: true }).click();
    await triage
      .locator(`[data-triage-result="${g.tasks[0].id}"]`)
      .getByText(t.applied, { exact: true })
      .waitFor();
    await triage
      .locator(`[data-triage-result="${g.tasks[1].id}"]`)
      .getByText(t.conflict, { exact: true })
      .waitFor();
    const saved = await read(g.tasks[0]);
    assert.equal(saved.assigneeId, c.actor.id);
    assert.equal(saved.status, g.tasks[0].status);
    await triage.getByRole("button", { name: t.finish, exact: true }).click();
    await cal.getByText(l.empty, { exact: true }).waitFor();
    assert.equal(
      await cal.getByLabel(l.month, { exact: true }).inputValue(),
      "2028-02",
    );
    await cal.getByRole("button", { name: l.next, exact: true }).click();
    await cal.locator(`[data-calendar-task="${g.tasks[0].id}"]`).waitFor();
    await cal.locator('[data-calendar-day="2028-03-12"]').click();
    await cal.getByRole("button", { name: l.reschedule, exact: true }).click();
    triage = cal.getByRole("region", { name: l.reschedule, exact: true });
    await triage
      .locator(`[data-triage-task="${g.tasks[0].id}"]`)
      .getByRole("checkbox")
      .check();
    await triage.getByLabel(t.due, { exact: true }).selectOption("clear");
    await triage.getByRole("button", { name: t.preview, exact: true }).click();
    await triage.getByText(t.ready, { exact: true }).waitFor();
    await triage.getByLabel(t.ack, { exact: true }).check();
    await triage.getByRole("button", { name: t.apply, exact: true }).click();
    await triage.getByText(t.applied, { exact: true }).waitFor();
    await triage.getByRole("button", { name: t.finish, exact: true }).click();
    await cal.getByText(l.empty, { exact: true }).waitFor();
    await cal
      .getByRole("button", { name: `${a.undated} (1)`, exact: true })
      .click();
    await cal.locator(`[data-calendar-task="${g.tasks[0].id}"]`).waitFor();
  }
  // Reader drill-down uses the original fresh task projection, without editor controls.
  await c.local.db
    .prepare("UPDATE users SET role='viewer' WHERE id=?")
    .run(c.person.id);
  const reader = await browser.newContext({
    viewport: { width: 390, height: 844 },
    timezoneId: "America/Los_Angeles",
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
  await rp
    .getByRole("button", { name: calendarLabels.en.title, exact: true })
    .click();
  const rc = rp.getByRole("region", {
    name: calendarLabels.en.title,
    exact: true,
  });
  await rc
    .getByLabel(actionLabels.en.collection, { exact: true })
    .selectOption(groups[0].collection.id);
  await rc
    .getByRole("button", {
      name: `${actionLabels.en.undated} (1)`,
      exact: true,
    })
    .click();
  assert.equal(
    await rc
      .getByRole("button", { name: calendarLabels.en.reschedule, exact: true })
      .count(),
    0,
  );
  await rc
    .locator(`[data-calendar-task="${groups[0].tasks[0].id}"]`)
    .getByRole("button", { name: calendarLabels.en.open, exact: true })
    .click();
  await rp.locator(`[data-action-task="${groups[0].tasks[0].id}"]`).waitFor();
  await reader.close();
  // Unknown response after a committed write must not trigger another apply.
  const g = groups[0];
  let { cal, l, t } = await open(g);
  await cal.getByLabel(l.month, { exact: true }).fill("2028-03");
  await cal.locator('[data-calendar-day="2028-03-14"]').click();
  await cal.getByRole("button", { name: l.reschedule, exact: true }).click();
  let triage = cal.getByRole("region", { name: l.reschedule, exact: true });
  await triage
    .locator(`[data-triage-task="${g.tasks[1].id}"]`)
    .getByRole("checkbox")
    .check();
  await triage.getByLabel(t.due, { exact: true }).selectOption("set");
  await triage.getByLabel(t.date, { exact: true }).fill("2028-03-15");
  await triage.getByRole("button", { name: t.preview, exact: true }).click();
  await triage.getByText(t.ready, { exact: true }).waitFor();
  let applyCalls = 0;
  await page.route("**/api/library/operations-triage/apply", async (route) => {
    applyCalls++;
    await route.fetch();
    await route.abort("failed");
  });
  await triage.getByLabel(t.ack, { exact: true }).check();
  await triage.getByRole("button", { name: t.apply, exact: true }).click();
  await triage.getByRole("alert").waitFor();
  assert.equal(applyCalls, 1);
  assert.equal((await read(g.tasks[1])).dueDate, "2028-03-15");
  assert.equal(
    await triage.getByRole("button", { name: t.apply, exact: true }).count(),
    0,
  );
  await page.unroute("**/api/library/operations-triage/apply");
  await triage.getByRole("button", { name: t.finish, exact: true }).click();
  await cal.getByText(l.empty, { exact: true }).waitFor();
  await cal.locator('[data-calendar-day="2028-03-15"]').click();
  await cal.getByRole("button", { name: l.reschedule, exact: true }).click();
  triage = cal.getByRole("region", { name: l.reschedule, exact: true });
  await triage
    .locator(`[data-triage-task="${g.tasks[1].id}"]`)
    .getByRole("checkbox")
    .check();
  await triage.getByLabel(t.due, { exact: true }).selectOption("clear");
  await triage.getByRole("button", { name: t.preview, exact: true }).click();
  await triage.getByText(t.ready, { exact: true }).waitFor();
  await c.owner(
    `studies/${c.imports[0].s.id}/responses/${c.imports[0].interviewId}`,
    "DELETE",
  );
  await triage.getByLabel(t.ack, { exact: true }).check();
  await triage.getByRole("button", { name: t.apply, exact: true }).click();
  await triage.getByText(t.unavailable, { exact: true }).waitFor();
  await triage.getByRole("button", { name: t.finish, exact: true }).click();
  await cal.getByText(l.empty, { exact: true }).waitFor();
  assert.equal(
    await cal.locator('[data-calendar-day="2028-03-15"] strong').textContent(),
    "0",
  );
  await page.goto(base);
  await page
    .getByRole("button", { name: "Research library", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Operations home", exact: true })
    .click();
  await page
    .getByRole("button", { name: calendarLabels.en.title, exact: true })
    .click();
  await page
    .getByRole("region", { name: calendarLabels.en.title, exact: true })
    .waitFor();
  assert.deepEqual(errors, []);
  await context.close();
  console.log(
    "EN/ES/FR mobile follow-up calendar: month/day counts, completed filters, cross-date selections, reviewed date-only changes, cancellation, partial conflicts, undated work, reader drill-down, dropped-response recovery and source erasure passed.",
  );
} finally {
  await browser?.close();
  await stop();
}
