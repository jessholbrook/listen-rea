import { chromium, type Browser, type Page } from "playwright";
import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { start, stop, base } from "./harness";
import { notificationsSetup } from "./notifications-fixture";
let browser: Browser | undefined, page: Page | undefined;
try {
  await start({ port: 3451, notifications: true });
  const c = await notificationsSetup(),
    { dispatchNotifications } = await import("../src/lib/notification-server");
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
  page = await context.newPage();
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.route("**/api/notifications**", async (route) => {
    const r = route.request();
    try {
      const result = await dispatchNotifications(
        new Request(r.url(), {
          method: r.method(),
          headers: r.headers(),
          ...(r.postData() ? { body: r.postData() } : {}),
        }),
        new URL(r.url()).pathname.split("/").slice(2),
        c.sender,
        c.actor,
      );
      await route.fulfill({
        status: result!.status,
        headers: Object.fromEntries(result!.headers),
        body: Buffer.from(await result!.arrayBuffer()),
      });
    } catch (e) {
      await route.fulfill({
        status: (e as any).status || 400,
        contentType: "application/json",
        body: JSON.stringify({ error: (e as Error).message }),
      });
    }
  });
  await page.goto(base);
  await page
    .getByRole("button", { name: "Team & settings", exact: true })
    .click();
  const panel = page.getByRole("region", {
    name: "Integration notifications",
    exact: true,
  });
  await panel
    .getByRole("heading", { name: "Integration notifications", exact: true })
    .waitFor();
  await panel.getByText("Register a destination", { exact: true }).click();
  const form = panel.locator("form");
  await form
    .getByLabel("Destination name", { exact: true })
    .fill("Browser owned receiver");
  await form
    .getByLabel("Receiver HTTPS URL", { exact: true })
    .fill("https://receiver.example.com/browser");
  await form
    .getByLabel("Synthetic notification study", { exact: true })
    .check();
  await form.getByLabel("Study versions and fielding", { exact: true }).check();
  const register = form.getByRole("button", {
    name: "Register disabled destination",
    exact: true,
  });
  assert.equal(await register.isDisabled(), true);
  await form.getByLabel(/I own this receiver/).check();
  await register.click();
  const key = panel.getByLabel("Notification signing key", { exact: true });
  await key.waitFor();
  assert.ok((await key.inputValue()).startsWith("eln_"));
  assert.equal(await key.getAttribute("type"), "password");
  await panel
    .getByRole("button", { name: "Hide signing key", exact: true })
    .click();
  await key.waitFor({ state: "detached" });
  const card = panel.getByRole("article", {
    name: "Notification destination Browser owned receiver",
    exact: true,
  });
  await card.getByLabel(/I reviewed this destination and scope/).check();
  await card
    .getByRole("button", { name: "Verify notification receiver", exact: true })
    .click();
  await card.getByText(/Verified receiver/).waitFor();
  await card.getByLabel("Enable future notifications", { exact: true }).check();
  await card.getByLabel(/I reviewed this destination and scope/).check();
  await card
    .getByRole("button", { name: "Save notification settings", exact: true })
    .click();
  await card
    .getByRole("button", {
      name: "Disable notifications immediately",
      exact: true,
    })
    .waitFor();
  await c.changed();
  let view = await (await c.ask())!.json();
  const registered = view.endpoints.find(
    (e: any) => e.name === "Browser owned receiver",
  );
  const delivery = view.deliveries.find(
    (d: any) => d.endpointId === registered.id,
  );
  c.setStatus(503);
  await c.deliver(delivery.id);
  await c.due();
  c.setStatus(204);
  await c.drain();
  await panel
    .getByRole("button", { name: "Refresh notifications", exact: true })
    .click();
  await panel.getByText("study.changed · delivered", { exact: true }).waitFor();
  await card
    .getByRole("button", {
      name: "Disable notifications immediately",
      exact: true,
    })
    .click();
  await card
    .getByRole("button", {
      name: "Disable notifications immediately",
      exact: true,
    })
    .waitFor({ state: "detached" });
  await card.getByLabel(/I reviewed this destination and scope/).check();
  await card
    .getByRole("button", {
      name: "Rotate notification signing key",
      exact: true,
    })
    .click();
  await key.waitFor();
  assert.equal(
    (await (await c.ask())!.json()).endpoints.find(
      (e: any) => e.id === registered.id,
    ).verifiedAt,
    undefined,
  );
  await panel
    .getByRole("button", { name: "Hide signing key", exact: true })
    .click();
  mkdirSync("test-results", { recursive: true });
  await page.screenshot({ path: "test-results/notifications-desktop.png" });
  await page.setViewportSize({ width: 390, height: 844 });
  await card.getByText("Edit destination and scope", { exact: true }).click();
  await card
    .getByLabel("Receiver HTTPS URL", { exact: true })
    .fill("https://receiver.example.com/new-location");
  assert.equal(
    await card.getByLabel(/I reviewed this destination and scope/).isChecked(),
    false,
  );
  assert.equal(
    await card.evaluate((e) => e.scrollWidth <= e.clientWidth + 1),
    true,
  );
  assert.equal(
    await panel.evaluate((e) => e.scrollWidth <= e.clientWidth + 1),
    true,
  );
  await page.screenshot({ path: "test-results/notifications-mobile.png" });
  assert.deepEqual(errors, []);
  console.log(
    "Integration notifications browser passed: disabled registration, one-time masked key, ownership verification, explicit enablement, delivery/retry log, immediate disable, key rotation and responsive scope controls. External sender is a marked fixture.",
  );
} catch (e) {
  mkdirSync("test-results", { recursive: true });
  await page?.screenshot({
    path: "test-results/notifications-failure.png",
    fullPage: true,
  });
  console.error(e);
  process.exitCode = 1;
} finally {
  await browser?.close();
  await stop();
}
