import { chromium, type Browser, type Page } from "playwright";
import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { start, stop, base } from "./harness";
import { prolificSetup } from "./prolific-fixture";
let browser: Browser | undefined, page: Page | undefined;
try {
  await start({ port: 3445 });
  const c = await prolificSetup();
  const { dispatchProlific } = await import("../src/lib/prolific-server");
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
  // Real server handlers, DB, authorization, handoff and review controls; only the external vendor is a marked fixture.
  await page.route("**/api/studies/*/prolific**", async (route) => {
    const request = route.request(),
      parts = new URL(request.url()).pathname.split("/").slice(2);
    try {
      const r = await dispatchProlific(
        new Request(request.url(), {
          method: request.method(),
          headers: { "content-type": "application/json" },
          ...(request.postData() ? { body: request.postData() } : {}),
        }),
        parts,
        c.provider,
        c.actor,
      );
      await route.fulfill({
        status: r!.status,
        headers: Object.fromEntries(r!.headers),
        body: Buffer.from(await r!.arrayBuffer()),
      });
    } catch (e) {
      await route.fulfill({
        status: Number((e as any).status) || 400,
        contentType: "application/json",
        body: JSON.stringify({ error: (e as Error).message }),
      });
    }
  });
  await page.goto(base + `/?study=${c.study.id}&tab=fielding`);
  const panel = page.getByRole("region", {
      name: "Prolific recruitment",
      exact: true,
    }),
    review = panel.getByLabel(
      "I reviewed this plan’s audience, published guide, devices, compensation terms and budget.",
      { exact: true },
    );
  await panel
    .getByRole("heading", { name: "Prolific recruitment", exact: true })
    .waitFor();
  assert.equal(
    await panel
      .getByRole("button", { name: "Launch paid Prolific study", exact: true })
      .isDisabled(),
    true,
  );
  await panel
    .getByLabel("Prolific recruitment title", { exact: true })
    .fill("Browser recruitment plan");
  assert.equal(
    await panel
      .getByRole("button", { name: "Save reviewed Prolific plan", exact: true })
      .isDisabled(),
    true,
  );
  await review.check();
  await panel
    .getByRole("button", { name: "Save reviewed Prolific plan", exact: true })
    .click();
  await panel
    .getByText("Recruitment plan saved. No provider action was sent.", {
      exact: true,
    })
    .waitFor();
  assert.equal(c.calls.filter((v) => v.method !== "GET").length, 0);
  await review.check();
  await panel
    .getByRole("button", {
      name: "Create unpublished Prolific draft",
      exact: true,
    })
    .click();
  await panel
    .getByText(
      "Unpublished provider draft saved. No recruitment was launched.",
      { exact: true },
    )
    .waitFor();
  await review.check();
  await panel
    .getByRole("button", {
      name: "Launch no-credit Prolific test",
      exact: true,
    })
    .click();
  await panel
    .getByText(
      "Provider test clone launched. Confirm its test-participant experience in Prolific.",
      { exact: true },
    )
    .waitFor();
  assert.equal(
    c.calls.some((v) => v.data?.action === "PUBLISH"),
    false,
  );
  const participant = await browser.newContext({
      viewport: { width: 390, height: 844 },
    }),
    p = await participant.newPage();
  p.on("pageerror", (e) => errors.push(e.message));
  await participant.route("https://app.prolific.com/**", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: "<h1>Marked Prolific return</h1>",
    }),
  );
  for (const query of [
    "handoff=prolific",
    "handoff=prolific&PROLIFIC_PID=a&STUDY_ID=b&SESSION_ID=c&rid=bad",
  ]) {
    await p.goto(base + `/s/${c.study.id}?` + query);
    await p
      .getByText(
        "This Prolific link has missing, invalid or mixed identifiers. Contact the research team.",
        { exact: true },
      )
      .waitFor();
  }
  await p.goto(
    base +
      `/s/${c.study.id}?handoff=prolific&PROLIFIC_PID=participant_1&STUDY_ID=vendor_test&SESSION_ID=submission_1`,
  );
  await p.getByRole("checkbox").check();
  await p.getByRole("button", { name: "Let’s begin", exact: true }).click();
  await p
    .getByLabel("Your answer", { exact: true })
    .fill("A marked browser source, independently reviewed.");
  await p.getByRole("button", { name: "Continue", exact: true }).click();
  await p
    .getByRole("button", { name: "Continue to Prolific", exact: true })
    .waitFor();
  c.submissions([
    {
      id: "submission_1",
      participant_id: "participant_1",
      status: "AWAITING REVIEW",
      started_at: "2026-10-01T11:45:00Z",
      completed_at: "2026-10-01T12:00:00Z",
      payment_info: { status: "pending" },
    },
  ]);
  await panel
    .getByRole("button", {
      name: "Reconcile Prolific submissions",
      exact: true,
    })
    .click();
  await panel.getByText("Matched IDs", { exact: true }).waitFor();
  await panel.getByText("pending", { exact: true }).waitFor();
  const download = page.waitForEvent("download");
  await panel
    .getByRole("link", {
      name: "Export private Prolific reconciliation CSV",
      exact: true,
    })
    .click();
  assert.ok(await (await download).path());
  await p
    .getByRole("button", { name: "Continue to Prolific", exact: true })
    .click();
  await p
    .getByRole("heading", { name: "Marked Prolific return", exact: true })
    .waitFor();
  mkdirSync("test-results", { recursive: true });
  await panel.screenshot({ path: "test-results/prolific-desktop.png" });
  await page.setViewportSize({ width: 390, height: 844 });
  await panel.screenshot({ path: "test-results/prolific-mobile.png" });
  const bounds = await panel.boundingBox();
  assert.ok(bounds && bounds.x >= 0 && bounds.x + bounds.width <= 390);
  assert.equal(
    await panel
      .locator(".table-scroll")
      .evaluate((el) => getComputedStyle(el).overflowX),
    "auto",
  );
  assert.deepEqual(errors, []);
  console.log(
    "Prolific browser passed: reviewed plan, marked unpublished/test provider calls, paid launch disabled, native participant identifiers/consent/answer/return, submission/payment separation, private CSV and mobile layout. No real vendor account, recruitment or payments.",
  );
} catch (e) {
  mkdirSync("test-results", { recursive: true });
  await page?.screenshot({
    path: "test-results/prolific-failure.png",
    fullPage: true,
  });
  console.error((await page?.locator("body").innerText())?.slice(-6500));
  console.error(e);
  process.exitCode = 1;
} finally {
  await browser?.close();
  await stop();
}
