import { chromium, type Browser } from "playwright";
import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { start, stop, base } from "./harness";
import { pulseFixture } from "./pulse-fixture";
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
    name: "Pulse Browser",
    email: "pulse-browser@example.test",
    password: "pulse-browser-password",
  });
  let study = (await call("studies", "POST", { title: "Experience tracker" }))
    .study;
  study = (
    await call(`studies/${study.id}`, "PUT", {
      guide: pulseFixture().guide,
      version: study.version,
    })
  ).study;
  study = (
    await call(`studies/${study.id}/publish`, "POST", {
      version: study.version,
    })
  ).study;
  await call(`studies/${study.id}/fielding`, "POST", { state: "active" });
  for (const score of [8, 4]) {
    const joined = await call("public/" + study.id, "POST", {
      consent: true,
      attributes: { segment: "Team" },
    });
    let i = joined.interview;
    for (const answer of [
      { value: score },
      { optionId: score === 8 ? "yes" : "no" },
      { answer: "The price is too high for me." },
    ])
      i = (
        await call(
          `interviews/${i.id}/answer`,
          "POST",
          {
            answer: "",
            ...answer,
            version: i.version,
            requestId: randomUUID(),
          },
          { "x-interview-token": joined.token },
        )
      ).interview;
  }
  await page.goto(base + `/?study=${study.id}&tab=pulse`);
  await page.getByLabel("Tracker name").fill("Customer experience Pulse");
  await page.getByLabel("Wave label").fill("October baseline");
  await page
    .getByLabel("Recruitment protocol")
    .fill("Same panel, market and age quotas each wave");
  await page
    .getByRole("button", { name: "Create Pulse tracker", exact: true })
    .click();
  await page
    .getByRole("heading", { name: "Customer experience Pulse", exact: true })
    .waitFor();
  await page
    .getByRole("button", { name: "Edit shared codebook", exact: true })
    .click();
  let modal = page.getByRole("dialog");
  await modal.getByRole("button", { name: "Add code", exact: true }).click();
  await modal.getByLabel("Code 1 name").fill("Price concern");
  await modal
    .getByLabel("Code 1 definition")
    .fill("Explicit price concerns; exclude positive value statements.");
  await modal
    .getByRole("button", { name: "Save codebook version", exact: true })
    .click();
  await modal.waitFor({ state: "hidden" });
  await page.getByText("Review recurring answers (2)", { exact: true }).click();
  const reviewButtons = page.getByRole("button", {
    name: /Review .* · unreviewed/,
  });
  await reviewButtons.first().click();
  modal = page.getByRole("dialog");
  await modal.getByRole("checkbox").last().check();
  await modal
    .getByRole("button", { name: "Save reviewed coding", exact: true })
    .click();
  await modal.waitFor({ state: "hidden" });
  await page.getByText(/1 reviewed; 1 unreviewed/).waitFor();
  await reviewButtons.first().click();
  await modal
    .getByRole("button", { name: "Save reviewed coding", exact: true })
    .click();
  await modal.waitFor({ state: "hidden" });
  await page
    .getByText("Design checks passed. Deltas describe these samples only.", {
      exact: true,
    })
    .waitFor();
  assert.ok(
    await page.getByText(/Price concern: 1\/2 reviewed \(50.0%\)/).count(),
  );
  await page.getByLabel("Segment attribute").fill("segment");
  await page.getByLabel("Exact segment value").fill("Other");
  await page
    .getByRole("button", { name: "Apply Pulse segment", exact: true })
    .click();
  await page
    .getByText("Review recurring answers (0)", { exact: true })
    .waitFor();
  await page.getByLabel("Segment attribute").fill("");
  await page
    .getByRole("button", { name: "Apply Pulse segment", exact: true })
    .click();
  await page
    .getByText("Review recurring answers (2)", { exact: true })
    .waitFor();
  const exportLink = page.getByRole("link", {
    name: "Export recurring evidence",
    exact: true,
  });
  const exported = await context.request.get(
    base + (await exportLink.getAttribute("href")),
  );
  assert.ok((await exported.text()).includes("Explicit price concerns"));
  await page
    .getByRole("button", { name: "Create next wave", exact: true })
    .click();
  modal = page.getByRole("dialog");
  await modal.getByLabel("Wave label").fill("November wave");
  await modal.getByLabel("Wave date").fill("2026-11-19");
  await modal
    .getByRole("button", { name: "Create draft wave", exact: true })
    .click();
  await modal.waitFor({ state: "hidden" });
  await page
    .getByRole("heading", { name: /November wave · 2026-11-19/ })
    .waitFor();
  await page
    .getByText("Wave has no published design.", { exact: true })
    .waitFor();
  // Publish a changed design and verify the visible break instead of a clean trend.
  const waveId = new URL(page.url()).searchParams.get("study")!;
  let wave = (await call(`studies/${waveId}`)).study;
  wave.draft.questions[0].text =
    "How satisfied are you with the new experience?";
  wave = (
    await call(`studies/${waveId}`, "PUT", {
      guide: wave.draft,
      version: wave.version,
    })
  ).study;
  await call(`studies/${waveId}/publish`, "POST", { version: wave.version });
  await page
    .getByRole("button", { name: "Refresh Pulse", exact: true })
    .click();
  await page
    .getByText(
      "Recurring question wording, order, screening, scale, options or moderation changed.",
      { exact: true },
    )
    .waitFor();
  mkdirSync("test-results", { recursive: true });
  await page.screenshot({
    path: "test-results/pulse-desktop.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({
    path: "test-results/pulse-mobile.png",
    fullPage: true,
  });
  assert.ok(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
    "Pulse must fit a mobile viewport",
  );
  assert.deepEqual(errors, []);
  console.log(
    "Pulse browser passed: tracker, shared coding, review denominators, segment reset, source export, new draft wave, visible design break and mobile layout.",
  );
} finally {
  await browser?.close();
  await stop();
}
