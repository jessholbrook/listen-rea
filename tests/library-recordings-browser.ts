import { chromium, type Browser } from "playwright";
import assert from "node:assert/strict";
import { start, stop, base } from "./harness";
import {
  recordingSetup,
  recordingRoot,
  recordingVideo,
} from "./library-recordings-fixture";
import { recordingLabels } from "../src/lib/library-recordings";
import { toneWav } from "./reporting-fixture";
import { sectionLabels } from "../src/lib/recording-sections";
let browser: Browser | undefined;
try {
  await start({ port: 3360 });
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
  page.on("dialog", (d) => d.accept());
  assert.ok(
    (
      await context.request.post(base + "/api/auth/login", {
        data: { email: c.email, password: "saved-library-password" },
      })
    ).ok(),
  );
  await page.route("**/api/library/recordings/*/transcribe", async (route) => {
    const id = route.request().url().split("/").at(-2)!,
      r = (await c.owner(recordingRoot + "/" + id)).recording;
    const updated = await c.transcribe(r);
    await route.fulfill({ json: { recording: updated } });
  });
  let interrupted = false;
  await page.route("**/api/library/recordings/*/part", async (route) => {
    if (!interrupted && route.request().headers()["x-recording-part"] === "1") {
      interrupted = true;
      await route.fulfill({
        status: 503,
        json: { error: "MARKED_UPLOAD_INTERRUPTION" },
      });
    } else await route.continue();
  });
  await page.goto(base);
  await page
    .getByRole("button", { name: "Research library", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Recording transcription", exact: true })
    .click();
  let previous = "en" as "en" | "es" | "fr";
  for (const [n, language] of (["en", "es", "fr"] as const).entries()) {
    const l = recordingLabels[language];
    await page
      .getByLabel(recordingLabels[previous].language, { exact: true })
      .selectOption(language);
    previous = language;
    const region = page.getByRole("region", { name: l.title, exact: true });
    await region
      .getByLabel(l.name, { exact: true })
      .fill("Synthetic reviewed recording " + language);
    await region
      .getByLabel(l.external, { exact: true })
      .fill("recording-" + language);
    await region.getByLabel(l.file, { exact: true }).setInputFiles({
      name: language === "es" ? "source.webm" : "source.wav",
      mimeType: language === "es" ? "video/webm" : "audio/wav",
      buffer:
        language === "es"
          ? recordingVideo()
          : toneWav(language === "en" ? 110000 : 1200),
    });
    await region
      .getByRole("checkbox", { name: l.permission, exact: true })
      .check();
    await region.getByRole("button", { name: l.upload, exact: true }).click();
    const editor = region.getByRole("region", { name: l.source, exact: true });
    await editor.waitFor();
    if (language === "en") {
      await region
        .getByRole("alert")
        .getByText("MARKED_UPLOAD_INTERRUPTION", { exact: true })
        .waitFor();
      await region
        .getByRole("button", { name: l.refresh, exact: true })
        .click();
      await editor.getByLabel(l.resume, { exact: true }).setInputFiles({
        name: "resumed.wav",
        mimeType: "audio/wav",
        buffer: toneWav(110000),
      });
    }
    await editor.locator(language === "es" ? "video" : "audio").waitFor();
    assert.equal((await c.owner("library")).sources.length, n);
    assert.equal(
      await editor.locator(language === "es" ? "video" : "audio").count(),
      1,
    );
    await editor
      .getByRole("button", { name: l.transcribe, exact: true })
      .click();
    await editor.getByRole("textbox", { name: l.text, exact: true }).waitFor();
    assert.equal((await c.owner("library")).sources.length, n);
    assert.equal(
      await editor
        .getByRole("button", { name: l.approve, exact: true })
        .isDisabled(),
      true,
    );
    await editor
      .getByLabel(l.text, { exact: true })
      .fill(
        "Participant: Reviewed draft workflow from recording " + language + ".",
      );
    const sl = sectionLabels[language];
    await editor.getByRole("button", { name: sl.create, exact: true }).click();
    const sectionText = editor.getByLabel(sl.text + " 1", { exact: true });
    await sectionText.evaluate((el: any) => {
      el.focus();
      el.setSelectionRange(13, 13);
      el.dispatchEvent(new Event("select", { bubbles: true }));
    });
    await sectionText.press("ArrowRight");
    await sectionText.press("ArrowLeft");
    await editor.getByRole("button", { name: sl.split, exact: true }).click();
    for (const [n, speaker, start, end] of [
      [1, "Interviewer", 0, 0.3],
      [2, "Participant A " + language, 0.5, 1],
    ] as const) {
      await editor
        .getByLabel(sl.speaker + " " + n, { exact: true })
        .fill(speaker);
      await editor
        .getByLabel(sl.start + " " + n, { exact: true })
        .fill(String(start));
      await editor
        .getByLabel(sl.end + " " + n, { exact: true })
        .fill(String(end));
    }
    await editor
      .getByRole("button", { name: sl.play, exact: true })
      .last()
      .click();
    assert.ok(
      await editor
        .locator(language === "es" ? "video" : "audio")
        .evaluate((el: any) => el.currentTime >= 0.49),
    );
    await editor
      .getByRole("checkbox", { name: l.reviewed, exact: true })
      .check();
    await editor
      .getByLabel(sl.speaker + " 2", { exact: true })
      .fill("Participant A " + language + " revised");
    assert.equal(
      await editor
        .getByRole("checkbox", { name: l.reviewed, exact: true })
        .isChecked(),
      false,
    );
    await editor
      .getByLabel(sl.speaker + " 2", { exact: true })
      .fill("Participant A " + language);
    await editor
      .getByRole("checkbox", { name: l.reviewed, exact: true })
      .check();
    await editor.getByRole("button", { name: l.save, exact: true }).click();
    await editor.getByRole("button", { name: l.approve, exact: true }).click();
    await editor.getByText(l.receipt, { exact: true }).waitFor();
    assert.equal(await editor.getByLabel(l.text, { exact: true }).count(), 0);
    assert.equal((await c.owner("library")).sources.length, n + 1);
    await editor.getByRole("button", { name: l.response, exact: true }).click();
    await page
      .getByRole("dialog")
      .getByText("Reviewed draft workflow from recording " + language + ".", {
        exact: true,
      })
      .waitFor();
    const dialog = page.getByRole("dialog");
    await dialog
      .locator("summary")
      .filter({ hasText: "Participant A " + language })
      .click();
    await dialog.getByRole("button", { name: sl.play, exact: true }).click();
    assert.ok(
      await dialog
        .locator("details audio, details video")
        .evaluate((el: any) => el.currentTime >= 0.49),
    );
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Close dialog", exact: true })
      .click();
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth + 1,
      ),
      false,
    );
  }
  const l = recordingLabels.fr,
    region = page.getByRole("region", { name: l.title, exact: true });
  await region.getByLabel(l.name, { exact: true }).fill("Recording to delete");
  await region.getByLabel(l.external, { exact: true }).fill("delete-me");
  await region.getByLabel(l.file, { exact: true }).setInputFiles({
    name: "delete.wav",
    mimeType: "audio/wav",
    buffer: toneWav(1200),
  });
  await region
    .getByRole("checkbox", { name: l.permission, exact: true })
    .check();
  await region.getByRole("button", { name: l.upload, exact: true }).click();
  const editor = region.getByRole("region", { name: l.source, exact: true });
  await editor.getByRole("button", { name: l.remove, exact: true }).click();
  await editor.waitFor({ state: "detached" });
  assert.equal(
    (await c.owner(recordingRoot)).recordings.filter(
      (r: any) => r.status !== "imported",
    ).length,
    0,
  );
  let release: (() => void) | undefined;
  const created = await c.create({
    externalId: "late-open",
    title: "Late private recording",
  });
  await page.route(
    "**/api/library/recordings/" + created.recording.id,
    async (route) => {
      const response = await route.fetch();
      await new Promise<void>((resolve) => (release = resolve));
      await route.fulfill({ response });
    },
  );
  await region.getByRole("button", { name: l.refresh, exact: true }).click();
  await region
    .locator("[data-recording-id='" + created.recording.id + "']")
    .getByRole("button", { name: l.open, exact: true })
    .click();
  for (let n = 0; n < 100 && !release; n++) await page.waitForTimeout(30);
  assert.ok(release);
  await page.getByRole("button", { name: "Search & ask", exact: true }).click();
  release();
  await page.waitForTimeout(150);
  assert.equal(
    await page.getByRole("region", { name: l.source, exact: true }).count(),
    0,
  );
  assert.deepEqual(errors, []);
  console.log(
    "EN/ES/FR mobile private audio/video upload, explicit transcription, draft-only isolation, immutable original/review, approved speaker-section import, timed private source playback, pending deletion and late-navigation isolation passed (marked transcription fixtures).",
  );
} finally {
  await browser?.close();
  await stop();
}
