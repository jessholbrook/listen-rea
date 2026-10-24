import { chromium, type Browser, type Locator } from "playwright";
import assert from "node:assert/strict";
import { start, stop, base } from "./harness";
import { inboxSetup, feedbackAction } from "./team-review-inbox-fixture";
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
  await start({ port: 3393 });
  const c = await inboxSetup(),
    groups = [];
  for (const language of ["en", "es", "fr"] as const)
    groups.push({
      ...(await c.create(
        "Synthetic deadlines " + language,
        [c.actor.id],
        language,
      )),
      language,
    });
  const urgent = await c.create("Synthetic urgent schedule", [c.actor.id]);
  const later = await c.create("Synthetic later schedule", [c.actor.id]);
  for (const [g, date] of [
    [urgent, "2028-02-26"],
    [later, "2028-03-03"],
  ] as const)
    assert.equal(
      (
        await c.owner(
          g.path + "/feedback",
          "POST",
          feedbackAction(g.d, {
            op: "deadline",
            reviewerId: c.actor.id,
            dueDate: date,
          }),
        )
      ).status,
      200,
    );
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
  await page.locator(`[data-review-packet="${urgent.d.packet.id}"]`).waitFor();
  assert.equal(
    await page
      .locator("[data-review-packet]")
      .first()
      .getAttribute("data-review-packet"),
    urgent.d.packet.id,
  );
  let previous = "en" as "en" | "es" | "fr";
  for (const g of groups) {
    const l = inboxLabels[g.language],
      h = handoffLabels[g.language],
      f = feedbackLabels[g.language],
      dl = deadlineLabels[g.language],
      date =
        g.language === "en"
          ? "2028-02-27"
          : g.language === "es"
            ? "2028-02-28"
            : "2028-02-29";
    await page
      .getByLabel(inboxLabels[previous].language, { exact: true })
      .selectOption(g.language);
    previous = g.language;
    const inbox = page.getByRole("region", { name: l.title, exact: true }),
      row = inbox.locator(`[data-review-packet="${g.d.packet.id}"]`);
    await inbox
      .getByLabel(l.collection, { exact: true })
      .selectOption(g.collection.id);
    await row.getByRole("button", { name: l.open, exact: true }).click();
    const packet = inbox.getByRole("region", { name: h.title, exact: true }),
      feedback = packet.getByRole("region", { name: f.title, exact: true }),
      reviewer = feedback.locator(`[data-handoff-reviewer="${c.actor.id}"]`);
    await reviewer.getByLabel(dl.due, { exact: true }).fill(date);
    await disabled(packet.getByLabel(h.summary, { exact: true }));
    await disabled(feedback.getByLabel(f.comment, { exact: true }));
    await disabled(
      feedback.getByRole("button", { name: f.approve, exact: true }),
    );
    await reviewer.getByRole("button", { name: dl.save, exact: true }).click();
    await packet.getByText(f.saved, { exact: true }).waitFor();
    assert.equal(
      await reviewer.getByLabel(dl.due, { exact: true }).inputValue(),
      date,
    );
    await feedback.screenshot({
      path: `test-results/review-deadlines-editor-${g.language}.png`,
    });
    await inbox.getByRole("button", { name: l.close, exact: true }).click();
    await row
      .getByText(
        dl.due +
          ": " +
          date +
          (g.language === "en"
            ? " · " + dl.overdue
            : g.language === "es"
              ? " · " + dl.today
              : ""),
        { exact: true },
      )
      .waitFor();
    await row.screenshot({
      path: `test-results/review-deadlines-inbox-${g.language}.png`,
    });
    const due =
      g.language === "en" ? "overdue" : g.language === "es" ? "today" : "week";
    await inbox.getByLabel(dl.window, { exact: true }).selectOption(due);
    assert.equal(await inbox.locator("[data-review-packet]").count(), 1);
    await inbox.getByLabel(dl.window, { exact: true }).selectOption("undated");
    await inbox.getByText(l.empty, { exact: true }).waitFor();
    await inbox.getByLabel(dl.window, { exact: true }).selectOption("");
    await row.getByRole("button", { name: l.open, exact: true }).click();
    await feedback
      .getByRole("button", { name: f.approve, exact: true })
      .click();
    await feedback
      .getByRole("button", { name: f.withdraw, exact: true })
      .waitFor();
    await packet.getByRole("checkbox", { name: h.attest, exact: true }).check();
    await packet.getByRole("button", { name: h.approve, exact: true }).click();
    await packet.getByText(h.reviewed, { exact: true }).waitFor();
    await reviewer.getByLabel(dl.due, { exact: true }).fill("2028-03-05");
    await disabled(packet.getByRole("button", { name: h.md, exact: true }));
    await reviewer.getByRole("button", { name: dl.save, exact: true }).click();
    await packet.getByText(f.saved, { exact: true }).waitFor();
    assert.equal(
      await packet
        .getByRole("button", { name: h.md, exact: true })
        .isDisabled(),
      false,
    );
    assert.equal(
      await reviewer.getByLabel(dl.due, { exact: true }).inputValue(),
      "2028-03-05",
    );
    await reviewer.getByRole("button", { name: dl.clear, exact: true }).click();
    await reviewer.getByRole("button", { name: dl.save, exact: true }).click();
    await packet.getByText(f.saved, { exact: true }).waitFor();
    assert.equal(
      await reviewer.getByLabel(dl.due, { exact: true }).inputValue(),
      "",
    );
    assert.equal(
      await packet
        .getByRole("button", { name: h.md, exact: true })
        .isDisabled(),
      false,
    );
    if (g.language === "en") {
      await reviewer.getByLabel(dl.due, { exact: true }).fill("2028-03-02");
      const current = await c.owner(g.path);
      assert.equal(
        (
          await c.owner(
            g.path + "/feedback",
            "POST",
            feedbackAction(current, {
              op: "deadline",
              reviewerId: c.actor.id,
              dueDate: "2028-03-03",
            }),
          )
        ).status,
        200,
      );
      await reviewer
        .getByRole("button", { name: dl.save, exact: true })
        .click();
      await packet.getByRole("alert").waitFor();
      await packet
        .getByRole("button", { name: h.refresh, exact: true })
        .click();
      await reviewer.getByLabel(dl.due, { exact: true }).waitFor();
      assert.equal(
        await reviewer.getByLabel(dl.due, { exact: true }).inputValue(),
        "2028-03-03",
      );
      assert.equal(
        await packet
          .getByRole("button", { name: h.md, exact: true })
          .isDisabled(),
        false,
      );
    }
    await inbox.getByRole("button", { name: l.close, exact: true }).click();
    await inbox.getByText(l.empty, { exact: true }).waitFor();
    await inbox.getByLabel(l.decision, { exact: true }).selectOption("all");
    await inbox.getByLabel(dl.window, { exact: true }).selectOption("overdue");
    await inbox.getByText(l.empty, { exact: true }).waitFor();
    await inbox.getByLabel(dl.window, { exact: true }).selectOption("");
    await row.getByText(l.exported, { exact: true }).waitFor();
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth + 1,
      ),
      true,
    );
  }
  const l = inboxLabels.fr,
    dl = deadlineLabels.fr,
    inbox = page.getByRole("region", { name: l.title, exact: true }),
    g = await c.create("Synthetic midnight deadline", [c.actor.id]);
  let d = await c.owner(g.path);
  d = await c.owner(
    g.path + "/feedback",
    "POST",
    feedbackAction(d, {
      op: "deadline",
      reviewerId: c.actor.id,
      dueDate: "2028-02-28",
    }),
  );
  await inbox.getByRole("button", { name: l.reset, exact: true }).click();
  await inbox.getByRole("button", { name: l.refresh, exact: true }).click();
  await inbox
    .getByLabel(l.collection, { exact: true })
    .selectOption(g.collection.id);
  await inbox.getByLabel(dl.window, { exact: true }).selectOption("overdue");
  await inbox.getByText(l.empty, { exact: true }).waitFor();
  await page.clock.setFixedTime(new Date("2028-02-29T08:00:00Z"));
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  const row = inbox.locator(`[data-review-packet="${d.packet.id}"]`);
  await row.waitFor();
  await row
    .getByText(dl.due + ": 2028-02-28 · " + dl.overdue, { exact: true })
    .waitFor();
  d = await c.owner(g.path);
  await c.owner(
    g.path + "/feedback",
    "POST",
    feedbackAction(d, {
      op: "deadline",
      reviewerId: c.actor.id,
      dueDate: "2028-03-11",
    }),
  );
  await page.clock.setFixedTime(new Date("2028-03-12T07:59:59Z"));
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await inbox.getByRole("button", { name: l.refresh, exact: true }).click();
  await inbox.getByLabel(dl.window, { exact: true }).selectOption("today");
  await row.waitFor();
  await page.clock.setFixedTime(new Date("2028-03-12T08:00:00Z"));
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await inbox.getByText(l.empty, { exact: true }).waitFor();
  await inbox.getByLabel(dl.window, { exact: true }).selectOption("overdue");
  await row.waitFor();
  const readonly = await c.create("Synthetic reader schedule", [c.person.id]);
  d = await c.owner(
    readonly.path + "/feedback",
    "POST",
    feedbackAction(readonly.d, {
      op: "deadline",
      reviewerId: c.person.id,
      dueDate: "2028-03-01",
    }),
  );
  await c.local.db
    .prepare("UPDATE users SET role='viewer' WHERE id=?")
    .run(c.person.id);
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
  await reader.clock.setFixedTime(new Date("2028-03-12T08:00:00Z"));
  await reader.goto(base);
  await reader
    .getByRole("button", { name: "Research library", exact: true })
    .click();
  await reader
    .getByRole("button", { name: "Review inbox", exact: true })
    .click();
  await reader
    .locator(`[data-review-packet="${d.packet.id}"]`)
    .getByRole("button", { name: inboxLabels.en.open, exact: true })
    .click();
  const feedback = reader.getByRole("region", {
    name: feedbackLabels.en.title,
    exact: true,
  });
  await feedback
    .getByText(
      deadlineLabels.en.due + ": 2028-03-01 · " + deadlineLabels.en.overdue,
      { exact: true },
    )
    .waitFor();
  assert.equal(
    await feedback
      .getByRole("button", { name: deadlineLabels.en.save, exact: true })
      .count(),
    0,
  );
  assert.equal(await feedback.locator('input[type="date"]').count(), 0);
  await c.owner(
    `studies/${c.imports[0].s.id}/responses/${c.imports[0].interviewId}`,
    "DELETE",
  );
  await inbox.getByRole("button", { name: l.refresh, exact: true }).click();
  await inbox.getByText(l.empty, { exact: true }).waitFor();
  assert.equal(
    (await c.local.list("libraryHandoffFeedback", c.actor.workspaceId)).length,
    0,
  );
  assert.deepEqual(errors, []);
  console.log(
    "EN/ES/FR mobile reviewer deadlines: schedule/save/clear, unsaved guards, approval preservation, stale edit recovery, deadline filters and labels, local leap-day/DST midnight refresh, reader-only viewing and source-erasure cleanup passed.",
  );
} finally {
  await browser?.close();
  await stop();
}
