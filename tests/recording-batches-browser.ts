import { chromium, type Browser } from "playwright";
import assert from "node:assert/strict";
import { start, stop, base } from "./harness";
import { recordingSetup, recordingRoot } from "./library-recordings-fixture";
import { recordingLabels } from "../src/lib/library-recordings";
import { batchLabels } from "../src/lib/recording-batches";
import { toneWav } from "./reporting-fixture";
let browser: Browser | undefined;
try {
  await start({ port: 3368 });
  const c = await recordingSetup();
  browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_PATH || "/usr/bin/chromium",
    args: ["--no-sandbox"],
  });
  const context = await browser.newContext({
      viewport: { width: 390, height: 844 },
    }),
    page = await context.newPage(),
    errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  assert.ok(
    (
      await context.request.post(base + "/api/auth/login", {
        data: { email: c.email, password: "saved-library-password" },
      })
    ).ok(),
  );
  let failUpload = true,
    failTranscription = true,
    calls = 0;
  await page.route("**/api/library/recordings/*/part", async (route) => {
    if (failUpload) {
      failUpload = false;
      await route.fulfill({
        status: 503,
        json: { error: "MARKED_UPLOAD_FAILURE" },
      });
    } else await route.continue();
  });
  await page.route("**/api/library/recordings/*/transcribe", async (route) => {
    calls++;
    if (failTranscription) {
      failTranscription = false;
      await route.fulfill({
        status: 503,
        json: { error: "MARKED_TRANSCRIPTION_FAILURE" },
      });
      return;
    }
    const id = route.request().url().split("/").at(-2)!,
      r = (await c.owner(recordingRoot + "/" + id)).recording;
    await route.fulfill({ json: { recording: await c.transcribe(r) } });
  });
  async function navigate() {
    await page.goto(base);
    await page
      .getByRole("button", { name: "Research library", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Recording transcription", exact: true })
      .click();
  }
  await navigate();
  let previous = "en" as "en" | "es" | "fr";
  for (const language of ["en", "es", "fr"] as const) {
    const l = recordingLabels[language],
      b = batchLabels[language];
    await page
      .getByLabel(recordingLabels[previous].language, { exact: true })
      .selectOption(language);
    previous = language;
    const region = page.getByRole("region", { name: b.title, exact: true });
    await region.getByLabel(b.files, { exact: true }).setInputFiles([
      { name: "batch-a.wav", mimeType: "audio/wav", buffer: toneWav(1200) },
      { name: "batch-b.wav", mimeType: "audio/wav", buffer: toneWav(1400) },
    ]);
    await region
      .getByLabel(`${b.name} 1`, { exact: true })
      .fill("Batch source one " + language);
    await region
      .getByLabel(`${b.name} 2`, { exact: true })
      .fill("Batch source two " + language);
    await region
      .getByRole("checkbox", { name: b.permission, exact: true })
      .check();
    await region.getByRole("button", { name: b.create, exact: true }).click();
    await region.getByText(b.done, { exact: true }).waitFor({ timeout: 60000 });
    const selected = await region
      .getByLabel(b.saved, { exact: true })
      .inputValue();
    let items = (await c.owner(recordingRoot)).recordings.filter(
      (r: any) => r.batchId === selected,
    );
    assert.equal(items.length, 2);
    if (language === "en") {
      assert.equal(items.filter((r: any) => r.status === "uploaded").length, 1);
      assert.equal(
        items.filter((r: any) => r.status === "awaiting_upload").length,
        1,
      );
      // Refresh loses browser File objects, but durable slot and manifest remain.
      await navigate();
      const fresh = page.getByRole("region", { name: b.title, exact: true });
      await fresh.locator("[data-batch-recording-id]").first().waitFor();
      const pending = items.find((r: any) => r.status === "awaiting_upload");
      await fresh
        .locator(`[data-batch-recording-id="${pending.id}"]`)
        .getByRole("button", { name: b.review, exact: true })
        .click();
      const editor = page.getByRole("region", { name: l.source, exact: true });
      await editor.getByLabel(l.resume, { exact: true }).setInputFiles({
        name: "batch-a.wav",
        mimeType: "audio/wav",
        buffer: toneWav(1200),
      });
      await editor
        .getByRole("button", { name: l.transcribe, exact: true })
        .waitFor();
      await page.waitForFunction(() =>
        Array.from(document.querySelectorAll("button")).some(
          (b) => b.textContent === "Generate transcript draft" && !b.disabled,
        ),
      );
      await editor.getByRole("button", { name: l.close, exact: true }).click();
      await fresh.getByRole("button", { name: b.refresh, exact: true }).click();
    }
    const current = page.getByRole("region", { name: b.title, exact: true }),
      before = calls;
    await current
      .getByRole("button", { name: b.transcribe, exact: true })
      .click();
    await current
      .getByText(b.done, { exact: true })
      .waitFor({ timeout: 60000 });
    assert.equal(calls - before, 2);
    items = (await c.owner(recordingRoot)).recordings.filter(
      (r: any) => r.batchId === selected,
    );
    if (language === "en") {
      assert.equal(items.filter((r: any) => r.status === "draft").length, 1);
      await current
        .getByRole("button", { name: b.transcribe, exact: true })
        .click();
      await current
        .getByRole("button", { name: b.transcribe, exact: true })
        .waitFor();
      await current.getByText(b.done, { exact: true }).waitFor();
      await page.waitForFunction(() =>
        Array.from(document.querySelectorAll("button")).some(
          (b) =>
            b.textContent === "Generate remaining batch transcripts" &&
            b.disabled,
        ),
      );
      assert.equal(calls - before, 3);
    }
    items = (await c.owner(recordingRoot)).recordings.filter(
      (r: any) => r.batchId === selected,
    );
    assert.ok(items.every((r: any) => r.status === "draft"));
    assert.equal(
      (await c.owner("library")).sources.length,
      language === "en" ? 0 : language === "es" ? 1 : 2,
    );
    const first = items[0];
    await current
      .locator(`[data-batch-recording-id="${first.id}"]`)
      .getByRole("button", { name: b.review, exact: true })
      .click();
    const editor = page.getByRole("region", { name: l.source, exact: true });
    await editor
      .getByRole("button", { name: l.approve, exact: true })
      .waitFor();
    assert.equal(
      await editor
        .getByRole("button", { name: l.approve, exact: true })
        .isDisabled(),
      true,
    );
    await editor
      .getByRole("checkbox", { name: l.reviewed, exact: true })
      .check();
    await editor.getByRole("button", { name: l.save, exact: true }).click();
    await page.waitForFunction(
      (label) =>
        Array.from(document.querySelectorAll("button")).some(
          (b) => b.textContent === label && !b.disabled,
        ),
      l.approve,
    );
    await editor.getByRole("button", { name: l.approve, exact: true }).click();
    await editor
      .getByRole("button", { name: l.response, exact: true })
      .waitFor();
    await editor.getByRole("button", { name: l.close, exact: true }).click();
    items = (await c.owner(recordingRoot)).recordings.filter(
      (r: any) => r.batchId === selected,
    );
    assert.equal(items.filter((r: any) => r.status === "imported").length, 1);
    assert.equal(items.filter((r: any) => r.status === "draft").length, 1);
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth + 1,
      ),
      true,
    );
    await page.screenshot({
      path: `test-results/recording-batch-${language}.png`,
      fullPage: true,
    });
  }
  await navigate();
  const b = batchLabels.en,
    batchRegion = page.getByRole("region", { name: b.title, exact: true });
  await page.unroute("**/api/library/recordings/*/part");
  let refreshFailure = false,
    completedFiles = 0;
  await page.route("**/api/library/recordings", async (route) => {
    if (refreshFailure && route.request().method() === "GET")
      await route.fulfill({
        status: 503,
        json: { error: "MARKED_REFRESH_FAILURE" },
      });
    else await route.continue();
  });
  await page.route("**/api/library/recordings/*/complete", async (route) => {
    const response = await route.fetch();
    completedFiles++;
    if (completedFiles === 2) refreshFailure = true;
    await route.fulfill({ response });
  });
  let pauseOnce = true;
  const partRequests: string[] = [];
  await page.route("**/api/library/recordings/*/part", async (route) => {
    partRequests.push(
      route.request().url() +
        ":" +
        route.request().headers()["x-recording-part"],
    );
    if (pauseOnce) {
      pauseOnce = false;
      await batchRegion
        .getByRole("button", { name: b.pause, exact: true })
        .click();
    }
    await route.continue();
  });
  await batchRegion.getByLabel(b.files, { exact: true }).setInputFiles([
    { name: "pause-a.wav", mimeType: "audio/wav", buffer: toneWav(110000) },
    { name: "pause-b.wav", mimeType: "audio/wav", buffer: toneWav(1200) },
  ]);
  await batchRegion
    .getByRole("checkbox", { name: b.permission, exact: true })
    .check();
  await batchRegion
    .getByRole("button", { name: b.create, exact: true })
    .click();
  await batchRegion
    .getByText(b.done, { exact: true })
    .waitFor({ timeout: 60000 });
  assert.equal(partRequests.length, 1);
  const pausedBatch = await batchRegion
    .getByLabel(b.saved, { exact: true })
    .inputValue();
  let pausedItems = (await c.owner(recordingRoot)).recordings.filter(
    (r: any) => r.batchId === pausedBatch,
  );
  assert.ok(pausedItems.every((r: any) => r.status === "awaiting_upload"));
  assert.equal(
    pausedItems.find((r: any) => r.uploadProgress)?.uploadProgress.completed,
    1,
  );
  await batchRegion
    .getByRole("button", { name: b.resume, exact: true })
    .click();
  await batchRegion
    .getByText("MARKED_REFRESH_FAILURE", { exact: true })
    .waitFor({ timeout: 60000 });
  pausedItems = (await c.owner(recordingRoot)).recordings.filter(
    (r: any) => r.batchId === pausedBatch,
  );
  assert.ok(pausedItems.every((r: any) => r.status === "uploaded"));
  assert.equal(partRequests.length, 3);
  assert.equal(new Set(partRequests).size, 3);
  refreshFailure = false;
  await batchRegion
    .getByRole("button", { name: b.refresh, exact: true })
    .click();
  assert.deepEqual(errors, []);
  console.log(
    "EN/ES/FR mobile batch intake, isolated upload/provider failures, no automatic retry, refresh recovery, individual review/import and overflow checks passed.",
  );
} finally {
  await browser?.close();
  await stop();
}
