import { chromium, type Browser } from "playwright";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { start, stop, base } from "./harness";
import {
  inboxSetup,
  feedbackAction,
  finalReview,
} from "./team-review-inbox-fixture";
import { unifiedLabels } from "../src/lib/unified-planning";
import { inboxLabels } from "../src/lib/team-review-inbox";
import { calendarLabels } from "../src/lib/follow-up-calendar";
import { actionLabels } from "../src/lib/research-action-center";
import { deadlineLabels } from "../src/lib/review-deadlines";
import { triageLabels } from "../src/lib/operations-triage";
let browser: Browser | undefined;
try {
  await start({ port: 3427 });
  const c = await inboxSetup(),
    groups: any[] = [];
  for (const language of ["en", "es", "fr"] as const) {
    const g: any = await c.create(
      "Unified browser " + language,
      [c.actor.id, c.person.id],
      language,
    );
    g.language = language;
    let d = g.d;
    for (const reviewerId of [c.actor.id, c.person.id])
      d = await c.owner(
        g.path + "/feedback",
        "POST",
        feedbackAction(d, {
          op: "deadline",
          reviewerId,
          dueDate: "2028-02-29",
        }),
      );
    g.tasks = [];
    for (const [dueDate, status] of [
      ["2028-02-28", "open"],
      [null, "open"],
      ["2028-02-29", "completed"],
    ]) {
      const r = await c.owner(
        `library/collections/${g.collection.id}/tasks`,
        "POST",
        {
          requestId: randomUUID(),
          title: "Unified task " + language + " " + g.tasks.length,
          dueDate,
          status,
          assigneeId: c.actor.id,
          target: { kind: "interview", id: c.imports[0].interviewId },
        },
      );
      assert.equal(r.status, 201);
      g.tasks.push(r.task);
    }
    d = await c.owner(g.path);
    for (const call of [c.owner, c.person.call])
      d = await call(
        g.path + "/feedback",
        "POST",
        feedbackAction(d, { op: "decision", approved: true }),
      );
    d = await c.owner(g.path + "/review", "POST", finalReview(d));
    assert.equal(d.packet.canExport, true);
    groups.push(g);
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
  await page.clock.setFixedTime(new Date("2028-02-29T20:00:00Z"));
  await context.request.post(base + "/api/auth/login", {
    data: { email: c.email, password: "saved-library-password" },
  });
  const key = (g: any, id = c.actor.id) => `review:${g.d.packet.id}:${id}`;
  async function open(g: any, month = "2028-02") {
    await page.goto(base);
    await page
      .getByRole("button", { name: "Research library", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Research planning", exact: true })
      .click();
    const language = g.language as "en",
      l = unifiedLabels[language],
      a = actionLabels[language],
      cl = calendarLabels[language],
      dl = deadlineLabels[language];
    if (language !== "en")
      await page
        .getByLabel(actionLabels.en.language, { exact: true })
        .selectOption(language);
    const panel = page.getByRole("region", { name: l.title, exact: true });
    await panel
      .getByLabel(a.collection, { exact: true })
      .selectOption(g.collection.id);
    await panel.getByLabel(cl.month, { exact: true }).fill(month);
    return { panel, l, a, cl, dl };
  }
  for (const g of groups) {
    let { panel, l, a, cl, dl } = await open(g);
    await panel
      .locator(`[data-planning-item="task:${g.tasks[0].id}"]`)
      .waitFor();
    assert.equal(
      await panel
        .locator('[data-planning-day="2028-02-29"] strong')
        .textContent(),
      "0",
    );
    await panel.getByLabel(l.finished, { exact: true }).check();
    await page.waitForFunction(
      () =>
        document.querySelector('[data-planning-day="2028-02-29"] strong')
          ?.textContent === "3",
    );
    await panel
      .getByRole("button", { name: `${a.undated} (1)`, exact: true })
      .click();
    assert.equal(
      await panel.getByLabel(l.finished, { exact: true }).isDisabled(),
      true,
    );
    assert.equal(
      await panel.getByLabel(l.finished, { exact: true }).isChecked(),
      false,
    );
    await panel
      .locator(`[data-planning-item="task:${g.tasks[1].id}"]`)
      .waitFor();
    await panel.getByRole("button", { name: cl.whole, exact: true }).click();
    await panel.getByLabel(l.finished, { exact: true }).check();
    await panel.getByLabel(l.kind, { exact: true }).selectOption("reviews");
    await panel.getByLabel(l.person, { exact: true }).selectOption("mine");
    await panel.locator('[data-planning-day="2028-02-29"]').click();
    const row = panel.locator(`[data-planning-item="${key(g)}"]`);
    await row.waitFor();
    const original = await c.owner(g.path);
    await row.getByRole("button", { name: l.schedule, exact: true }).click();
    let editor = panel.getByRole("region", { name: l.schedule, exact: true });
    await editor.getByLabel(dl.due, { exact: true }).fill("2028-03-12");
    await editor.getByRole("button", { name: l.preview, exact: true }).click();
    await editor.getByText(`${l.after}: 2028-03-12`, { exact: true }).waitFor();
    assert.equal(
      await editor
        .getByRole("button", { name: l.apply, exact: true })
        .isDisabled(),
      true,
    );
    assert.equal(
      await panel.getByLabel(cl.month, { exact: true }).isDisabled(),
      true,
    );
    assert.equal(
      await panel.getByLabel(a.language, { exact: true }).isDisabled(),
      true,
    );
    await panel.screenshot({
      path: `test-results/unified-preview-${g.language}.png`,
    });
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth,
      ),
      false,
    );
    await editor.getByRole("button", { name: l.cancel, exact: true }).click();
    await row.waitFor();
    assert.equal(
      (await c.owner(g.path)).feedback.version,
      original.feedback.version,
    );
    await row.getByRole("button", { name: l.schedule, exact: true }).click();
    editor = panel.getByRole("region", { name: l.schedule, exact: true });
    await editor.getByLabel(dl.due, { exact: true }).fill("2028-03-12");
    await editor.getByRole("button", { name: l.preview, exact: true }).click();
    await editor.getByText(`${l.after}: 2028-03-12`, { exact: true }).waitFor();
    await c.owner(
      g.path + "/feedback",
      "POST",
      feedbackAction(await c.owner(g.path), {
        op: "deadline",
        reviewerId: c.person.id,
        dueDate: "2028-03-14",
      }),
    );
    await editor.getByLabel(l.ack, { exact: true }).check();
    await editor.getByRole("button", { name: l.apply, exact: true }).click();
    await editor.getByRole("alert").waitFor();
    assert.equal(
      await editor.getByRole("button", { name: l.apply, exact: true }).count(),
      0,
    );
    await editor.getByRole("button", { name: l.finish, exact: true }).click();
    await row.waitFor();
    await row.getByRole("button", { name: l.schedule, exact: true }).click();
    editor = panel.getByRole("region", { name: l.schedule, exact: true });
    await editor.getByLabel(dl.due, { exact: true }).fill("2028-03-12");
    await editor.getByRole("button", { name: l.preview, exact: true }).click();
    await editor.getByText(`${l.after}: 2028-03-12`, { exact: true }).waitFor();
    await editor.getByLabel(l.ack, { exact: true }).check();
    await editor.getByRole("button", { name: l.apply, exact: true }).click();
    await editor.getByText(l.saved, { exact: true }).waitFor();
    const saved = await c.owner(g.path);
    assert.equal(saved.packet.canExport, true);
    assert.equal(saved.packet.reviewedAt, original.packet.reviewedAt);
    assert.deepEqual(
      saved.feedback.reviewers.map((r: any) => r.approvedAt),
      original.feedback.reviewers.map((r: any) => r.approvedAt),
    );
    await editor.getByRole("button", { name: l.finish, exact: true }).click();
    await panel.getByText(l.empty, { exact: true }).waitFor();
    assert.equal(
      await panel.getByLabel(cl.month, { exact: true }).inputValue(),
      "2028-02",
    );
    // Current packet and exact task navigation use original editors.
    await panel.getByLabel(cl.month, { exact: true }).fill("2028-03");
    await panel
      .locator(`[data-planning-item="${key(g)}"]`)
      .getByRole("button", { name: l.open, exact: true })
      .click();
    await page
      .getByRole("button", { name: languageClose(g.language), exact: true })
      .waitFor();
    ({ panel, l, a, cl, dl } = await open(g));
    await panel
      .locator(`[data-planning-item="task:${g.tasks[0].id}"]`)
      .getByRole("button", { name: l.open, exact: true })
      .click();
    await page.getByLabel(a.titleField, { exact: true }).waitFor();
    assert.equal(
      await page.getByLabel(a.titleField, { exact: true }).inputValue(),
      g.tasks[0].title,
    );
    ({ panel, l, a, cl, dl } = await open(g));
    await panel
      .getByRole("button", { name: l.taskSchedule, exact: true })
      .click();
    const triage = panel.getByRole("region", {
        name: cl.reschedule,
        exact: true,
      }),
      tl = triageLabels[g.language as "en"];
    await triage
      .locator(`[data-triage-task="${g.tasks[0].id}"]`)
      .getByRole("checkbox")
      .check();
    await triage.getByLabel(tl.due, { exact: true }).selectOption("set");
    await triage.getByLabel(tl.date, { exact: true }).fill("2028-03-20");
    await triage.getByRole("button", { name: tl.preview, exact: true }).click();
    await triage.getByText(tl.ready, { exact: true }).waitFor();
    await triage.getByLabel(tl.ack, { exact: true }).check();
    await triage.getByRole("button", { name: tl.apply, exact: true }).click();
    await triage.getByText(tl.applied, { exact: true }).waitFor();
    await triage.getByRole("button", { name: tl.finish, exact: true }).click();
    await panel.getByText(l.empty, { exact: true }).waitFor();
  }
  function languageClose(lang: string) {
    return inboxLabels[lang as "en"].close;
  }
  // Atomic read failure clears both agendas and requires an explicit refresh.
  const g = groups[0];
  let { panel, l, a, cl, dl } = await open(g, "2028-03");
  await panel.locator(`[data-planning-item="task:${g.tasks[0].id}"]`).waitFor();
  await page.route("**/api/library/unified-planning", (r) =>
    r.fulfill({
      status: 503,
      contentType: "application/json",
      body: JSON.stringify({ error: "Synthetic unavailable" }),
    }),
  );
  await panel.getByRole("button", { name: l.refresh, exact: true }).click();
  await panel.getByRole("alert").waitFor();
  assert.equal(await panel.locator("[data-planning-item]").count(), 0);
  assert.equal(await panel.locator("[data-planning-day]").count(), 0);
  await page.unroute("**/api/library/unified-planning");
  await panel.getByRole("button", { name: l.refresh, exact: true }).click();
  await panel.locator(`[data-planning-item="task:${g.tasks[0].id}"]`).waitFor();
  await panel.getByLabel(l.finished, { exact: true }).check();
  await panel
    .locator(`[data-planning-item="${key(g)}"]`)
    .getByRole("button", { name: l.schedule, exact: true })
    .click();
  let editor = panel.getByRole("region", { name: l.schedule, exact: true });
  await editor.getByLabel(dl.due, { exact: true }).fill("2028-03-16");
  await editor.getByRole("button", { name: l.preview, exact: true }).click();
  await editor.getByText(`${l.after}: 2028-03-16`, { exact: true }).waitFor();
  let writes = 0;
  await page.route("**/handoff/feedback", async (route) => {
    writes++;
    await route.fetch();
    await route.abort("failed");
  });
  await editor.getByLabel(l.ack, { exact: true }).check();
  await editor.getByRole("button", { name: l.apply, exact: true }).click();
  await editor.getByRole("alert").waitFor();
  assert.equal(writes, 1);
  assert.equal(
    (await c.owner(g.path)).feedback.reviewers.find(
      (r: any) => r.id === c.actor.id,
    ).dueDate,
    "2028-03-16",
  );
  await page.unroute("**/handoff/feedback");
  await editor.getByRole("button", { name: l.finish, exact: true }).click();
  await panel.locator(`[data-planning-item="${key(g)}"]`).waitFor();
  // Readers retain current queues and exact navigation without scheduling controls.
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
    .getByRole("button", { name: "Research planning", exact: true })
    .click();
  const readerPanel = rp.getByRole("region", {
    name: unifiedLabels.en.title,
    exact: true,
  });
  await readerPanel.getByLabel(cl.month, { exact: true }).fill("2028-03");
  await readerPanel.getByLabel(l.finished, { exact: true }).check();
  await readerPanel.locator("[data-planning-item]").first().waitFor();
  assert.equal(
    await readerPanel
      .getByRole("button", { name: l.schedule, exact: true })
      .count(),
    0,
  );
  assert.equal(
    await readerPanel
      .getByRole("button", { name: l.taskSchedule, exact: true })
      .count(),
    0,
  );
  await reader.close();
  await panel
    .locator(`[data-planning-item="${key(g)}"]`)
    .getByRole("button", { name: l.schedule, exact: true })
    .click();
  editor = panel.getByRole("region", { name: l.schedule, exact: true });
  await editor.getByLabel(dl.due, { exact: true }).fill("2028-03-17");
  await editor.getByRole("button", { name: l.preview, exact: true }).click();
  await editor.getByText(`${l.after}: 2028-03-17`, { exact: true }).waitFor();
  await c.owner(
    `studies/${c.imports[0].s.id}/responses/${c.imports[0].interviewId}`,
    "DELETE",
  );
  await editor.getByLabel(l.ack, { exact: true }).check();
  await editor.getByRole("button", { name: l.apply, exact: true }).click();
  await editor.getByRole("alert").waitFor();
  await editor.getByRole("button", { name: l.finish, exact: true }).click();
  await panel.getByText(l.empty, { exact: true }).waitFor();
  assert.equal(await panel.locator("[data-planning-item]").count(), 0);
  await page.goto(base);
  await page
    .getByRole("button", { name: "Research library", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Operations home", exact: true })
    .click();
  await page.getByRole("button", { name: l.title, exact: true }).click();
  await page.getByRole("region", { name: l.title, exact: true }).waitFor();
  assert.deepEqual(errors, []);
  await context.close();
  console.log(
    "EN/ES/FR mobile unified planning: request-level counts, completion/person/date filters, reviewed review deadlines with approval preservation, conflicts/cancel, exact packet/task navigation, task triage, atomic load recovery, one-call dropped-response recovery, reader gates and source erasure passed.",
  );
} finally {
  await browser?.close();
  await stop();
}
