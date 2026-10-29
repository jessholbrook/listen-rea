import { chromium, type Browser, type Page } from "playwright";
import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { start, stop, base } from "./harness";
import { automationSetup, automationGuide } from "./automation-fixture";
let browser: Browser | undefined, page: Page | undefined;
try {
  await start({ port: 3443 });
  const c = await automationSetup();
  browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_PATH || "/usr/bin/chromium",
    headless: true,
    args: ["--no-sandbox"],
  });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1050 },
  });
  await context.request.post(base + "/api/auth/login", {
    data: { email: c.email, password: "automation-test-password" },
  });
  page = await context.newPage();
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(base);
  await page
    .getByRole("button", { name: "Team & settings", exact: true })
    .click();
  const panel = page.getByRole("region", {
    name: "Reviewed study automation",
    exact: true,
  });
  await panel
    .getByRole("heading", { name: "Reviewed study automation", exact: true })
    .waitFor();
  const key = panel.getByRole("article", {
    name: "Automation permissions for Synthetic automation key",
    exact: true,
  });
  assert.equal(
    await key
      .getByRole("button", { name: "Save automation permissions", exact: true })
      .isDisabled(),
    true,
  );
  await key
    .getByLabel("Allow draft reads and reviewed change requests", {
      exact: true,
    })
    .check();
  for (const operation of ["create", "edit", "publish", "fielding"])
    await key.getByLabel("Request " + operation, { exact: true }).check();
  await key.getByLabel(/I reviewed this key’s draft access/).check();
  await key
    .getByRole("button", { name: "Save automation permissions", exact: true })
    .click();
  await key.getByText(/Automation enabled/).waitFor();
  const p = (
    await c.proposal({
      operation: "create",
      guide: automationGuide("Browser approved creation"),
    })
  ).plan;
  await panel
    .getByRole("button", { name: "Refresh automation", exact: true })
    .click();
  let card = panel.getByRole("article", {
    name: "Automation request create",
    exact: true,
  });
  await card
    .getByRole("button", { name: "Inspect change request", exact: true })
    .click();
  await card.getByText("Requested change", { exact: true }).waitFor();
  assert.equal(
    await card
      .getByRole("button", { name: "Apply reviewed change", exact: true })
      .isDisabled(),
    true,
  );
  await card
    .getByLabel(/I inspected the full current and proposed guide/)
    .check();
  await card
    .getByRole("button", { name: "Apply reviewed change", exact: true })
    .click();
  await card.getByText("applied · applied", { exact: true }).waitFor();
  const result = (await c.external("plans/" + p.id)).plan.result;
  let s = (await c.external("studies/" + result.studyId)).study;
  const publish = (
    await c.proposal({
      operation: "publish",
      studyId: s.id,
      fingerprint: s.fingerprint,
    })
  ).plan;
  await panel
    .getByRole("button", { name: "Refresh automation", exact: true })
    .click();
  card = panel.getByRole("article", {
    name: "Automation request publish",
    exact: true,
  });
  await card
    .getByRole("button", { name: "Inspect change request", exact: true })
    .click();
  await card
    .getByLabel(/I inspected the full current and proposed guide/)
    .check();
  await card
    .getByRole("button", { name: "Apply reviewed change", exact: true })
    .click();
  await card.getByText("applied · applied", { exact: true }).waitFor();
  s = (await c.external("studies/" + result.studyId)).study;
  assert.equal(s.fielding, "paused");
  assert.ok(s.revisionId);
  const launch = (
    await c.proposal({
      operation: "fielding",
      studyId: s.id,
      fingerprint: s.fingerprint,
      state: "active",
    })
  ).plan;
  await panel
    .getByRole("button", { name: "Refresh automation", exact: true })
    .click();
  card = panel.getByRole("article", {
    name: "Automation request fielding",
    exact: true,
  });
  await card
    .getByRole("button", { name: "Inspect change request", exact: true })
    .click();
  await card
    .getByText("Published guide used for fielding", { exact: true })
    .waitFor();
  await card
    .getByText(/Opening fielding allows participants with the study link/)
    .waitFor();
  await card
    .getByLabel(/I inspected the full current and proposed guide/)
    .check();
  // Simulate a concurrent UI edit after the admin has reviewed this request.
  await c.owner("studies/" + s.id, "PUT", {
    version: s.version,
    guide: automationGuide("Changed while reviewing"),
  });
  await card
    .getByRole("button", { name: "Apply reviewed change", exact: true })
    .click();
  await card.getByRole("alert").waitFor();
  assert.equal(
    (await c.external("studies/" + result.studyId)).study.fielding,
    "paused",
  );
  await panel
    .getByRole("button", { name: "Refresh automation", exact: true })
    .click();
  await card.getByText("pending · study changed", { exact: true }).waitFor();
  await card
    .getByRole("button", { name: "Inspect change request", exact: true })
    .click();
  assert.equal(
    await card
      .getByLabel(/I inspected the full current and proposed guide/)
      .isChecked(),
    false,
  );
  await card
    .getByLabel(/I inspected the full current and proposed guide/)
    .check();
  await card
    .getByRole("button", { name: "Reject request", exact: true })
    .click();
  await card.getByText("rejected · rejected", { exact: true }).waitFor();
  assert.equal((await c.external("plans/" + launch.id)).plan.state, "rejected");
  mkdirSync("test-results", { recursive: true });
  await page.screenshot({
    path: "test-results/automation-desktop.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await card
    .getByRole("button", { name: "Inspect change request", exact: true })
    .click();
  await card
    .getByText("Published guide used for fielding", { exact: true })
    .waitFor();
  await card.scrollIntoViewIfNeeded();
  await page.screenshot({
    path: "test-results/automation-mobile.png",
    fullPage: true,
  });
  assert.ok(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  );
  assert.deepEqual(errors, []);
  console.log(
    "Automation browser passed: explicit per-key enablement, inspected and reviewed creation/publication, separate fielding effect, stale post-review rejection, refreshed review reset, human rejection and mobile layout. No paid services or participants.",
  );
} catch (e) {
  mkdirSync("test-results", { recursive: true });
  await page?.screenshot({
    path: "test-results/automation-failure.png",
    fullPage: true,
  });
  console.error((await page?.locator("body").innerText())?.slice(-6500));
  console.error(e);
  process.exitCode = 1;
} finally {
  await browser?.close();
  await stop();
}
