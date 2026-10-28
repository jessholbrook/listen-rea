import { chromium, type Browser } from "playwright";
import assert from "node:assert/strict";
import { randomUUID, randomBytes } from "node:crypto";
import { mkdirSync } from "node:fs";
import { start, stop, base } from "./harness";
import { emotionInterview } from "./emotion-fixture";
let browser: Browser | undefined;
try {
  await start({ email: true });
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
  const call = async (path: string, method = "GET", data?: unknown) => {
    const r = await context.request.fetch(base + "/api/" + path, {
      method,
      data,
    });
    assert.ok(r.ok(), await r.text());
    return r.json();
  };
  await call("auth/signup", "POST", {
    name: "Email researcher",
    email: "email-browser@example.test",
    password: "email-browser-password",
  });
  let s = (await call("studies", "POST", { title: "Email invitations" })).study;
  s = (
    await call(`studies/${s.id}`, "PUT", {
      version: s.version,
      guide: emotionInterview().guide,
    })
  ).study;
  await call(`studies/${s.id}/publish`, "POST", { version: s.version });
  await call(`studies/${s.id}/fielding`, "POST", { state: "active" });
  const issued = await call(`studies/${s.id}/invitations`, "POST", {
    requestId: randomUUID(),
    secret: randomBytes(32).toString("hex"),
    expiresAt: new Date(Date.now() + 86400000).toISOString(),
    recipients: [{ reference: "P001" }],
  });
  await page.goto(base + `/?study=${s.id}&tab=fielding`);
  await page
    .getByRole("heading", {
      name: "Email invitations and reminders",
      exact: true,
    })
    .waitFor();
  await page.getByText("Draft participant email", { exact: true }).click();
  await page
    .getByLabel("Email participant invitation", { exact: true })
    .selectOption(issued.links[0].invitation.id);
  await page
    .getByLabel("Recipient email", { exact: true })
    .fill("private@example.test");
  await page
    .getByLabel("Individual invitation link", { exact: true })
    .fill(base + issued.links[0].path);
  await page
    .getByLabel("Email subject", { exact: true })
    .fill("A reviewed invitation");
  await page
    .getByLabel("Email message", { exact: true })
    .fill("Please share your experience in this internal study.");
  await page
    .getByRole("button", { name: "Save and review email", exact: true })
    .click();
  let modal = page.getByRole("dialog", {
    name: "Review participant email",
    exact: true,
  });
  await modal.getByText("To: private@example.test", { exact: true }).waitFor();
  await modal
    .getByText(/Please share your experience in this internal study./)
    .waitFor();
  assert.ok(
    (
      await modal
        .getByText(/If you do not wish to receive reminders/)
        .textContent()
    )?.includes(issued.links[0].path),
  );
  assert.equal(
    await modal
      .getByRole("button", { name: "Send this email now", exact: true })
      .isDisabled(),
    true,
  );
  await modal.getByRole("checkbox").check();
  assert.equal(
    await modal
      .getByRole("button", { name: "Send this email now", exact: true })
      .isDisabled(),
    true,
  );
  await modal
    .getByRole("button", { name: "Close dialog", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Cancel email draft", exact: true })
    .click();
  modal = page.getByRole("dialog", { name: "Cancel email draft", exact: true });
  await modal
    .getByRole("button", { name: "Confirm cancellation", exact: true })
    .click();
  await page.getByRole("cell", { name: /cancelled/ }).waitFor();
  await page
    .getByRole("button", { name: "Stop email to address", exact: true })
    .click();
  modal = page.getByRole("dialog", {
    name: "Stop email to address",
    exact: true,
  });
  await modal
    .getByRole("button", { name: "Confirm email stop", exact: true })
    .click();
  await page.getByText("Email stopped", { exact: true }).waitFor();
  const exportData = await context.request.get(
    base + `/api/studies/${s.id}/emails/export`,
  );
  const csv = await exportData.text();
  assert.ok(csv.includes("private@example.test"));
  assert.ok(!csv.includes(issued.links[0].path));
  mkdirSync("test-results", { recursive: true });
  await page.screenshot({
    path: "test-results/email-delivery-desktop.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({
    path: "test-results/email-delivery-mobile.png",
    fullPage: true,
  });
  assert.ok(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth + 1,
    ),
  );
  assert.deepEqual(errors, []);
  console.log(
    "Email browser passed: draft composition, exact preview, missing-provider send gate, cancellation, suppression, private export and mobile layout. No email sent.",
  );
} finally {
  await browser?.close();
  await stop();
}
