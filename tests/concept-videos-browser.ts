import { chromium, type Browser } from "playwright";
import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { start, stop, base } from "./harness";
import { videoGuide, fixtureVideo } from "./concept-videos-fixture";
import { defaultBranding } from "../src/lib/branding";
import { translatedFields } from "./localization-fixture";
import { copy } from "../src/lib/participant-copy";
let browser: Browser | undefined;
try {
  await start();
  browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_PATH || "/usr/bin/chromium",
    args: ["--no-sandbox"],
  });
  const admin = await browser.newContext({
      viewport: { width: 1440, height: 1100 },
    }),
    page = await admin.newPage(),
    errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const call = async (path: string, method = "GET", data?: unknown) => {
    const r = await admin.request.fetch(base + "/api/" + path, {
      method,
      data,
    });
    assert.ok(r.ok(), path + ": " + r.status());
    return r.json();
  };
  await call("auth/signup", "POST", {
    name: "Concept video browser",
    email: "video-browser@example.test",
    password: "concept-video-password",
  });
  let s = (await call("studies", "POST", { title: "Private video concepts" }))
    .study;
  const root = "studies/" + s.id;
  s = (await call(root, "PUT", { version: s.version, guide: videoGuide() }))
    .study;
  await page.goto(base + "/?study=" + s.id + "&tab=guide");
  const concept = page.locator(".concept-config").first(),
    bytes = await fixtureVideo("mp4");
  let lost = false;
  await page.route("**/api/studies/*/concept-videos", async (route) => {
    if (route.request().method() === "POST" && !lost) {
      lost = true;
      await route.fetch();
      await route.abort("failed");
    } else await route.continue();
  });
  await concept
    .getByLabel("Upload concept video", { exact: true })
    .setInputFiles({
      name: "concept.mp4",
      mimeType: "video/mp4",
      buffer: bytes,
    });
  await concept
    .getByRole("button", { name: "Retry video upload", exact: true })
    .click();
  const preview = concept.locator("video");
  await preview.waitFor();
  await preview.evaluate((el: HTMLVideoElement) =>
    el.readyState >= 1
      ? Promise.resolve()
      : new Promise<void>((resolve) =>
          el.addEventListener("loadedmetadata", () => resolve(), {
            once: true,
          }),
        ),
  );
  assert.equal((await call(root + "/concept-videos")).videos.length, 1);
  await concept
    .getByLabel("Video text alternative (speech and important visuals)", {
      exact: true,
    })
    .fill("A red screen shows the concept. A short tone plays. No speech.");
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  await page.getByText("Draft saved", { exact: true }).waitFor();
  s = (await call(root)).study;
  for (const language of ["es", "fr"] as const) {
    const meta = await call(root + "/localization");
    s = (
      await call(root + "/localization/guide/" + language, "PUT", {
        version: s.version,
        sourceFingerprint: meta.sourceFingerprint,
        fields: translatedFields(s.draft, language),
        reviewed: true,
      })
    ).study;
  }
  s = (await call(root + "/publish", "POST", { version: s.version })).study;
  await call(root + "/fielding", "POST", { state: "active" });
  await call(root + "/branding", "PUT", {
    ...defaultBranding,
    version: 0,
    enabled: true,
    background: "#101820",
    text: "#ffffff",
  });
  await page.reload();
  const pc = await browser.newContext({
      viewport: { width: 390, height: 844 },
    }),
    p = await pc.newPage();
  p.on("pageerror", (e) => errors.push(e.message));
  await p.goto(base + "/s/" + s.id);
  await p.getByRole("checkbox").check();
  await p.getByRole("button", { name: "Let’s begin", exact: true }).click();
  await p.getByRole("radio", { name: "Ready", exact: true }).check();
  await p.getByRole("button", { name: "Continue", exact: true }).click();
  const video = p.locator(".concept-video-stimulus video");
  await video.waitFor();
  await video.evaluate((el: HTMLVideoElement) =>
    el.readyState >= 1
      ? Promise.resolve()
      : new Promise<void>((resolve) =>
          el.addEventListener("loadedmetadata", () => resolve(), {
            once: true,
          }),
        ),
  );
  assert.ok(
    await video.evaluate(
      (el: HTMLVideoElement) =>
        el.controls &&
        el.paused &&
        !el.autoplay &&
        el.playsInline &&
        el.videoWidth > 0,
    ),
  );
  assert.ok((await video.getAttribute("src"))!.startsWith("blob:"));
  await video.evaluate((el: HTMLVideoElement) => {
    el.muted = true;
    return el.play();
  });
  await p.waitForFunction(
    () =>
      document.querySelector<HTMLVideoElement>(".concept-video-stimulus video")!
        .currentTime > 0.2,
  );
  await video.evaluate((el: HTMLVideoElement) => {
    el.pause();
    el.currentTime = 0.5;
  });
  await p.getByText("Video text alternative", { exact: true }).click();
  await p
    .getByText(
      "A red screen shows the concept. A short tone plays. No speech.",
      { exact: true },
    )
    .waitFor();
  mkdirSync("test-results", { recursive: true });
  await p.screenshot({
    path: "test-results/concept-video-mobile.png",
    fullPage: true,
  });
  assert.ok(
    await p.locator("body").evaluate((el) => el.scrollWidth <= innerWidth),
  );
  for (const language of ["es", "fr"] as const) {
    const lc = await browser.newContext(),
      lp = await lc.newPage();
    await lp.goto(base + "/s/" + s.id);
    await lp.locator("select").first().selectOption(language);
    await lp.getByRole("checkbox").check();
    await lp
      .getByRole("button", { name: copy(language, "Let’s begin"), exact: true })
      .click();
    await lp
      .getByRole("radio", {
        name: (language === "es" ? "ES " : "FR ") + "Ready",
        exact: true,
      })
      .check();
    await lp
      .getByRole("button", { name: copy(language, "Continue"), exact: true })
      .click();
    await lp
      .getByText(
        language === "es"
          ? "Alternativa textual del vídeo"
          : "Alternative textuelle de la vidéo",
        { exact: true },
      )
      .click();
    await lp
      .getByText(
        (language === "es" ? "ES " : "FR ") +
          "A red screen shows the concept. A short tone plays. No speech.",
        { exact: true },
      )
      .waitFor();
    await lc.close();
  }
  await concept
    .getByRole("button", {
      name: "Remove uploaded video from concept",
      exact: true,
    })
    .click();
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  await page.getByText("Draft saved", { exact: true }).waitFor();
  s = (await call(root)).study;
  await call(root + "/publish", "POST", { version: s.version });
  await p.reload();
  await video.waitFor();
  await p.getByText("Video text alternative", { exact: true }).click();
  await p
    .getByText(
      "A red screen shows the concept. A short tone plays. No speech.",
      { exact: true },
    )
    .waitFor();
  await page.getByText("Uploaded videos (1)", { exact: true }).click();
  await page
    .getByRole("button", { name: "Delete unused video 1", exact: true })
    .click();
  await page.getByRole("alert").filter({ hasText: "retained by" }).waitFor();
  await concept
    .getByLabel("Upload concept video", { exact: true })
    .setInputFiles({
      name: "unused.mp4",
      mimeType: "video/mp4",
      buffer: bytes,
    });
  await preview.waitFor();
  await concept
    .getByRole("button", {
      name: "Remove uploaded video from concept",
      exact: true,
    })
    .click();
  await page.getByText("Uploaded videos (2)", { exact: true }).waitFor();
  await page
    .getByRole("button", { name: "Delete unused video 1", exact: true })
    .click();
  await page.getByText("Uploaded videos (1)", { exact: true }).waitFor();
  await page
    .locator(".concept-editor")
    .screenshot({ path: "test-results/concept-video-desktop-controls.png" });
  const old = await video.elementHandle();
  await p.getByRole("radio", { name: "4", exact: true }).check();
  await p.getByRole("button", { name: "Continue", exact: true }).click();
  await p.getByRole("heading", { name: "Beta idea", exact: true }).waitFor();
  assert.equal(await p.locator(".concept-video-stimulus video").count(), 0);
  assert.ok(
    await old!.evaluate((el: HTMLVideoElement) => !el.isConnected && el.paused),
  );
  assert.deepEqual(errors, []);
  console.log(
    "Concept-video browser passed: lost-upload retry, private native playback/seeking, no autoplay, text alternatives in EN/ES/FR, mobile/dark layout, frozen resume, protected/unused deletion and playback stop on progression.",
  );
} finally {
  await browser?.close();
  await stop();
}
