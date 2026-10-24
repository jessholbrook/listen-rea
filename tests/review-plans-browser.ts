import { chromium, type Browser } from "playwright";
import assert from "node:assert/strict";
import { start, stop, base } from "./harness";
import { inboxSetup } from "./team-review-inbox-fixture";
import { planLabels } from "../src/lib/review-plans";
import { inboxLabels } from "../src/lib/team-review-inbox";
import { feedbackLabels } from "../src/lib/handoff-feedback";
import { handoffLabels } from "../src/lib/collection-handoff";
let browser: Browser | undefined;
try {
  await start({ port: 3399 });
  const c = await inboxSetup(),
    groups = [];
  for (const language of ["en", "es", "fr"] as const)
    groups.push(await c.create("Reusable plans " + language, [], language));
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
  let previous: "en" | "es" | "fr" = "en";
  for (const g of groups) {
    const language = g.language as "en" | "es" | "fr",
      l = planLabels[language],
      il = inboxLabels[language],
      f = feedbackLabels[language],
      h = handoffLabels[language];
    await page
      .getByLabel(inboxLabels[previous].language, { exact: true })
      .selectOption(language);
    previous = language;
    // Summary-only packets appear in the team filter, including unassigned ones.
    const inbox = page.getByRole("region", { name: il.title, exact: true });
    await inbox.getByLabel(il.reviewer, { exact: true }).selectOption("");
    await inbox.getByLabel(il.decision, { exact: true }).selectOption("all");
    await inbox
      .getByLabel(il.collection, { exact: true })
      .selectOption(g.collection.id);
    await inbox
      .locator(`[data-review-packet="${g.d.packet.id}"]`)
      .getByRole("button", { name: il.open, exact: true })
      .click();
    const packet = inbox.getByRole("region", { name: h.title, exact: true }),
      feedback = packet.getByRole("region", { name: f.title, exact: true }),
      panel = feedback.getByRole("region", { name: l.title, exact: true });
    await panel.getByRole("button", { name: l.new, exact: true }).click();
    await panel.getByLabel(l.name, { exact: true }).fill("Launch " + language);
    await panel
      .getByRole("checkbox", { name: c.person.name, exact: true })
      .check();
    await panel
      .getByLabel(l.days + ": " + c.person.name, { exact: true })
      .fill("2");
    assert.equal(
      await feedback
        .getByRole("button", { name: f.assign, exact: true })
        .isDisabled(),
      true,
    );
    await panel.getByRole("button", { name: l.save, exact: true }).click();
    await panel
      .getByRole("button", {
        name: l.edit + ": Launch " + language,
        exact: true,
      })
      .waitFor();
    const p = (await c.owner("library/review-plans")).plans.find(
      (v: any) => v.name === "Launch " + language,
    );
    await panel.getByLabel(l.choose, { exact: true }).selectOption(p.id);
    assert.equal(
      await panel.getByLabel(l.start, { exact: true }).inputValue(),
      "2028-02-28",
    );
    await panel.getByRole("button", { name: l.preview, exact: true }).click();
    await panel
      .locator("[data-review-plan-preview]")
      .getByText(c.person.name + " · 2028-03-01", { exact: true })
      .waitFor();
    assert.equal(
      await panel
        .getByRole("button", { name: l.apply, exact: true })
        .isDisabled(),
      true,
    );
    assert.deepEqual((await c.owner(g.path)).feedback.reviewers, []);
    await panel.getByRole("button", { name: l.cancel, exact: true }).click();
    await panel.getByRole("button", { name: l.preview, exact: true }).click();
    await panel.getByRole("checkbox", { name: l.ack, exact: true }).check();
    await panel.screenshot({
      path: `test-results/review-plan-preview-${language}.png`,
    });
    await panel.getByRole("button", { name: l.apply, exact: true }).click();
    await feedback
      .locator(`[data-handoff-reviewer="${c.person.id}"]`)
      .getByText("2028-03-01", { exact: true })
      .waitFor();
    const applied = await c.owner(g.path);
    assert.equal(applied.feedback.reviewers[0].dueDate, "2028-03-01");
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth,
      ),
      false,
    );
    await inbox.getByRole("button", { name: il.close, exact: true }).click();
  }
  assert.deepEqual(errors, []);
  console.log(
    "Reusable review plans: EN/ES/FR mobile create, preview, cancel, acknowledgment, application and date checks passed.",
  );
} finally {
  await browser?.close();
  await stop();
}
