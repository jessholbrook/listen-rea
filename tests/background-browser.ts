import { chromium, type Browser } from "playwright";
import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { start, stop, base } from "./harness";
import { recordingSetup } from "./library-recordings-fixture";
import { recordingLabels } from "../src/lib/library-recordings";
import { backgroundLabels } from "../src/lib/background-jobs";
let browser: Browser | undefined;
let debug: import("playwright").Page | undefined;
try {
  await start({ port: 3433 });
  const c = await recordingSetup();
  browser = await chromium.launch({
    executablePath: "/usr/bin/chromium",
    args: ["--no-sandbox"],
  });
  const ctx = await browser.newContext({
      viewport: { width: 390, height: 844 },
    }),
    errors: string[] = [];
  await ctx.request.post(base + "/api/auth/login", {
    data: { email: c.email, password: "saved-library-password" },
  });
  let page = await ctx.newPage();
  debug = page;
  page.on("dialog", (d) => d.accept());
  page.on("pageerror", (e) => errors.push(e.message));
  for (const language of ["en", "es", "fr"] as const) {
    const r = await c.upload(
      (await c.create({ title: "Synthetic background browser " + language }))
        .recording,
    );
    await page.goto(base);
    await page
      .getByRole("button", { name: "Research library", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Recording transcription", exact: true })
      .click();
    if (language !== "en")
      await page
        .getByLabel(recordingLabels.en.language, { exact: true })
        .selectOption(language);
    const l = recordingLabels[language],
      b = backgroundLabels[language],
      region = page.getByRole("region", { name: l.title, exact: true });
    await region
      .getByRole("article")
      .filter({ hasText: r.title })
      .getByRole("button", { name: l.open, exact: true })
      .click();
    const editor = region.getByRole("region", { name: l.source, exact: true }),
      jobs = editor.getByRole("region", { name: b.title, exact: true });
    await jobs.getByRole("combobox").selectOption(r.id);
    assert.equal(
      await jobs
        .getByRole("button", { name: b.start, exact: true })
        .isDisabled(),
      true,
    );
    await jobs
      .getByRole("checkbox", { name: b.permission, exact: true })
      .check();
    await jobs.getByRole("button", { name: b.start, exact: true }).click();
    await jobs.getByRole("button", { name: b.cancel, exact: true }).waitFor();
    const queued = (await c.owner("background-jobs?targetId=" + r.id)).jobs[0];
    assert.equal(queued.state, "queued");
    // Close the participant-independent researcher page before the worker runs.
    await page.close();
    const { runBackgroundMessage } =
      await import("../src/lib/background-worker");
    const stored = await c.local.get<any>(
      "backgroundJob",
      queued.id,
      c.actor.workspaceId,
    );
    await runBackgroundMessage(
      { jobId: stored.id, wake: stored.wake },
      {
        transcribe: async () => ({
          text: "MARKED_BROWSER_TRANSCRIPT: Preserve the original source before sharing.",
          model: "marked-browser-fixture",
          generatedAt: new Date().toISOString(),
        }),
        publish: async () => {},
      },
    );
    page = await ctx.newPage();
    debug = page;
    page.on("dialog", (d) => d.accept());
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto(base);
    await page
      .getByRole("button", { name: "Research library", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Background jobs", exact: true })
      .click();
    await page
      .getByText(/Complete · 1\/1/)
      .first()
      .waitFor();
    assert.equal(
      (await c.owner("background-jobs/" + queued.id)).job.state,
      "complete",
    );
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
      true,
    );
  }
  mkdirSync("test-results", { recursive: true });
  await page.screenshot({
    path: "test-results/background-mobile.png",
    fullPage: true,
  });
  assert.deepEqual(errors, []);
  console.log(
    "EN/ES/FR mobile background consent/start, durable job visibility after page closure, independent worker completion and responsive controls passed. Transcription provider is a marked fixture.",
  );
} catch (e) {
  console.error((await debug?.locator("body").innerText())?.slice(-8000));
  await debug?.screenshot({
    path: "test-results/background-browser-failure.png",
    fullPage: true,
  });
  console.error(e);
  process.exitCode = 1;
} finally {
  await browser?.close();
  await stop();
}
