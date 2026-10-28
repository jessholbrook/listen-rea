import { chromium, type Browser } from "playwright";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { start, stop, base } from "./harness";
import {
  inboxSetup,
  feedbackAction,
  finalReview,
} from "./team-review-inbox-fixture";
import { activityLabels } from "../src/lib/review-activity";
import { inboxLabels } from "../src/lib/team-review-inbox";
import { handoffLabels } from "../src/lib/collection-handoff";
let browser: Browser | undefined;
try {
  await start({ port: 3403 });
  const c = await inboxSetup(),
    groups = [];
  for (const language of ["en", "es", "fr"] as const) {
    const g = await c.create("Activity " + language, [c.person.id], language);
    let d = await c.owner(
      g.path + "/feedback",
      "POST",
      feedbackAction(g.d, {
        op: "deadline",
        reviewerId: c.person.id,
        dueDate: "2028-03-01",
      }),
    );
    d = await c.person.call(
      g.path + "/feedback",
      "POST",
      feedbackAction(d, { op: "decision", approved: true }),
    );
    d = await c.owner(g.path + "/review", "POST", finalReview(d));
    g.d = d;
    const stored = await c.local.get<any>(
      "libraryReviewActivity",
      d.packet.id,
      c.actor.workspaceId,
    );
    stored.events = stored.events.map((e: any) =>
      e.action === "deadline" ? { ...e, at: "2028-03-01T00:30:00.000Z" } : e,
    );
    await c.local.put("libraryReviewActivity", stored);
    groups.push({ ...g, language });
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
  await page.goto(base);
  await page
    .getByRole("button", { name: "Research library", exact: true })
    .click();
  await page.getByRole("button", { name: "Review inbox", exact: true }).click();
  let previous: "en" | "es" | "fr" = "en";
  for (const g of groups) {
    const l = activityLabels[g.language],
      il = inboxLabels[g.language];
    await page
      .getByLabel(inboxLabels[previous].language, { exact: true })
      .selectOption(g.language);
    previous = g.language;
    const inbox = page.getByRole("region", { name: il.title, exact: true });
    await inbox.getByRole("button", { name: l.title, exact: true }).click();
    const panel = inbox.getByRole("region", { name: l.title, exact: true });
    await panel
      .getByLabel(l.packet, { exact: true })
      .selectOption(g.d.packet.id);
    await panel.getByLabel(l.person, { exact: true }).selectOption(c.person.id);
    await panel.getByLabel(l.action, { exact: true }).selectOption("deadline");
    await panel.getByLabel(l.from, { exact: true }).fill("2028-02-29");
    await panel.getByLabel(l.to, { exact: true }).fill("2028-02-29");
    await panel.getByText(l.matches + ": 1", { exact: true }).waitFor();
    const event = panel.locator("[data-review-event]");
    await event
      .getByRole("heading", { name: l.deadline, exact: true })
      .waitFor();
    assert.equal(
      await event.locator("time").getAttribute("dateTime"),
      "2028-03-01T00:30:00.000Z",
    );
    await event
      .getByText(c.person.name + " · 2028-03-01", { exact: true })
      .waitFor();
    await event.screenshot({
      path: `test-results/review-activity-${g.language}.png`,
    });
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth,
      ),
      false,
    );
    await event.getByRole("button", { name: il.open, exact: true }).click();
    await inbox
      .getByRole("region", {
        name: handoffLabels[g.language].title,
        exact: true,
      })
      .waitFor();
    await inbox.getByRole("button", { name: il.close, exact: true }).click();
    await panel.getByText(l.matches + ": 1", { exact: true }).waitFor();
    assert.equal(
      await panel.getByLabel(l.packet, { exact: true }).inputValue(),
      g.d.packet.id,
    );
    assert.equal(
      await panel.getByLabel(l.from, { exact: true }).inputValue(),
      "2028-02-29",
    );
  }
  const l = activityLabels.fr,
    il = inboxLabels.fr,
    inbox = page.getByRole("region", { name: il.title, exact: true }),
    panel = inbox.getByRole("region", { name: l.title, exact: true }),
    g = groups[2],
    stored = await c.local.get<any>(
      "libraryReviewActivity",
      g.d.packet.id,
      c.actor.workspaceId,
    ),
    seed = stored.events.find((e: any) => e.action === "deadline");
  await c.local.put("libraryReviewActivity", {
    ...stored,
    events: Array.from({ length: 25 }, (_, n) => ({
      ...seed,
      id: randomUUID(),
      sequence: n + 1,
      at: "2028-03-01T00:30:00.000Z",
    })),
    omitted: 3,
  });
  await panel.getByRole("button", { name: l.refresh, exact: true }).click();
  await panel.getByText(l.matches + ": 25", { exact: true }).waitFor();
  assert.equal(await panel.locator("[data-review-event]").count(), 20);
  await panel.getByRole("button", { name: il.next, exact: true }).click();
  await panel.getByText(il.page + " 2/2", { exact: true }).waitFor();
  assert.equal(await panel.locator("[data-review-event]").count(), 5);
  await panel.getByText(l.omitted + ": 3", { exact: true }).waitFor();
  await c.local.db
    .prepare("UPDATE users SET name='Renamed history reviewer' WHERE id=?")
    .run(c.person.id);
  await panel.getByRole("button", { name: l.refresh, exact: true }).click();
  await panel
    .locator("[data-review-event]")
    .first()
    .getByText("Renamed history reviewer · 2028-03-01", { exact: true })
    .waitFor();
  assert.equal(
    await panel.getByText(c.person.name, { exact: true }).count(),
    0,
  );
  await panel.getByLabel(l.from, { exact: true }).fill("2028-03-02");
  await panel.getByRole("alert").waitFor();
  await panel.getByRole("button", { name: il.reset, exact: true }).click();
  await panel.getByLabel(l.packet, { exact: true }).selectOption(g.d.packet.id);
  await panel.getByLabel(l.person, { exact: true }).selectOption(c.person.id);
  // Readers can inspect history and open the original read-only packet.
  await c.local.db
    .prepare("UPDATE users SET role='viewer' WHERE id=?")
    .run(c.person.id);
  const reader = await browser.newContext({
      viewport: { width: 390, height: 844 },
      timezoneId: "America/Los_Angeles",
    }),
    rp = await reader.newPage();
  rp.on("pageerror", (e) => errors.push(e.message));
  assert.ok(
    (
      await reader.request.post(base + "/api/auth/login", {
        data: { email: c.person.email, password: c.person.password },
      })
    ).ok(),
  );
  await rp.goto(base);
  await rp
    .getByRole("button", { name: "Research library", exact: true })
    .click();
  await rp.getByRole("button", { name: "Review inbox", exact: true }).click();
  await rp
    .getByRole("button", { name: activityLabels.en.title, exact: true })
    .click();
  await rp
    .getByRole("region", { name: activityLabels.en.title, exact: true })
    .locator("[data-review-event]")
    .first()
    .waitFor();
  assert.equal(
    await rp
      .getByRole("button", { name: "Apply to ready packets", exact: true })
      .count(),
    0,
  );
  await reader.close();
  await c.owner(
    `studies/${c.imports[0].s.id}/responses/${c.imports[0].interviewId}`,
    "DELETE",
  );
  await panel.getByRole("button", { name: l.refresh, exact: true }).click();
  await panel.getByText(l.empty, { exact: true }).waitFor();
  assert.equal(
    await panel.getByLabel(l.packet, { exact: true }).inputValue(),
    g.d.packet.id,
  );
  assert.equal(
    await panel.getByLabel(l.person, { exact: true }).inputValue(),
    c.person.id,
  );
  assert.equal(
    await panel.getByText(g.d.packet.title, { exact: true }).count(),
    0,
  );
  assert.deepEqual(errors, []);
  console.log(
    "EN/ES/FR mobile review activity: packet/person/action/local-date intersections, Pacific leap-day boundary, before/after details, packet navigation with retained filters, pagination/retention notice, current names, invalid-date recovery, reader access and source-erasure scopes passed.",
  );
} finally {
  await browser?.close();
  await stop();
}
