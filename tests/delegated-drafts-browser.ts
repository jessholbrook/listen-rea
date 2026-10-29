import { chromium, type Browser, type Page } from "playwright";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { start, stop, base } from "./harness";
import { automationSetup, automationGuide } from "./automation-fixture";
let browser: Browser | undefined, page: Page | undefined;
try {
  await start({ port: 3449 });
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
    }),
    key = panel.getByRole("article", {
      name: "Automation permissions for Synthetic automation key",
      exact: true,
    });
  await key
    .getByLabel("Allow draft reads and reviewed change requests", {
      exact: true,
    })
    .check();
  for (const op of ["create", "edit"])
    await key.getByLabel("Request " + op, { exact: true }).check();
  await key
    .getByLabel("Allow automatic draft execution", { exact: true })
    .check();
  for (const op of ["create", "edit"])
    await key
      .getByLabel("Automatically " + op + " drafts", { exact: true })
      .check();
  const limit = key.getByLabel(
      "Automatic draft changes per preceding 24 hours",
      { exact: true },
    ),
    ack = key.getByLabel(/I authorize this trusted key/),
    review = key.getByLabel(/I reviewed this key’s draft access/),
    save = key.getByRole("button", {
      name: "Save automation permissions",
      exact: true,
    });
  await limit.fill("2");
  await review.check();
  assert.equal(await save.isDisabled(), true);
  await ack.check();
  assert.equal(await save.isEnabled(), true);
  await limit.fill("3");
  assert.equal(await ack.isChecked(), false);
  assert.equal(await review.isChecked(), false);
  await ack.check();
  await review.check();
  await save.click();
  await key
    .getByRole("button", {
      name: "Disable automatic draft changes",
      exact: true,
    })
    .waitFor();
  const input = {
      requestId: randomUUID(),
      reason: "Browser trusted draft execution",
      change: {
        operation: "create",
        guide: automationGuide("Browser automatic draft"),
      },
    },
    created = await c.external("execute", "POST", input);
  assert.equal(created.status, 201, JSON.stringify(created));
  await panel
    .getByRole("button", { name: "Refresh automation", exact: true })
    .click();
  const activity = panel.getByRole("article", {
    name: "Automatic draft create",
    exact: true,
  });
  await activity.getByText(/Executed automatically/).waitFor();
  await activity
    .getByRole("button", {
      name: "Inspect automatic draft change",
      exact: true,
    })
    .click();
  await activity.getByText("Executed draft", { exact: true }).waitFor();
  await activity.getByText(/Authorized by Automation reviewer/).waitFor();
  assert.equal((await c.owner("automation")).plans.length, 0);
  assert.equal((await c.external("execute", "POST", input)).status, 200);
  const id = created.execution.studyId,
    current = (await c.external("studies/" + id)).study;
  assert.equal(
    (
      await c.external("execute", "POST", {
        requestId: randomUUID(),
        reason: "Browser automatic edit",
        change: {
          operation: "edit",
          studyId: id,
          fingerprint: current.fingerprint,
          guide: automationGuide("Browser edited draft"),
        },
      })
    ).status,
    201,
  );
  await panel
    .getByRole("button", { name: "Refresh automation", exact: true })
    .click();
  await panel
    .getByRole("article", { name: "Automatic draft edit", exact: true })
    .waitFor();
  await key
    .getByRole("button", {
      name: "Disable automatic draft changes",
      exact: true,
    })
    .click();
  await key
    .getByRole("button", {
      name: "Disable automatic draft changes",
      exact: true,
    })
    .waitFor({ state: "detached" });
  assert.equal(
    (await c.external("execute", "POST", { ...input, requestId: randomUUID() }))
      .status,
    403,
  );
  await panel
    .getByText("Automation permission history", { exact: true })
    .click();
  await panel.getByText(/Automatic drafts: disabled/).waitFor();
  mkdirSync("test-results", { recursive: true });
  await panel.screenshot({ path: "test-results/delegation-desktop.png" });
  await page.setViewportSize({ width: 390, height: 844 });
  await key
    .getByLabel("Allow automatic draft execution", { exact: true })
    .check();
  await key
    .getByLabel("Automatic draft changes per preceding 24 hours", {
      exact: true,
    })
    .fill("4");
  assert.equal(
    await key
      .getByRole("button", { name: "Save automation permissions", exact: true })
      .isDisabled(),
    true,
  );
  assert.equal(
    await key.evaluate((el) => el.scrollWidth <= el.clientWidth + 1),
    true,
  );
  assert.equal(
    await panel.evaluate((el) => el.scrollWidth <= el.clientWidth + 1),
    true,
  );
  await page.screenshot({ path: "test-results/delegation-mobile.png" });
  await key
    .getByLabel("Allow automatic draft execution", { exact: true })
    .uncheck();
  const bounds = await panel.boundingBox();
  assert.ok(bounds && bounds.x >= 0 && bounds.x + bounds.width <= 391);
  assert.deepEqual(errors, []);
  console.log(
    "Delegated drafts browser passed: explicit separate consent/limits, reset on edits, automatic creation/edit audit, private guide inspection, immediate disable, permission history and mobile layout. No provider calls.",
  );
} catch (e) {
  mkdirSync("test-results", { recursive: true });
  await page?.screenshot({
    path: "test-results/delegation-failure.png",
    fullPage: true,
  });
  console.error(e);
  process.exitCode = 1;
} finally {
  await browser?.close();
  await stop();
}
