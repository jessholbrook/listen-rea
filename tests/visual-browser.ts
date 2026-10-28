import { chromium, type Browser, type Page } from "playwright";
import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { start, stop, base } from "./harness";
import { visualFixture } from "./visual-fixture";
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
  page.on("dialog", (d) => d.accept());
  await context.request.post(base + "/api/auth/signup", {
    data: {
      name: "Visual Reviewer",
      email: "visual-browser@example.test",
      password: "visual-browser-password",
    },
  });
  const study = (
    await (
      await context.request.post(base + "/api/studies", {
        data: { title: "Visual review" },
      })
    ).json()
  ).study;
  const imported = await (
    await context.request.post(base + "/api/library/imports", {
      data: {
        studyId: study.id,
        requestId: randomUUID(),
        externalId: "visual",
        title: "Synthetic screen",
        transcript: "Participant: I opened help.",
        permissionConfirmed: true,
        transcriptReviewed: true,
      },
    })
  ).json();
  const uploaded = await context.request.post(
    base + `/api/library/imports/${imported.interviewId}/media`,
    { headers: { "content-type": "video/mp4" }, data: await visualFixture() },
  );
  assert.equal(uploaded.status(), 201);
  await page.goto(base + `/?study=${study.id}&tab=visual`);
  await page
    .getByRole("button", { name: "Visual Insights", exact: true })
    .click();
  await page
    .getByRole("heading", { name: "Visual Insights", exact: true })
    .waitFor();
  await page
    .getByLabel("Visible observation", { exact: true })
    .fill("SUPPORT heading is visible.");
  await page
    .getByLabel("Observation time (seconds)", { exact: true })
    .fill("2");
  await page
    .getByRole("button", { name: "Save observation", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Edit / review observation", exact: true })
    .waitFor();
  await page
    .getByRole("button", { name: "Edit / review observation", exact: true })
    .click();
  await page
    .getByLabel("Review status", { exact: true })
    .selectOption("confirmed");
  await page
    .getByLabel(
      "I reviewed the video time, visible description, interpretation, uncertainty and any account comparison.",
      { exact: true },
    )
    .check();
  await page
    .getByRole("button", { name: "Save observation", exact: true })
    .click();
  await page.getByText("confirmed · researcher", { exact: true }).waitFor();
  const state = await (
    await context.request.get(base + `/api/studies/${study.id}/visual`)
  ).json();
  assert.equal(state.observations[0].reviewed, true);
  const exported = await context.request.get(
    base + `/api/studies/${study.id}/visual/export`,
  );
  assert.ok((await exported.text()).includes("SUPPORT heading is visible."));
  await page.getByRole("button", { name: /0:02\.000/, exact: true }).click();
  assert.ok(
    Math.abs(
      (await page
        .locator("video")
        .evaluate((v: HTMLVideoElement) => v.currentTime)) - 2,
    ) < 0.2,
  );
  await page
    .getByRole("button", { name: "View observation history", exact: true })
    .click();
  await page.getByRole("dialog").waitFor();
  await page.getByText("v2 · confirmed", { exact: true }).waitFor();
  await page.getByRole("button", { name: "Close dialog", exact: true }).click();
  mkdirSync("test-results", { recursive: true });
  await page.screenshot({
    path: "test-results/visual-desktop.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({
    path: "test-results/visual-mobile.png",
    fullPage: true,
  });
  assert.ok(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth + 1,
    ),
  );
  await page
    .getByRole("button", { name: "Delete observation", exact: true })
    .click();
  await page
    .getByRole("status")
    .filter({ hasText: "Observation and history deleted." })
    .waitFor();
  assert.equal(
    (
      await (
        await context.request.get(base + `/api/studies/${study.id}/visual`)
      ).json()
    ).observations.length,
    0,
  );
  assert.deepEqual(errors, []);
  console.log(
    "Visual browser passed: manual notes, reviewed confirmation, version history, exact playback seek, CSV, deletion and mobile layout.",
  );
} catch (e) {
  mkdirSync("test-results", { recursive: true });
  await page
    ?.screenshot({ path: "test-results/visual-failure.png", fullPage: true })
    .catch(() => {});
  throw e;
} finally {
  await browser?.close();
  await stop();
}
