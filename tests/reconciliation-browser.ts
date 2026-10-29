import { chromium, type Browser } from "playwright";
import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { start, stop, base } from "./harness";
import { reconciliationSetup } from "./reconciliation-fixture";
let browser: Browser | undefined;
try {
  await start({ port: 3453 });
  const c = await reconciliationSetup();
  browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_PATH || "/usr/bin/chromium",
    headless: true,
    args: ["--no-sandbox"],
  });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1050 },
  });
  await context.request.post(base + "/api/auth/login", {
    data: { email: c.email, password: "saved-library-password" },
  });
  const page = await context.newPage(),
    errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(base);
  await page
    .getByRole("button", { name: "Team & settings", exact: true })
    .click();
  const panel = page.getByRole("region", {
    name: "Integration recovery",
    exact: true,
  });
  await panel.getByText("Recovery disabled", { exact: false }).waitFor();
  const save = panel.getByRole("button", {
      name: "Save recovery policy",
      exact: true,
    }),
    review = panel.getByLabel(/I reviewed the selected studies/);
  assert.equal(await save.isDisabled(), true);
  await panel.getByLabel(/Enable inventory/).check();
  await review.check();
  await panel.getByLabel(/New inventories per rolling/).fill("8");
  assert.equal(await review.isChecked(), false);
  await review.check();
  await save.click();
  await panel.getByText(/Recovery enabled/).waitFor();
  assert.equal(await review.isChecked(), false);
  const input = c.input({ resources: ["study"] }),
    started = await c.external("runs", "POST", input);
  assert.equal(started.status, 201);
  await panel
    .getByRole("button", { name: "Refresh recovery", exact: true })
    .click();
  await panel.getByText(started.run.id, { exact: true }).waitFor();
  const card = panel.locator("article").filter({ hasText: started.run.id });
  await card.getByText(/active at last checkpoint/).waitFor();
  const view = await c.external("runs/" + started.run.id);
  await c.ack(started.run.id, view);
  await panel
    .getByRole("button", { name: "Refresh recovery", exact: true })
    .click();
  await card.getByText(/complete at last checkpoint/).waitFor();
  await page.setViewportSize({ width: 390, height: 844 });
  await panel.scrollIntoViewIfNeeded();
  assert.equal(
    await panel.evaluate((e) => e.scrollWidth <= e.clientWidth + 1),
    true,
  );
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth + 1,
    ),
    true,
  );
  mkdirSync("test-results", { recursive: true });
  await panel.screenshot({ path: "test-results/reconciliation-mobile.png" });
  await card
    .getByRole("button", { name: "Discard progress", exact: true })
    .click();
  await card
    .getByRole("button", { name: "Confirm discard", exact: true })
    .click();
  await panel
    .getByText(started.run.id, { exact: true })
    .waitFor({ state: "detached" });
  await panel
    .getByRole("button", { name: "Disable recovery now", exact: true })
    .click();
  await panel.getByText(/Recovery disabled/).waitFor();
  assert.equal((await c.external("runs", "POST", c.input())).status, 403);
  assert.deepEqual(errors, []);
  console.log(
    "PASS: recovery opt-in, acknowledgment reset, client progress refresh, discard, immediate disable and mobile layout",
  );
} finally {
  await browser?.close();
  await stop();
}
