import { chromium, type Browser, type Locator } from "playwright";
import assert from "node:assert/strict";
import { start, stop, base } from "./harness";
import { inboxSetup, packetEdit } from "./team-review-inbox-fixture";
import { batchLabels } from "../src/lib/batch-review-plans";
import { planLabels } from "../src/lib/review-plans";
import { inboxLabels } from "../src/lib/team-review-inbox";
import { workloadLabels } from "../src/lib/review-workload";
async function disabled(locator: Locator) {
  for (let n = 0; n < 50; n++) {
    if (await locator.isDisabled()) return;
    await new Promise((r) => setTimeout(r, 100));
  }
  assert.equal(await locator.isDisabled(), true);
}
let browser: Browser | undefined;
try {
  await start({ port: 3401 });
  const c = await inboxSetup(),
    groups = [];
  for (const language of ["en", "es", "fr"] as const) {
    const pair = [];
    for (const n of [1, 2])
      pair.push(await c.create(`Batch ${language} ${n}`, [], language));
    groups.push({ language, pair });
  }
  const plan = (
    await c.owner("library/review-plans", "POST", {
      name: "Synthetic shared batch plan",
      reviewers: [
        { id: c.person.id, days: 2 },
        { id: c.actor.id, days: null },
      ],
    })
  ).plan;
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
  let requests = 0;
  page.on("request", (r) => {
    if (r.url().endsWith("/review-plan-batch/apply")) requests++;
  });
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
  for (const { language, pair } of groups) {
    const l = batchLabels[language],
      pl = planLabels[language],
      il = inboxLabels[language];
    await page
      .getByLabel(inboxLabels[previous].language, { exact: true })
      .selectOption(language);
    previous = language;
    const inbox = page.getByRole("region", { name: il.title, exact: true });
    await inbox.getByRole("button", { name: l.title, exact: true }).click();
    const panel = inbox.getByRole("region", { name: l.title, exact: true });
    async function select() {
      await panel.getByLabel(pl.choose, { exact: true }).selectOption(plan.id);
      await panel
        .getByLabel(il.query, { exact: true })
        .fill("Batch " + language);
      for (const g of pair)
        await panel
          .getByRole("checkbox", {
            name: l.select + ": " + g.d.packet.title,
            exact: true,
          })
          .check();
    }
    await select();
    await disabled(
      inbox.getByRole("button", { name: il.refresh, exact: true }),
    );
    await disabled(
      inbox.getByRole("button", {
        name: workloadLabels[language].tab,
        exact: true,
      }),
    );
    await panel.getByRole("button", { name: l.preview, exact: true }).click();
    await panel
      .getByText(c.person.name + " · 2028-03-01", { exact: true })
      .waitFor();
    await disabled(panel.getByRole("button", { name: l.apply, exact: true }));
    if (language === "en") {
      await panel.getByRole("button", { name: l.cancel, exact: true }).click();
      await panel.getByLabel(pl.choose, { exact: true }).waitFor();
      assert.deepEqual((await c.owner(pair[0].path)).feedback.reviewers, []);
      await select();
      await panel.getByRole("button", { name: l.preview, exact: true }).click();
      await panel
        .locator(`[data-batch-packet="${pair[0].d.packet.id}"]`)
        .waitFor();
      pair[0].d = await c.owner(
        pair[0].path,
        "PUT",
        packetEdit(pair[0].d, { summary: "Changed since batch preview" }),
      );
    }
    await panel.getByRole("checkbox", { name: l.ack, exact: true }).check();
    await panel.screenshot({
      path: `test-results/batch-review-preview-${language}.png`,
    });
    await panel.getByRole("button", { name: l.apply, exact: true }).click();
    await panel
      .getByRole("heading", { name: l.results + ": " + plan.name, exact: true })
      .waitFor();
    for (const [index, g] of pair.entries()) {
      const outcome = index === 0 && language === "en" ? l.conflict : l.applied;
      await panel
        .locator(`[data-batch-packet="${g.d.packet.id}"]`)
        .getByText(outcome, { exact: true })
        .waitFor();
      const d = await c.owner(g.path);
      if (index === 0 && language === "en")
        assert.deepEqual(d.feedback.reviewers, []);
      else assert.equal(d.feedback.reviewers[0].dueDate, "2028-03-01");
    }
    await panel.screenshot({
      path: `test-results/batch-review-results-${language}.png`,
    });
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth,
      ),
      false,
    );
    assert.equal(
      requests,
      groups.findIndex((g) => g.language === language) + 1,
    );
    await panel.getByRole("button", { name: l.finish, exact: true }).click();
    await panel.getByLabel(pl.choose, { exact: true }).waitFor();
  }
  // Unavailable preview rows remain in the final accounting, preserving selected order.
  {
    const il = inboxLabels.fr,
      l = batchLabels.fr,
      pl = planLabels.fr;
    const inbox = page.getByRole("region", { name: il.title, exact: true }),
      panel = inbox.getByRole("region", { name: l.title, exact: true });
    const gone = await c.create("Mixed preview 1 removed"),
      good = await c.create("Mixed preview 2 current");
    await inbox.getByRole("button", { name: il.refresh, exact: true }).click();
    await panel.getByLabel(pl.choose, { exact: true }).selectOption(plan.id);
    await panel.getByLabel(il.query, { exact: true }).fill("Mixed preview");
    for (const g of [gone, good])
      await panel
        .getByRole("checkbox", {
          name: l.select + ": " + g.d.packet.title,
          exact: true,
        })
        .check();
    await c.owner(gone.path, "DELETE", {
      id: gone.d.packet.id,
      version: gone.d.packet.version,
    });
    await panel.getByRole("button", { name: l.preview, exact: true }).click();
    await panel
      .locator(`[data-batch-packet="${gone.d.packet.id}"]`)
      .getByRole("status")
      .getByText(l.unavailable, { exact: true })
      .waitFor();
    await panel.getByRole("checkbox", { name: l.ack, exact: true }).check();
    await panel.getByRole("button", { name: l.apply, exact: true }).click();
    await panel
      .getByRole("heading", { name: l.results + ": " + plan.name, exact: true })
      .waitFor();
    assert.equal(await panel.locator("[data-batch-packet]").count(), 2);
    assert.equal(
      await panel
        .locator("[data-batch-packet]")
        .first()
        .getAttribute("data-batch-packet"),
      gone.d.packet.id,
    );
    await panel
      .locator(`[data-batch-packet="${gone.d.packet.id}"]`)
      .getByRole("status")
      .getByText(l.unavailable, { exact: true })
      .waitFor();
    await panel
      .locator(`[data-batch-packet="${good.d.packet.id}"]`)
      .getByRole("status")
      .getByText(l.applied, { exact: true })
      .waitFor();
    await panel.getByRole("button", { name: l.finish, exact: true }).click();
    await panel.getByLabel(pl.choose, { exact: true }).waitFor();
  }
  // A failed request or changed template requires refresh; neither retries automatically.
  {
    const il = inboxLabels.fr,
      l = batchLabels.fr,
      pl = planLabels.fr;
    const inbox = page.getByRole("region", { name: il.title, exact: true }),
      panel = inbox.getByRole("region", { name: l.title, exact: true });
    const g = await c.create("Interrupted batch request");
    await inbox.getByRole("button", { name: il.refresh, exact: true }).click();
    await panel.getByLabel(pl.choose, { exact: true }).selectOption(plan.id);
    await panel.getByLabel(il.query, { exact: true }).fill("Interrupted batch");
    await panel
      .getByRole("checkbox", {
        name: l.select + ": " + g.d.packet.title,
        exact: true,
      })
      .check();
    await panel.getByRole("button", { name: l.preview, exact: true }).click();
    await panel.getByRole("checkbox", { name: l.ack, exact: true }).check();
    await page.route("**/api/library/review-plan-batch/apply", (route) =>
      route.abort("failed"),
    );
    await panel.getByRole("button", { name: l.apply, exact: true }).click();
    await panel.getByRole("alert").waitFor();
    const sent = requests;
    await panel.getByRole("button", { name: l.finish, exact: true }).click();
    await page.unroute("**/api/library/review-plan-batch/apply");
    await panel.getByLabel(pl.choose, { exact: true }).selectOption(plan.id);
    assert.equal(requests, sent);
    assert.deepEqual((await c.owner(g.path)).feedback.reviewers, []);
    await panel.getByLabel(il.query, { exact: true }).fill("Interrupted batch");
    await panel
      .getByRole("checkbox", {
        name: l.select + ": " + g.d.packet.title,
        exact: true,
      })
      .check();
    await c.owner("library/review-plans/" + plan.id, "PUT", {
      name: "Updated batch plan",
      reviewers: plan.reviewers,
      version: plan.version,
    });
    await panel.getByRole("button", { name: l.preview, exact: true }).click();
    await panel
      .getByRole("alert")
      .getByText("Review plan changed. Refresh and preview it again.", {
        exact: true,
      })
      .waitFor();
    await panel.getByRole("button", { name: l.finish, exact: true }).click();
    await panel.getByLabel(pl.choose, { exact: true }).waitFor();
  }
  // Selection stays explicit across filters/pages, with a strict ten-packet limit.
  const extras = [];
  for (let n = 0; n < 21; n++)
    extras.push(
      await c.create("Pagination batch " + String(n).padStart(2, "0")),
    );
  const il = inboxLabels.fr,
    l = batchLabels.fr,
    pl = planLabels.fr,
    inbox = page.getByRole("region", { name: il.title, exact: true }),
    panel = inbox.getByRole("region", { name: l.title, exact: true });
  await inbox.getByRole("button", { name: il.refresh, exact: true }).click();
  await panel.getByLabel(il.query, { exact: true }).fill("Pagination batch");
  const boxes = panel.getByRole("checkbox");
  for (let n = 0; n < 10; n++) await boxes.nth(n).check();
  await disabled(boxes.nth(10));
  await panel.getByRole("button", { name: il.next, exact: true }).click();
  await disabled(
    panel.getByRole("checkbox", {
      name: l.select + ": " + extras[20].d.packet.title,
      exact: true,
    }),
  );
  await panel.getByRole("button", { name: l.clear, exact: true }).click();
  await panel
    .getByRole("checkbox", {
      name: l.select + ": " + extras[20].d.packet.title,
      exact: true,
    })
    .check();
  await panel.getByLabel(il.query, { exact: true }).fill("No matching packet");
  await panel.getByText(l.empty, { exact: true }).waitFor();
  await panel.getByText(l.selected + ": 1/10", { exact: true }).waitFor();
  await panel.getByLabel(pl.choose, { exact: true }).selectOption(plan.id);
  await c.owner(
    `studies/${c.imports[0].s.id}/responses/${c.imports[0].interviewId}`,
    "DELETE",
  );
  await panel.getByRole("button", { name: l.preview, exact: true }).click();
  await panel
    .locator("[data-batch-packet]")
    .getByRole("status")
    .getByText(l.unavailable, { exact: true })
    .waitFor();
  await disabled(panel.getByRole("button", { name: l.apply, exact: true }));
  assert.equal(
    await panel.getByText(extras[20].d.packet.title, { exact: true }).count(),
    0,
  );
  await panel.getByRole("button", { name: l.cancel, exact: true }).click();
  await panel.getByText(l.empty, { exact: true }).waitFor();
  // Readers have no batch controls; stale template errors require a fresh inbox.
  await c.local.db
    .prepare("UPDATE users SET role='viewer' WHERE id=?")
    .run(c.actor.id);
  await inbox.getByRole("button", { name: il.refresh, exact: true }).click();
  await page.getByRole("heading", { name: il.title, exact: true }).waitFor();
  assert.equal(
    await inbox.getByRole("button", { name: l.title, exact: true }).count(),
    0,
  );
  assert.deepEqual(errors, []);
  console.log(
    "EN/ES/FR mobile batch planning: selection, calendar previews, cancel, acknowledgement, partial conflicts/results with retained unavailable rows, interruption/stale-plan recovery without automatic retry, refresh, pagination, ten-packet cap, explicit hidden selections, source erasure and reader access passed.",
  );
} finally {
  await browser?.close();
  await stop();
}
