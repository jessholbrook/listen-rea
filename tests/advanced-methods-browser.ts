import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { chromium, type Browser } from "playwright";
import { start, stop, base } from "./harness";
import {
  hierarchicalFixture,
  flexibleFixture,
  scheduledFixture,
} from "./advanced-methods-fixture";

let browser: Browser | undefined;
try {
  await start({ port: 3435 });
  const c = await hierarchicalFixture(),
    pulse = await scheduledFixture(c);
  browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_PATH || "/usr/bin/chromium",
    args: ["--no-sandbox"],
  });
  const context = await browser.newContext({
      viewport: { width: 1440, height: 1000 },
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
  await page.goto(base + `/?study=${c.s.id}&tab=maxdiff`);
  const model = page.getByRole("region", {
    name: "Hierarchical MaxDiff and portfolios",
  });
  await model
    .getByRole("button", {
      name: "Fit hierarchical model and portfolios",
      exact: true,
    })
    .click();
  await model
    .getByText("6 combinations evaluated", { exact: true })
    .waitFor({ timeout: 60000 });
  const download = model.getByRole("button", {
    name: "Export hierarchical individual CSV",
    exact: true,
  });
  assert.equal(await download.isEnabled(), false);
  await model.getByRole("checkbox").check();
  const pending = page.waitForEvent("download");
  await download.click();
  assert.match((await pending).suggestedFilename(), /individual\.csv$/);
  await model
    .getByText("Respondent-level estimates and original sources", {
      exact: true,
    })
    .click();
  await model
    .getByRole("button", { name: /^Inspect source/ })
    .first()
    .click();
  await page.getByRole("dialog").waitFor();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Close dialog", exact: true })
    .click();
  await model.getByLabel("Portfolio size", { exact: true }).selectOption("1");
  assert.equal(await download.count(), 0);

  for (const mode of ["open", "hybrid"] as const) {
    const f = await flexibleFixture(mode, c),
      participant = await browser.newContext({
        viewport: { width: 390, height: 844 },
      }),
      p = await participant.newPage();
    p.on("pageerror", (e) => errors.push(e.message));
    await p.goto(base + "/s/" + f.s.id);
    await p.getByRole("checkbox").check();
    await p.getByRole("button", { name: "Let’s begin", exact: true }).click();
    await p.getByLabel("New group name", { exact: true }).fill("My category");
    await p.getByRole("button", { name: "Add my group", exact: true }).click();
    await p
      .getByLabel("Your group My category", { exact: true })
      .fill("My renamed category");
    await p
      .getByRole("button", { name: "Rename my group My category", exact: true })
      .click();
    await p
      .getByRole("button", {
        name: "Remove my group My renamed category",
        exact: true,
      })
      .waitFor();
    const selects = p.locator(".cardsort-card select");
    const own = await selects
      .first()
      .locator("option")
      .evaluateAll(
        (options) =>
          (options as HTMLOptionElement[]).find(
            (o) => o.text === "My renamed category",
          )!.value,
      );
    await selects.first().selectOption(own);
    await p
      .getByRole("button", { name: "Save sort draft", exact: true })
      .click();
    await p
      .getByText("Draft saved. You can resume these placements later.", {
        exact: true,
      })
      .waitFor();
    await p.reload();
    await p
      .getByRole("button", {
        name: "Remove my group My renamed category",
        exact: true,
      })
      .click();
    await p
      .getByRole("button", {
        name: "Remove my group My renamed category",
        exact: true,
      })
      .waitFor({ state: "detached" });
    assert.equal(await selects.first().inputValue(), "");
    await p
      .getByLabel("New group name", { exact: true })
      .fill("Final category");
    await p.getByRole("button", { name: "Add my group", exact: true }).click();
    await p.getByLabel("Your group Final category", { exact: true }).waitFor();
    const final = await selects
      .first()
      .locator("option")
      .evaluateAll(
        (options) =>
          (options as HTMLOptionElement[]).find(
            (o) => o.text === "Final category",
          )!.value,
      );
    for (let k = 0; k < (await selects.count()); k++)
      await selects.nth(k).selectOption(k === 2 ? "unsure" : final);
    await p.getByRole("button", { name: "Continue", exact: true }).click();
    await p
      .getByText("Your perspective makes a difference.", { exact: true })
      .waitFor();
    assert.ok(
      await p.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth + 1,
      ),
    );
    await participant.close();
    if (mode === "hybrid") {
      await page.goto(base + `/?study=${f.s.id}&tab=guide`);
      await page
        .getByLabel("Card sort method", { exact: true })
        .selectOption("open");
      assert.equal(
        await page.getByLabel("Card sort group 1", { exact: true }).count(),
        0,
      );
      await page
        .getByLabel("Card sort method", { exact: true })
        .selectOption("hybrid");
      await page
        .getByRole("button", { name: "Save changes", exact: true })
        .click();
      await page.getByText("Draft saved", { exact: true }).waitFor();
    }
  }

  await page.goto(base + `/?study=${pulse.s.id}&tab=pulse`);
  const schedule = page.getByRole("region", { name: "Pulse wave schedule" });
  await schedule
    .getByLabel("Next Pulse date", { exact: true })
    .fill("2026-10-21");
  await schedule.getByLabel("Pulse interval days", { exact: true }).fill("28");
  await schedule
    .getByLabel("Pulse scheduled wave count", { exact: true })
    .fill("2");
  assert.equal(
    await schedule
      .getByRole("button", {
        name: "Save reviewed Pulse schedule",
        exact: true,
      })
      .isEnabled(),
    false,
  );
  await schedule.getByRole("checkbox").check();
  await schedule
    .getByRole("button", { name: "Save reviewed Pulse schedule", exact: true })
    .click();
  await schedule
    .getByRole("status")
    .filter({ hasText: "scheduled · 0/2" })
    .waitFor();
  await schedule.getByRole("checkbox").check();
  await schedule
    .getByRole("button", { name: "Run due Pulse schedule now", exact: true })
    .click();
  await schedule
    .getByRole("link", { name: "Review scheduled draft", exact: true })
    .waitFor();
  const saved = (await c.owner(pulse.root)).schedule,
    draft = (await c.owner("studies/" + saved.runs[0].studyId)).study;
  assert.equal(draft.revisionId, null);
  assert.equal(draft.fielding, "draft");
  await schedule.getByRole("checkbox").check();
  await schedule
    .getByRole("button", { name: "Pause Pulse schedule", exact: true })
    .click();
  await schedule
    .getByRole("status")
    .filter({ hasText: "paused · 1/2" })
    .waitFor();
  assert.deepEqual(errors, []);
  mkdirSync("test-results", { recursive: true });
  await page.screenshot({
    path: "test-results/advanced-pulse-browser.png",
    fullPage: true,
  });
  writeFileSync(
    "test-results/advanced-browser-evaluation.json",
    JSON.stringify(
      {
        passed: true,
        checks: [
          "reviewed hierarchical exports and source inspection",
          "model setting invalidation",
          "mobile open/hybrid category CRUD, draft recovery and confirmation",
          "reviewed due Pulse draft creation and pause",
        ],
        pageErrors: errors,
      },
      null,
      2,
    ),
  );
  console.log("Advanced methods browser checks passed.");
} finally {
  await browser?.close();
  await stop();
}
