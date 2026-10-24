import { chromium, type Browser, type Page } from "playwright";
import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { start, stop, base } from "./harness";
let browser: Browser | undefined, page: Page | undefined;
try {
  await start();
  browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_PATH || "/usr/bin/chromium",
    args: ["--no-sandbox"],
  });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
  });
  page = await context.newPage();
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await context.request.post(base + "/api/auth/signup", {
    data: {
      name: "Pricing Browser",
      email: "pricing-browser@example.test",
      password: "pricing-browser-password",
    },
  });
  let study = (
    await (
      await context.request.post(base + "/api/studies", {
        data: { title: "Team subscription" },
      })
    ).json()
  ).study;
  study.draft.questions = [
    { ...study.draft.questions[1], id: "price", followUps: 0 },
  ];
  study = (
    await (
      await context.request.put(base + `/api/studies/${study.id}`, {
        data: { guide: study.draft, version: study.version },
      })
    ).json()
  ).study;
  await page.goto(base + `/?study=${study.id}&tab=guide`);
  await page
    .getByLabel("Question type", { exact: true })
    .selectOption("pricing");
  await page
    .getByLabel("Question wording")
    .fill("A subscription for a small research team.");
  await page
    .getByLabel("Prices (comma separated)", { exact: true })
    .fill("10, 20, 30");
  await page.getByLabel("Price unit", { exact: true }).fill("per month");
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  await page
    .getByRole("button", { name: "Publish revision", exact: true })
    .click();
  await context.request.post(base + `/api/studies/${study.id}/fielding`, {
    data: { state: "active" },
  });
  const participant = await browser.newContext({
      viewport: { width: 390, height: 844 },
    }),
    p = await participant.newPage();
  p.on("pageerror", (e) => errors.push(e.message));
  await p.goto(base + "/s/" + study.id);
  await p
    .getByLabel(
      "I agree to take part and have my responses stored and analyzed for this study.",
      { exact: true },
    )
    .check();
  await p.getByRole("button", { name: "Let’s begin", exact: true }).click();
  let joined: any;
  // Read the same persisted token used by the participant; never print it.
  await p.getByRole("radio", { name: "Yes", exact: true }).waitFor();
  const saved = await p.evaluate(
    (id) => JSON.parse(localStorage.getItem("study-session:" + id)!),
    study.id,
  );
  const headers = { "x-interview-token": saved.token };
  for (let n = 0; n < 12; n++) {
    joined = await (
      await participant.request.get(base + "/api/interviews/" + saved.id, {
        headers,
      })
    ).json();
    const i = joined.interview;
    if (i.status === "complete") break;
    if (i.pricingPrompt.phase === "reason") {
      await p
        .getByLabel("Your answer", { exact: true })
        .fill("The team budget covers this subscription.");
    } else {
      await p
        .getByRole("radio", {
          name: i.pricingPrompt.amountMinor <= 2000 ? "Yes" : "No",
          exact: true,
        })
        .check();
    }
    const response = p.waitForResponse(
      (r) => r.url().endsWith("/answer") && r.request().method() === "POST",
    );
    await p.getByRole("button", { name: "Continue", exact: true }).click();
    assert.equal((await response).status(), 200);
    if (n === 0) {
      await p.reload();
      await p.getByRole("heading", { level: 1 }).waitFor();
    }
  }
  await p
    .getByText("Your perspective makes a difference.", { exact: true })
    .waitFor();
  assert.ok(
    await p.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth + 1,
    ),
  );
  // Add a nonbuyer by API, then inspect the computed view and source modal.
  const nonbuyer = await (
    await context.request.post(base + `/api/public/${study.id}`, {
      data: { consent: true },
    })
  ).json();
  let i = nonbuyer.interview;
  for (let n = 0; n < 12 && i.status === "active"; n++)
    i = (
      await (
        await context.request.post(base + `/api/interviews/${i.id}/answer`, {
          headers: { "x-interview-token": nonbuyer.token },
          data: {
            requestId: randomUUID(),
            version: i.version,
            answer: i.pricingPrompt.phase === "reason" ? "skip" : "",
            optionId: "no",
          },
        })
      ).json()
    ).interview;
  await page.goto(base + `/?study=${study.id}&tab=pricing`);
  await page
    .getByRole("heading", { name: "Gabor–Granger pricing", exact: true })
    .waitFor();
  await page
    .getByText(
      "2 included · 1 nonbuyers retained · 0 inconsistent · 0 incomplete · 0 not asked",
      { exact: true },
    )
    .waitFor();
  assert.equal(
    await page.getByRole("img", { name: "Demand curve", exact: true }).count(),
    1,
  );
  assert.equal(
    await page.getByRole("img", { name: "Revenue curve", exact: true }).count(),
    1,
  );
  await page
    .getByText("Inspect 2 response outcomes and reasons", { exact: true })
    .click();
  await page
    .locator(".visual-observation")
    .filter({ hasText: "The team budget covers this subscription." })
    .getByRole("button", { name: "Inspect pricing source", exact: true })
    .click();
  await page
    .getByRole("dialog", { name: "Pricing source", exact: true })
    .waitFor();
  await page
    .getByRole("dialog", { name: "Pricing source", exact: true })
    .getByText("The team budget covers this subscription.", { exact: true })
    .waitFor();
  await page.getByRole("button", { name: "Close dialog", exact: true }).click();
  mkdirSync("test-results", { recursive: true });
  await page.screenshot({
    path: "test-results/pricing-desktop.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({
    path: "test-results/pricing-mobile.png",
    fullPage: true,
  });
  assert.ok(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth + 1,
    ),
  );
  await page.getByLabel("Segment attribute", { exact: true }).fill("segment");
  await page.getByLabel("Exact segment value", { exact: true }).fill("Missing");
  await page
    .getByRole("button", { name: "Apply pricing segment", exact: true })
    .click();
  await page.getByText(/No pricing responses match this view/).waitFor();
  assert.deepEqual(errors, []);
  console.log(
    "Pricing browser passed: guide setup, mobile adaptive ladder/check/reason/resume, retained nonbuyer, curves, source inspection, exact segment and responsive layout.",
  );
} catch (e) {
  mkdirSync("test-results", { recursive: true });
  await page
    ?.screenshot({ path: "test-results/pricing-failure.png", fullPage: true })
    .catch(() => {});
  throw e;
} finally {
  await browser?.close();
  await stop();
}
