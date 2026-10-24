import { chromium, type Browser } from "playwright";
import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { start, stop, base } from "./harness";
import { emotionInterview } from "./emotion-fixture";
let browser: Browser | undefined;
try {
  await start();
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
  const call = async (
    path: string,
    method = "GET",
    data?: unknown,
    headers?: Record<string, string>,
  ) => {
    const r = await context.request.fetch(base + "/api/" + path, {
      method,
      data,
      headers,
    });
    assert.ok(r.ok(), await r.text());
    return r.json();
  };
  await call("auth/signup", "POST", {
    name: "Incentive researcher",
    email: "incentives-browser@example.test",
    password: "incentives-browser-password",
  });
  let s = (await call("studies", "POST", { title: "Incentive browser" })).study;
  s = (
    await call(`studies/${s.id}`, "PUT", {
      version: s.version,
      guide: emotionInterview().guide,
    })
  ).study;
  await call(`studies/${s.id}/publish`, "POST", { version: s.version });
  await call(`studies/${s.id}/fielding`, "POST", { state: "active" });
  const j = await call(`public/${s.id}`, "POST", { consent: true });
  await call(
    `interviews/${j.interview.id}/answer`,
    "POST",
    {
      requestId: randomUUID(),
      version: 0,
      value: ["happy", "", ""],
      answer: "",
    },
    { "x-interview-token": j.token },
  );
  await page.goto(base + `/?study=${s.id}&tab=fielding`);
  await page
    .getByRole("heading", { name: "Participant incentives", exact: true })
    .waitFor();
  await page.getByText("Incentive review terms", { exact: true }).click();
  await page.getByLabel("Enable incentive reviews", { exact: true }).check();
  await page.getByLabel("Incentive amount", { exact: true }).fill("25.50");
  await page
    .getByLabel("Eligibility and review terms", { exact: true })
    .fill("Complete the interview and pass a source quality review.");
  await page
    .getByRole("button", { name: "Save incentive terms", exact: true })
    .click();
  await page
    .getByText(
      "Review terms saved. Existing approvals keep their agreed amount and currency.",
      { exact: true },
    )
    .waitFor();
  await page
    .getByRole("button", { name: "Approve incentive", exact: true })
    .click();
  let modal = page.getByRole("dialog");
  await modal.getByText("$25.50", { exact: false }).waitFor();
  await modal
    .getByLabel("Review or reconciliation reason", { exact: true })
    .fill("Reviewed complete source.");
  await modal
    .getByRole("button", { name: "Confirm incentive approval", exact: true })
    .click();
  await page
    .getByRole("cell", { name: "Approved, unpaid", exact: true })
    .waitFor();
  await page.getByLabel("Incentive amount", { exact: true }).fill("30.00");
  await page
    .getByLabel("Incentive currency", { exact: true })
    .selectOption("EUR");
  await page
    .getByRole("button", { name: "Save incentive terms", exact: true })
    .click();
  await page
    .getByText(
      "Review terms saved. Existing approvals keep their agreed amount and currency.",
      { exact: true },
    )
    .waitFor();
  assert.equal(
    (await call(`studies/${s.id}/incentives`)).rows[0].record.terms.amountMinor,
    2550,
  );
  await page
    .getByRole("button", { name: "Record payment", exact: true })
    .click();
  modal = page.getByRole("dialog");
  await modal
    .getByLabel("Payment reference", { exact: true })
    .fill("=Gift-001");
  await modal
    .getByLabel("Payment method", { exact: true })
    .selectOption("gift_card");
  await modal
    .getByLabel("Review or reconciliation reason", { exact: true })
    .fill("Sent outside Echo Lab.");
  assert.equal(
    await modal
      .getByRole("button", { name: "Confirm payment record", exact: true })
      .isDisabled(),
    true,
  );
  await modal.getByRole("checkbox").check();
  await modal
    .getByRole("button", { name: "Confirm payment record", exact: true })
    .click();
  await page
    .getByRole("cell", { name: "Payment recorded", exact: true })
    .waitFor();
  await page
    .getByRole("button", { name: "View incentive history", exact: true })
    .click();
  await page
    .getByRole("dialog")
    .getByText(/Gift-001/)
    .waitFor();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Close dialog", exact: true })
    .click();
  const exported = await context.request.get(
    base + `/api/studies/${s.id}/incentives/export`,
  );
  assert.ok((await exported.text()).includes("Gift-001"));
  mkdirSync("test-results", { recursive: true });
  await page.screenshot({
    path: "test-results/incentives-desktop.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({
    path: "test-results/incentives-mobile.png",
    fullPage: true,
  });
  assert.ok(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth + 1,
    ),
  );
  await page
    .getByRole("button", { name: "Void payment record", exact: true })
    .click();
  modal = page.getByRole("dialog");
  await modal.getByText(/does not cancel a transfer or refund money/).waitFor();
  await modal
    .getByLabel("Review or reconciliation reason", { exact: true })
    .fill("Synthetic reconciliation correction.");
  await modal
    .getByRole("button", { name: "Confirm void record", exact: true })
    .click();
  await page
    .getByRole("cell", { name: "Payment voided", exact: true })
    .waitFor();
  assert.deepEqual(errors, []);
  console.log(
    "Incentives browser passed: review terms, frozen approval, explicit manual payment confirmation, history, exports, voiding and mobile layout.",
  );
} finally {
  await browser?.close();
  await stop();
}
