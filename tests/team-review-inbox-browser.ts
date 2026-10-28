import { chromium, type Browser } from "playwright";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { start, stop, base } from "./harness";
import { inboxSetup, feedbackAction } from "./team-review-inbox-fixture";
import { inboxLabels } from "../src/lib/team-review-inbox";
import { handoffLabels } from "../src/lib/collection-handoff";
import { feedbackLabels } from "../src/lib/handoff-feedback";
import { dashboardLabels } from "../src/lib/collection-review";
let browser: Browser | undefined;
try {
  await start({ port: 3390 });
  const c = await inboxSetup(),
    groups = [];
  for (const language of ["en", "es", "fr"] as const) {
    const g = await c.create(
      "Synthetic inbox " + language,
      [c.actor.id, ...(language === "en" ? [c.person.id] : [])],
      language,
    );
    if (language === "en")
      g.d = await c.owner(
        g.path + "/feedback",
        "POST",
        feedbackAction(g.d, {
          op: "comment",
          requestId: randomUUID(),
          body: "PRIVATE_INBOX_BROWSER_COMMENT",
        }),
      );
    groups.push({ ...g, language });
  }
  browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_PATH || "/usr/bin/chromium",
    args: ["--no-sandbox"],
  });
  const contexts = [
    await browser.newContext({ viewport: { width: 390, height: 844 } }),
    await browser.newContext({ viewport: { width: 390, height: 844 } }),
  ];
  const pages = [],
    errors: string[] = [];
  for (const [index, context] of contexts.entries()) {
    assert.ok(
      (
        await context.request.post(base + "/api/auth/login", {
          data: {
            email: index === 0 ? c.email : c.person.email,
            password:
              index === 0 ? "saved-library-password" : c.person.password,
          },
        })
      ).ok(),
    );
    const page = await context.newPage();
    pages.push(page);
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto(base);
    await page
      .getByRole("button", { name: "Research library", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Review inbox", exact: true })
      .click();
  }
  const [owner, person] = pages;
  let previous = "en" as "en" | "es" | "fr";
  for (const g of groups) {
    const l = inboxLabels[g.language],
      h = handoffLabels[g.language],
      f = feedbackLabels[g.language];
    await owner
      .getByLabel(inboxLabels[previous].language, { exact: true })
      .selectOption(g.language);
    previous = g.language;
    const inbox = owner.getByRole("region", { name: l.title, exact: true }),
      row = inbox.locator(`[data-review-packet="${g.d.packet.id}"]`);
    await inbox
      .getByLabel(l.collection, { exact: true })
      .selectOption(g.collection.id);
    await row.getByRole("button", { name: l.open, exact: true }).click();
    const packet = inbox.getByRole("region", { name: h.title, exact: true }),
      feedback = packet.getByRole("region", { name: f.title, exact: true });
    await feedback
      .getByRole("button", { name: f.approve, exact: true })
      .waitFor();
    if (g.language === "en") {
      assert.equal(
        await feedback
          .getByRole("button", { name: f.approve, exact: true })
          .isDisabled(),
        true,
      );
      await feedback
        .getByRole("button", { name: f.resolve, exact: true })
        .click();
      await feedback
        .getByRole("button", { name: f.reopen, exact: true })
        .waitFor();
    }
    await feedback
      .getByRole("button", { name: f.approve, exact: true })
      .click();
    await feedback
      .getByRole("button", { name: f.withdraw, exact: true })
      .waitFor();
    if (g.language === "en") {
      const other = person.getByRole("region", {
        name: inboxLabels.en.title,
        exact: true,
      });
      await other
        .locator(`[data-review-packet="${g.d.packet.id}"]`)
        .getByRole("button", { name: inboxLabels.en.open, exact: true })
        .click();
      const review = other.getByRole("region", {
        name: feedbackLabels.en.title,
        exact: true,
      });
      await review
        .getByRole("button", { name: feedbackLabels.en.approve, exact: true })
        .click();
      await review
        .getByRole("button", { name: feedbackLabels.en.withdraw, exact: true })
        .waitFor();
      await other
        .getByRole("button", { name: inboxLabels.en.close, exact: true })
        .click();
      await other.getByText(inboxLabels.en.empty, { exact: true }).waitFor();
    }
    await inbox.getByRole("button", { name: l.close, exact: true }).click();
    await inbox.getByText(l.empty, { exact: true }).waitFor();
    await inbox
      .getByLabel(l.decision, { exact: true })
      .selectOption("approved");
    await row.getByText(l.ready, { exact: true }).waitFor();
    await row.getByRole("button", { name: l.open, exact: true }).click();
    await packet.getByRole("checkbox", { name: h.attest, exact: true }).check();
    await packet.getByRole("button", { name: h.approve, exact: true }).click();
    await packet.getByText(h.reviewed, { exact: true }).waitFor();
    await inbox.getByRole("button", { name: l.close, exact: true }).click();
    await row.getByText(l.exported, { exact: true }).waitFor();
    await inbox.getByLabel(l.state, { exact: true }).selectOption("exported");
    assert.equal(await inbox.locator("[data-review-packet]").count(), 1);
    await row.screenshot({
      path: `test-results/review-inbox-${g.language}.png`,
    });
    assert.equal(
      await owner.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth + 1,
      ),
      true,
    );
    await inbox.getByLabel(l.query, { exact: true }).fill("not a match");
    await inbox.getByText(l.empty, { exact: true }).waitFor();
    await inbox.getByRole("button", { name: l.reset, exact: true }).click();
    assert.equal(
      await inbox.getByLabel(l.reviewer, { exact: true }).inputValue(),
      "mine",
    );
    assert.equal(
      await inbox.getByLabel(l.decision, { exact: true }).inputValue(),
      "pending",
    );
  }
  const l = inboxLabels.fr,
    inbox = owner.getByRole("region", { name: l.title, exact: true }),
    g = groups[0];
  await inbox.getByLabel(l.decision, { exact: true }).selectOption("all");
  await inbox.getByLabel(l.reviewer, { exact: true }).selectOption(c.person.id);
  await inbox
    .getByLabel(l.collection, { exact: true })
    .selectOption(g.collection.id);
  await c.local.db
    .prepare("UPDATE users SET workspace_id=? WHERE id=?")
    .run(randomUUID(), c.person.id);
  await inbox.getByRole("button", { name: l.refresh, exact: true }).click();
  await inbox
    .getByText(l.unavailableReviewer + " · " + l.pending, { exact: true })
    .waitFor();
  await c.owner("library/collections/" + g.collection.id, "DELETE", {
    version: g.collection.version,
  });
  await inbox.getByRole("button", { name: l.refresh, exact: true }).click();
  await inbox.getByText(l.empty, { exact: true }).waitFor();
  assert.equal(
    await inbox.getByLabel(l.collection, { exact: true }).inputValue(),
    g.collection.id,
  );
  assert.equal(
    await inbox.getByLabel(l.reviewer, { exact: true }).inputValue(),
    c.person.id,
  );
  assert.equal(
    await inbox
      .getByLabel(l.collection, { exact: true })
      .locator("option:checked")
      .innerText(),
    l.unavailableCollection,
  );
  assert.equal(
    await inbox
      .getByLabel(l.reviewer, { exact: true })
      .locator("option:checked")
      .innerText(),
    l.unavailableReviewer,
  );
  const replacement = await c.create("Synthetic generation", [c.actor.id]);
  await inbox.getByRole("button", { name: l.reset, exact: true }).click();
  await inbox.getByRole("button", { name: l.refresh, exact: true }).click();
  await inbox
    .locator(`[data-review-packet="${replacement.d.packet.id}"]`)
    .waitFor();
  await c.owner(replacement.path, "DELETE", {
    id: replacement.d.packet.id,
    version: replacement.d.packet.version,
  });
  const recreated = await c.owner(replacement.path, "POST", {
    requestId: randomUUID(),
    title: "Synthetic replacement packet",
    summary: "Synthetic replacement",
    language: "en",
    answerIds: [],
    taskIds: [],
  });
  assert.equal(recreated.status, 201);
  await inbox
    .locator(`[data-review-packet="${replacement.d.packet.id}"]`)
    .getByRole("button", { name: l.open, exact: true })
    .click();
  await inbox.getByRole("alert").waitFor();
  assert.equal(
    await inbox
      .getByRole("form", { name: handoffLabels.fr.title, exact: true })
      .count(),
    0,
  );
  await inbox.getByRole("button", { name: l.close, exact: true }).click();
  await inbox.getByLabel(l.reviewer, { exact: true }).selectOption("");
  await inbox.getByLabel(l.decision, { exact: true }).selectOption("all");
  await inbox
    .locator(`[data-review-packet="${recreated.packet.id}"]`)
    .getByRole("button", { name: l.dashboard, exact: true })
    .click();
  const dash = inbox.getByRole("region", {
    name: dashboardLabels.fr.title,
    exact: true,
  });
  await dash
    .getByRole("button", { name: dashboardLabels.fr.close, exact: true })
    .click();
  for (let i = 0; i < 21; i++)
    await c.create("Synthetic paging " + String(i).padStart(2, "0"), [
      c.actor.id,
    ]);
  await inbox.getByRole("button", { name: l.refresh, exact: true }).click();
  await inbox.getByLabel(l.query, { exact: true }).fill("Synthetic paging");
  await inbox.getByText(l.matching + ": 21", { exact: true }).waitFor();
  assert.equal(await inbox.locator("[data-review-packet]").count(), 20);
  await inbox.getByRole("button", { name: l.next, exact: true }).click();
  assert.equal(await inbox.locator("[data-review-packet]").count(), 1);
  await inbox.getByRole("button", { name: l.previous, exact: true }).click();
  assert.equal(await inbox.locator("[data-review-packet]").count(), 20);
  await c.owner(
    `studies/${c.imports[0].s.id}/responses/${c.imports[0].interviewId}`,
    "DELETE",
  );
  await inbox.getByRole("button", { name: l.refresh, exact: true }).click();
  await inbox.getByText(l.empty, { exact: true }).waitFor();
  assert.equal(
    await inbox.getByLabel(l.query, { exact: true }).inputValue(),
    "Synthetic paging",
  );
  assert.deepEqual(errors, []);
  console.log(
    "EN/ES/FR mobile review inbox: two-user decisions, comment resolution, final approval, current state filters, reset, packet/dashboard navigation, unavailable scope retention, stale generation rejection, 20-row pagination and source-erasure refresh passed.",
  );
} finally {
  await browser?.close();
  await stop();
}
