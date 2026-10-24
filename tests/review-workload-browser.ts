import { chromium, type Browser, type Locator } from "playwright";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { start, stop, base } from "./harness";
import { workloadSetup } from "./review-workload-fixture";
import { feedbackAction } from "./team-review-inbox-fixture";
import { workloadLabels } from "../src/lib/review-workload";
import { inboxLabels } from "../src/lib/team-review-inbox";
import { handoffLabels } from "../src/lib/collection-handoff";
import { feedbackLabels } from "../src/lib/handoff-feedback";
import { deadlineLabels } from "../src/lib/review-deadlines";
async function disabled(locator: Locator) {
  for (let n = 0; n < 50; n++) {
    if (await locator.isDisabled()) return;
    await new Promise((r) => setTimeout(r, 100));
  }
  assert.equal(await locator.isDisabled(), true);
}
let browser: Browser | undefined;
try {
  await start({ port: 3396 });
  const c = await workloadSetup(),
    groups = [];
  for (const language of ["en", "es", "fr"] as const) {
    const g = await c.create(
      "Synthetic workload " + language,
      [c.actor.id, c.person.id],
      language,
    );
    let d = g.d;
    for (const [reviewerId, dueDate] of [
      [c.actor.id, "2028-03-01"],
      [c.person.id, "2028-02-27"],
    ])
      d = await c.owner(
        g.path + "/feedback",
        "POST",
        feedbackAction(d, { op: "deadline", reviewerId, dueDate }),
      );
    d = await c.owner(
      g.path + "/feedback",
      "POST",
      feedbackAction(d, { op: "decision", approved: true }),
    );
    groups.push({ ...g, language, d });
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
  await page.clock.setFixedTime(new Date("2028-02-28T20:00:00Z"));
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
  await page.getByRole("button", { name: "Review inbox", exact: true }).click();
  await page
    .getByRole("button", { name: workloadLabels.en.tab, exact: true })
    .click();
  await page.locator(`[data-workload-member="${c.person.id}"]`).waitFor();
  assert.equal(
    await page
      .locator("[data-workload-member]")
      .first()
      .getAttribute("data-workload-member"),
    c.person.id,
  );
  let previous = "en" as "en" | "es" | "fr";
  for (const g of groups) {
    const l = workloadLabels[g.language],
      il = inboxLabels[g.language],
      h = handoffLabels[g.language],
      f = feedbackLabels[g.language],
      dl = deadlineLabels[g.language];
    await page
      .getByLabel(inboxLabels[previous].language, { exact: true })
      .selectOption(g.language);
    previous = g.language;
    const inbox = page.getByRole("region", { name: il.title, exact: true }),
      panel = inbox.getByRole("region", { name: l.title, exact: true });
    await panel
      .getByLabel(il.collection, { exact: true })
      .selectOption(g.collection.id);
    const source = panel.locator(`[data-workload-member="${c.person.id}"]`),
      replacement = panel.locator(
        `[data-workload-member="${c.replacement.id}"]`,
      );
    await source
      .getByText(l.remaining + ": 1 · " + dl.overdue + ": 1", { exact: true })
      .waitFor();
    await source.getByRole("button", { name: l.show, exact: true }).click();
    const detail = panel.getByRole("region", { name: l.requests, exact: true }),
      row = detail.locator(`[data-workload-request="${g.d.packet.id}"]`);
    await row.getByRole("button", { name: l.reassign, exact: true }).click();
    const form = panel.getByRole("form", { name: l.reassign, exact: true });
    await form.getByLabel(l.replacement, { exact: true }).waitFor();
    await disabled(
      inbox.getByRole("button", { name: il.refresh, exact: true }),
    );
    await disabled(
      inbox.getByRole("button", { name: l.requests, exact: true }),
    );
    await disabled(form.getByRole("button", { name: l.save, exact: true }));
    assert.equal(
      await form.locator(`option[value="${c.actor.id}"]`).count(),
      0,
    );
    assert.equal(
      await form.locator(`option[value="${c.person.id}"]`).count(),
      0,
    );
    await form
      .getByLabel(l.replacement, { exact: true })
      .selectOption(c.replacement.id);
    await disabled(form.getByRole("button", { name: l.save, exact: true }));
    await form
      .getByRole("checkbox", { name: l.acknowledge, exact: true })
      .check();
    await form.screenshot({
      path: `test-results/workload-plan-${g.language}.png`,
    });
    if (g.language === "en") {
      await form.getByRole("button", { name: l.cancel, exact: true }).click();
      assert.equal(
        (await c.owner(g.path)).feedback.reviewers[1].id,
        c.person.id,
      );
      await row.getByRole("button", { name: l.reassign, exact: true }).click();
      await form
        .getByLabel(l.replacement, { exact: true })
        .selectOption(c.replacement.id);
      await form
        .getByRole("checkbox", { name: l.acknowledge, exact: true })
        .check();
    }
    await form.getByRole("button", { name: l.save, exact: true }).click();
    await inbox.getByText(l.saved, { exact: true }).waitFor();
    await detail.getByText(l.none, { exact: true }).waitFor();
    await replacement
      .getByText(l.remaining + ": 1 · " + dl.overdue + ": 1", { exact: true })
      .waitFor();
    await replacement.screenshot({
      path: `test-results/workload-member-${g.language}.png`,
    });
    assert.equal(
      await panel.getByLabel(il.collection, { exact: true }).inputValue(),
      g.collection.id,
    );
    await replacement
      .getByRole("button", { name: l.show, exact: true })
      .click();
    await row.getByRole("button", { name: il.open, exact: true }).click();
    const packet = inbox.getByRole("region", { name: h.title, exact: true }),
      feedback = packet.getByRole("region", { name: f.title, exact: true });
    await feedback
      .locator(`[data-handoff-reviewer="${c.replacement.id}"]`)
      .waitFor();
    assert.equal(
      await feedback
        .locator(`[data-handoff-reviewer="${c.person.id}"]`)
        .count(),
      0,
    );
    await feedback
      .getByRole("button", { name: f.approve, exact: true })
      .waitFor();
    assert.equal(
      await feedback
        .getByRole("button", { name: f.withdraw, exact: true })
        .count(),
      0,
    );
    if (g.language === "en") {
      const other = await browser.newContext({
          viewport: { width: 390, height: 844 },
        }),
        person = await other.newPage();
      person.on("pageerror", (e) => errors.push(e.message));
      assert.ok(
        (
          await other.request.post(base + "/api/auth/login", {
            data: {
              email: c.replacement.email,
              password: c.replacement.password,
            },
          })
        ).ok(),
      );
      await person.goto(base);
      await person
        .getByRole("button", { name: "Research library", exact: true })
        .click();
      await person
        .getByRole("button", { name: "Review inbox", exact: true })
        .click();
      await person
        .locator(`[data-review-packet="${g.d.packet.id}"]`)
        .getByRole("button", { name: il.open, exact: true })
        .click();
      await person
        .getByRole("region", { name: f.title, exact: true })
        .getByRole("button", { name: f.approve, exact: true })
        .click();
      await person
        .getByRole("button", { name: f.withdraw, exact: true })
        .waitFor();
      await packet
        .getByRole("button", { name: h.refresh, exact: true })
        .click();
      await feedback
        .getByRole("button", { name: f.approve, exact: true })
        .click();
      await feedback
        .getByRole("button", { name: f.withdraw, exact: true })
        .waitFor();
      await packet
        .getByRole("checkbox", { name: h.attest, exact: true })
        .check();
      await packet
        .getByRole("button", { name: h.approve, exact: true })
        .click();
      await packet.getByText(h.reviewed, { exact: true }).waitFor();
      await other.close();
    }
    await inbox.getByRole("button", { name: il.close, exact: true }).click();
    await panel.getByLabel(il.collection, { exact: true }).waitFor();
    assert.equal(
      await panel.getByLabel(il.collection, { exact: true }).inputValue(),
      g.collection.id,
    );
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth + 1,
      ),
      true,
    );
  }
  const l = workloadLabels.fr,
    il = inboxLabels.fr,
    dl = deadlineLabels.fr,
    inbox = page.getByRole("region", { name: il.title, exact: true }),
    panel = inbox.getByRole("region", { name: l.title, exact: true });
  const g = await c.create("Synthetic stale workload", [c.person.id]);
  let d = await c.owner(
    g.path + "/feedback",
    "POST",
    feedbackAction(g.d, {
      op: "deadline",
      reviewerId: c.person.id,
      dueDate: "2028-02-27",
    }),
  );
  await inbox.getByRole("button", { name: il.refresh, exact: true }).click();
  await panel
    .getByLabel(il.collection, { exact: true })
    .selectOption(g.collection.id);
  await panel
    .locator(`[data-workload-member="${c.person.id}"]`)
    .getByRole("button", { name: l.show, exact: true })
    .click();
  const detail = panel.getByRole("region", { name: l.requests, exact: true }),
    row = detail.locator(`[data-workload-request="${g.d.packet.id}"]`),
    form = panel.getByRole("form", { name: l.reassign, exact: true });
  await row.getByRole("button", { name: l.reassign, exact: true }).click();
  await form
    .getByLabel(l.replacement, { exact: true })
    .selectOption(c.replacement.id);
  await form
    .getByRole("checkbox", { name: l.acknowledge, exact: true })
    .check();
  d = await c.owner(g.path);
  await c.owner(
    g.path + "/feedback",
    "POST",
    feedbackAction(d, {
      op: "deadline",
      reviewerId: c.person.id,
      dueDate: "2028-03-02",
    }),
  );
  await form.getByRole("button", { name: l.save, exact: true }).click();
  await inbox.getByRole("alert").waitFor();
  assert.equal(await inbox.locator("[data-workload-member]").count(), 0);
  await inbox.getByRole("button", { name: il.refresh, exact: true }).click();
  assert.equal(
    await panel.getByLabel(il.collection, { exact: true }).inputValue(),
    g.collection.id,
  );
  await row.waitFor();
  await row.getByRole("button", { name: l.reassign, exact: true }).click();
  await form
    .getByLabel(l.replacement, { exact: true })
    .selectOption(c.replacement.id);
  await form
    .getByRole("checkbox", { name: l.acknowledge, exact: true })
    .check();
  await c.local.db
    .prepare("UPDATE users SET role='viewer' WHERE id=?")
    .run(c.replacement.id);
  await form.getByRole("button", { name: l.save, exact: true }).click();
  await inbox.getByRole("alert").waitFor();
  await c.local.db
    .prepare("UPDATE users SET role='collaborator' WHERE id=?")
    .run(c.replacement.id);
  await c.local.db
    .prepare("UPDATE users SET workspace_id=? WHERE id=?")
    .run(randomUUID(), c.person.id);
  await inbox.getByRole("button", { name: il.refresh, exact: true }).click();
  await panel
    .locator(`[data-workload-member="${c.person.id}"]`)
    .getByRole("button", { name: l.show, exact: true })
    .click();
  await row.getByRole("button", { name: l.reassign, exact: true }).click();
  await form
    .getByLabel(l.replacement, { exact: true })
    .selectOption(c.actor.id);
  await form
    .getByRole("checkbox", { name: l.acknowledge, exact: true })
    .check();
  await form.getByRole("button", { name: l.save, exact: true }).click();
  await inbox.getByText(l.saved, { exact: true }).waitFor();
  await detail.getByText(l.none, { exact: true }).waitFor();
  assert.equal(
    await panel.locator(`[data-workload-member="${c.person.id}"]`).count(),
    0,
  );
  await c.local.db
    .prepare("UPDATE users SET workspace_id=?,role='viewer' WHERE id=?")
    .run(c.actor.workspaceId, c.person.id);
  const readerContext = await browser.newContext({
      viewport: { width: 390, height: 844 },
    }),
    reader = await readerContext.newPage();
  reader.on("pageerror", (e) => errors.push(e.message));
  assert.ok(
    (
      await readerContext.request.post(base + "/api/auth/login", {
        data: { email: c.person.email, password: c.person.password },
      })
    ).ok(),
  );
  await reader.goto(base);
  await reader
    .getByRole("button", { name: "Research library", exact: true })
    .click();
  await reader
    .getByRole("button", { name: "Review inbox", exact: true })
    .click();
  await reader
    .getByRole("button", { name: workloadLabels.en.tab, exact: true })
    .click();
  const readerPanel = reader.getByRole("region", {
    name: workloadLabels.en.title,
    exact: true,
  });
  await readerPanel
    .locator(`[data-workload-member="${c.actor.id}"]`)
    .getByRole("button", { name: workloadLabels.en.show, exact: true })
    .click();
  assert.equal(
    await readerPanel
      .getByRole("button", { name: workloadLabels.en.reassign, exact: true })
      .count(),
    0,
  );
  await readerContext.close();
  for (let n = 0; n < 21; n++)
    await c.local.db
      .prepare(
        "INSERT INTO users(id,email,name,password,workspace_id,role) VALUES(?,?,?,?,?,?)",
      )
      .run(
        randomUUID(),
        randomUUID() + "@example.test",
        "Synthetic idle reviewer " + n,
        c.local.passwordHash("synthetic-idle-password"),
        c.actor.workspaceId,
        "collaborator",
      );
  await inbox.getByRole("button", { name: il.refresh, exact: true }).click();
  await panel.getByText(l.people + ": 23", { exact: true }).waitFor();
  assert.equal(await panel.locator("[data-workload-member]").count(), 20);
  await panel.getByRole("button", { name: il.next, exact: true }).click();
  assert.equal(await panel.locator("[data-workload-member]").count(), 3);
  await panel.getByRole("button", { name: il.previous, exact: true }).click();
  for (let n = 0; n < 21; n++)
    await c.create("Synthetic workload paging " + n, [c.actor.id]);
  await inbox.getByRole("button", { name: il.refresh, exact: true }).click();
  await panel.getByRole("button", { name: il.reset, exact: true }).click();
  await panel
    .locator(`[data-workload-member="${c.actor.id}"]`)
    .getByRole("button", { name: l.show, exact: true })
    .click();
  assert.equal(await detail.locator("[data-workload-request]").count(), 20);
  await detail.getByRole("button", { name: il.next, exact: true }).click();
  assert.equal(await detail.locator("[data-workload-request]").count(), 4);
  const midnight = await c.create("Synthetic workload midnight", [c.actor.id]);
  d = await c.owner(
    midnight.path + "/feedback",
    "POST",
    feedbackAction(midnight.d, {
      op: "deadline",
      reviewerId: c.actor.id,
      dueDate: "2028-02-28",
    }),
  );
  await inbox.getByRole("button", { name: il.refresh, exact: true }).click();
  await panel
    .getByLabel(il.collection, { exact: true })
    .selectOption(midnight.collection.id);
  const owner = panel.locator(`[data-workload-member="${c.actor.id}"]`);
  await owner
    .getByText(l.remaining + ": 1 · " + dl.overdue + ": 0", { exact: true })
    .waitFor();
  await page.clock.setFixedTime(new Date("2028-02-29T08:00:00Z"));
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await owner
    .getByText(l.remaining + ": 1 · " + dl.overdue + ": 1", { exact: true })
    .waitFor();
  await c.owner("library/collections/" + midnight.collection.id, "DELETE", {
    version: midnight.collection.version,
  });
  await inbox.getByRole("button", { name: il.refresh, exact: true }).click();
  await panel.getByLabel(il.collection, { exact: true }).waitFor();
  assert.equal(
    await panel.getByLabel(il.collection, { exact: true }).inputValue(),
    midnight.collection.id,
  );
  assert.equal(
    await panel
      .getByLabel(il.collection, { exact: true })
      .locator("option:checked")
      .innerText(),
    il.unavailableCollection,
  );
  await detail.getByText(l.none, { exact: true }).waitFor();
  await c.owner(
    `studies/${c.imports[0].s.id}/responses/${c.imports[0].interviewId}`,
    "DELETE",
  );
  await inbox.getByRole("button", { name: il.refresh, exact: true }).click();
  await panel.getByLabel(il.collection, { exact: true }).waitFor();
  assert.equal(
    (await c.local.list("libraryHandoffFeedback", c.actor.workspaceId)).length,
    0,
  );
  assert.deepEqual(errors, []);
  console.log(
    "EN/ES/FR mobile workload: scoped/idle counts, transfer preview and acknowledgement/cancel, due-date carry and decision reset, replacement-owned review, direct packet navigation, stale/role-conflict recovery, unavailable reviewer recovery, reader-only access, member/request pagination, local-midnight counts and deletion cleanup passed.",
  );
} finally {
  await browser?.close();
  await stop();
}
