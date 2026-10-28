import { chromium, type Browser, type Page } from "playwright";
import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { start, stop, base } from "./harness";
import { toneWav } from "./reporting-fixture";
let browser: Browser | undefined, debug: Page | undefined;
try {
  await start();
  browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_PATH || "/usr/bin/chromium",
    headless: true,
    args: ["--no-sandbox"],
  });
  const context = await browser.newContext({
      viewport: { width: 1440, height: 1050 },
    }),
    page = await context.newPage(),
    errors: string[] = [];
  debug = page;
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("dialog", (d) => d.accept());
  await context.request.post(base + "/api/auth/signup", {
    data: {
      name: "Library Browser",
      email: "library-browser@example.test",
      password: "library-browser-password",
    },
  });
  const study = (
    await (
      await context.request.post(base + "/api/studies", {
        data: { title: "Decision evidence" },
      })
    ).json()
  ).study;
  await page.goto(base);
  await page
    .getByRole("button", { name: "Research library", exact: true })
    .click();
  await page
    .getByRole("heading", { name: "Research Library", exact: true })
    .waitFor();
  await page
    .getByRole("button", { name: "Import interviews", exact: true })
    .click();
  await page
    .getByLabel("Transcript and matching media files", { exact: true })
    .setInputFiles([
      {
        name: "alex.txt",
        mimeType: "text/plain",
        buffer: Buffer.from(
          "Participant: We review feedback before each product decision.",
        ),
      },
      { name: "alex.wav", mimeType: "audio/wav", buffer: toneWav(2000) },
      {
        name: "sam.txt",
        mimeType: "text/plain",
        buffer: Buffer.from(
          "Participant: We use support feedback to prioritize decisions.",
        ),
      },
    ]);
  await page
    .getByRole("heading", { name: "Import 2 · pending", exact: true })
    .waitFor();
  await page
    .getByLabel(
      "I have permission to store and analyze these transcripts and recordings.",
      { exact: true },
    )
    .check();
  await page
    .getByLabel(
      "I reviewed every transcript, its speaker labels and its matching recording.",
      { exact: true },
    )
    .check();
  await page
    .getByRole("button", { name: "Import / retry queue", exact: true })
    .click();
  await page
    .getByRole("heading", { name: "Import 2 · complete", exact: true })
    .waitFor();
  const data = await (await context.request.get(base + "/api/library")).json();
  assert.equal(data.sources.length, 2);
  await page
    .getByRole("button", { name: "Participant attributes", exact: true })
    .click();
  await page
    .getByLabel("Attribute CSV", { exact: true })
    .fill("external_id,segment\nalex,Enterprise\nmissing,Small");
  await page
    .getByRole("button", { name: "Preview matches", exact: true })
    .click();
  await page
    .getByText("No matching response in this study.", { exact: true })
    .waitFor();
  assert.equal(
    await page
      .getByRole("button", { name: "Apply attribute changes", exact: true })
      .isEnabled(),
    false,
  );
  await page
    .getByLabel("Attribute CSV", { exact: true })
    .fill("external_id,segment\nalex,Enterprise\nsam,Small");
  await page
    .getByRole("button", { name: "Preview matches", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Apply attribute changes", exact: true })
    .click();
  await page
    .getByRole("status")
    .filter({ hasText: "Updated 2 responses" })
    .waitFor();
  await page.getByRole("button", { name: "Search & ask", exact: true }).click();
  await page.getByLabel("Search evidence", { exact: true }).fill("feedback");
  await page
    .getByRole("button", { name: "Search library", exact: true })
    .click();
  await page.getByText("2 matching source turns.", { exact: true }).waitFor();
  await page.getByLabel("Attribute name", { exact: true }).fill("segment");
  await page
    .getByLabel("Exact attribute value", { exact: true })
    .fill("Enterprise");
  await page
    .getByRole("button", { name: "Search library", exact: true })
    .click();
  await page.getByText("1 matching source turns.", { exact: true }).waitFor();
  await page.getByRole("button", { name: "View source", exact: true }).click();
  const modal = page.getByRole("dialog", { name: "Library source" });
  await modal.waitFor();
  assert.equal(await modal.locator("audio").count(), 1);
  await modal
    .getByText(
      "Participant: We review feedback before each product decision.",
      { exact: true },
    )
    .waitFor();
  await modal
    .getByRole("button", { name: "Close dialog", exact: true })
    .click();
  mkdirSync("test-results", { recursive: true });
  await page.screenshot({
    path: "test-results/library-desktop.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({
    path: "test-results/library-mobile.png",
    fullPage: true,
  });
  assert.ok(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth + 1,
    ),
  );
  await page.getByRole("button", { name: "View source", exact: true }).click();
  await modal
    .getByRole("button", { name: "Delete source", exact: true })
    .click();
  await page
    .getByRole("status")
    .filter({ hasText: "Source and private media deleted" })
    .waitFor();
  await page
    .getByRole("button", { name: "Search library", exact: true })
    .click();
  await page.getByText("0 matching source turns.", { exact: true }).waitFor();
  await page.reload();
  await page
    .getByRole("heading", { name: "Research Library", exact: true })
    .waitFor();
  const state = await (
    await context.request.get(base + `/api/studies/${study.id}`)
  ).json();
  assert.equal(state.interviews.length, 1);
  assert.equal(errors.length, 0, errors.join("\n"));
  console.log(
    "Library browser passed: paired batch import, CSV errors/replacements, filtered search, provenance/private playback, source deletion, reload and mobile layout.",
  );
} catch (e) {
  if (debug) {
    mkdirSync("test-results", { recursive: true });
    await debug
      .screenshot({ path: "test-results/library-failure.png", fullPage: true })
      .catch(() => {});
  }
  throw e;
} finally {
  await browser?.close();
  await stop();
}
