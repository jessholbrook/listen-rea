import { chromium, type Browser, type Page } from "playwright";
import assert from "node:assert/strict";
import { mkdirSync, readFileSync } from "node:fs";
import { start, stop, base } from "./harness";
import {
  mediaStudy,
  reviewedEdition,
  syntheticClipAnswer,
} from "./media-expansion-fixture";
import { staticDeck } from "./presentation-import-fixture";
import { pptxMime } from "../src/lib/participant-pptx";
import JSZip from "jszip";
let browser: Browser | undefined, page: Page | undefined;
try {
  await start({ port: 3441 });
  const c = await mediaStudy(),
    other = await mediaStudy(c, "Synthetic source Beta"),
    edition = await reviewedEdition(c);
  browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_PATH || "/usr/bin/chromium",
    headless: true,
    args: ["--no-sandbox"],
  });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1050 },
  });
  page = await context.newPage();
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const login = await context.request.post(base + "/api/auth/login", {
    data: { email: c.email, password: "saved-library-password" },
  });
  assert.equal(login.status(), 200);
  const { dispatchClipSuggestions } =
    await import("../src/lib/clip-suggestions-server");
  // Only paid providers are marked fixtures. Decoding, authorization, persistence and acceptance are real.
  await page.route("**/api/studies/*/clip-suggestions", async (route) => {
    if (route.request().method() !== "POST") return route.continue();
    try {
      const response = await dispatchClipSuggestions(
        new Request(route.request().url(), {
          method: "POST",
          body: route.request().postData(),
        }),
        ["studies", c.s.id, "clip-suggestions"],
        {
          ready: () => true,
          model: () => "marked-browser-provider",
          align: async () =>
            syntheticClipAnswer
              .split(" ")
              .map((word, n) => ({ word, start: n * 0.2, end: (n + 1) * 0.2 })),
          propose: async () => ({
            suggestions: [
              {
                quote: syntheticClipAnswer,
                caption: "Evidence check",
                rationale: "Marked synthetic source-checking example.",
              },
            ],
          }),
        },
        c.actor,
      );
      await route.fulfill({
        status: response!.status,
        contentType: "application/json",
        body: await response!.text(),
      });
    } catch (e) {
      await route.fulfill({
        status: Number((e as any).status) || 500,
        contentType: "application/json",
        body: JSON.stringify({ error: (e as Error).message }),
      });
    }
  });
  await page.goto(base + `/?study=${c.s.id}&tab=reporting`);
  await page
    .getByRole("heading", { name: "Reports & media", exact: true })
    .waitFor();
  await page.getByRole("button", { name: "AI clips", exact: true }).click();
  const generate = page.getByRole("button", {
    name: "Suggest evidence clips",
    exact: true,
  });
  assert.equal(await generate.isDisabled(), true);
  await page.getByLabel(/I allow OpenAI to receive this recording/).check();
  await generate.click();
  await page
    .getByLabel("Suggested clip name", { exact: true })
    .fill("Browser reviewed suggestion");
  await page
    .getByLabel("Suggested caption", { exact: true })
    .fill("Edited browser caption");
  assert.equal(
    await page
      .getByLabel("Suggested exact quote", { exact: true })
      .inputValue(),
    syntheticClipAnswer,
  );
  await page
    .getByRole("button", { name: "Preview suggested range", exact: true })
    .click();
  await page.waitForFunction(
    () => (document.querySelector("audio")?.currentTime || 0) > 0,
  );
  await page
    .getByLabel(/I listened to this range, checked the exact quote/)
    .check();
  await page
    .getByRole("button", { name: "Save reviewed suggested clip", exact: true })
    .click();
  await page
    .getByText("Reviewed clip saved. It is available in Clips & reels.", {
      exact: true,
    })
    .waitFor();
  const saved = (await c.owner(c.root)).clips.find(
    (v: any) => v.name === "Browser reviewed suggestion",
  );
  assert.ok(saved?.aiProvenance.edited);
  await page
    .getByRole("button", { name: "Clips & reels", exact: true })
    .click();
  await page
    .getByLabel("Include reviewed clips from other studies in this workspace", {
      exact: true,
    })
    .check();
  await page
    .getByLabel("Reel name", { exact: true })
    .fill("Browser cross-study reel");
  await page
    .getByLabel("Add reviewed clip", { exact: true })
    .selectOption(c.clip.id);
  await page
    .getByLabel("Add reviewed clip", { exact: true })
    .selectOption(other.clip.id);
  await page
    .getByLabel("I reviewed this reel’s clip selection, order and context.")
    .check();
  await page.getByRole("button", { name: "Save reel", exact: true }).click();
  await page.getByText("Reel saved.", { exact: true }).waitFor();
  const reel = (await c.owner(c.root)).reels.find(
    (v: any) => v.name === "Browser cross-study reel",
  );
  assert.equal(reel.crossStudy, true);
  assert.deepEqual(reel.clipIds, [c.clip.id, other.clip.id]);
  await page
    .getByRole("button", { name: "Create render job", exact: true })
    .click();
  await page.getByRole("button", { name: "Render now", exact: true }).click();
  await page
    .getByText("Render completed.", { exact: true })
    .waitFor({ timeout: 60000 });
  const sourceDownload = page.waitForEvent("download");
  await page.getByRole("link", { name: /source manifest/i }).click();
  const manifest = JSON.parse(
    readFileSync((await (await sourceDownload).path())!, "utf8"),
  );
  assert.equal(manifest.clips.length, 2);
  await page
    .getByRole("button", { name: "Import slides", exact: true })
    .click();
  const original = await staticDeck();
  await page.getByLabel("PowerPoint to import", { exact: true }).setInputFiles({
    name: "Original context.pptx",
    mimeType: pptxMime,
    buffer: original,
  });
  assert.equal(
    await page
      .getByRole("button", { name: "Import PowerPoint", exact: true })
      .isDisabled(),
    true,
  );
  await page
    .getByLabel(/I have permission to use these original slides/)
    .check();
  await page
    .getByRole("button", { name: "Import PowerPoint", exact: true })
    .click();
  await page.getByText("Original needs review", { exact: true }).waitFor();
  const originalDownload = page.waitForEvent("download");
  await page
    .getByRole("link", { name: "Download original presentation", exact: true })
    .click();
  assert.deepEqual(
    readFileSync((await (await originalDownload).path())!),
    original,
  );
  const review = page.getByLabel(
    "I reviewed the original slides and the content I am about to export.",
    { exact: true },
  );
  await review.check();
  await page
    .getByRole("button", { name: "Mark imported slides reviewed", exact: true })
    .click();
  await page.getByText("Original reviewed", { exact: true }).waitFor();
  await page
    .getByLabel("Reviewed report to append", { exact: true })
    .selectOption(edition.id);
  const exportButton = page.getByRole("button", {
    name: "Export imported slides with report",
    exact: true,
  });
  assert.equal(await exportButton.isDisabled(), true);
  await review.check();
  const reportDownload = page.waitForEvent("download");
  await exportButton.click();
  const composed = await JSZip.loadAsync(
      readFileSync((await (await reportDownload).path())!),
    ),
    source = await JSZip.loadAsync(original);
  assert.equal(
    await composed.file("ppt/slides/slide1.xml")!.async("string"),
    await source.file("ppt/slides/slide1.xml")!.async("string"),
  );
  const xml = (
    await Promise.all(
      Object.values(composed.files)
        .filter((f) => /\.xml$/.test(f.name))
        .map((f) => f.async("string")),
    )
  ).join("\n");
  assert.ok(xml.includes(syntheticClipAnswer));
  mkdirSync("test-results", { recursive: true });
  await page.screenshot({
    path: "test-results/media-expansion-desktop.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({
    path: "test-results/media-expansion-mobile.png",
    fullPage: true,
  });
  assert.ok(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  );
  assert.deepEqual(errors, []);
  console.log(
    "Media expansion browser passed: consent, real decoding with marked AI providers, playback, edited suggestion acceptance, cross-study MP4/source manifest, private static PPTX import/review/composition, and mobile layout.",
  );
} catch (e) {
  mkdirSync("test-results", { recursive: true });
  await page?.screenshot({
    path: "test-results/media-expansion-failure.png",
    fullPage: true,
  });
  console.error((await page?.locator("body").innerText())?.slice(-5000));
  console.error(e);
  process.exitCode = 1;
} finally {
  await browser?.close();
  await stop();
}
