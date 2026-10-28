import { chromium, type Browser } from "playwright";
import assert from "node:assert/strict";
import sharp from "sharp";
import { mkdirSync } from "node:fs";
import { start, stop, base } from "./harness";
import { optionImageGuide } from "./option-images-fixture";
import { translatedFields } from "./localization-fixture";
import { copy } from "../src/lib/participant-copy";
import { defaultBranding } from "../src/lib/branding";
let browser: Browser | undefined;
try {
  await start();
  browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_PATH || "/usr/bin/chromium",
    args: ["--no-sandbox"],
  });
  const team = await browser.newContext({
      viewport: { width: 1440, height: 1100 },
    }),
    page = await team.newPage(),
    errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const call = async (path: string, method = "GET", data?: unknown) => {
    const r = await team.request.fetch(base + "/api/" + path, { method, data });
    assert.ok(r.ok(), path + ": " + r.status());
    return r.json();
  };
  await call("auth/signup", "POST", {
    name: "Image answer browser",
    email: "answer-image-browser@example.test",
    password: "option-image-password",
  });
  let s = (await call("studies", "POST", { title: "Image answers browser" }))
    .study;
  const root = "studies/" + s.id;
  s = (
    await call(root, "PUT", { version: s.version, guide: optionImageGuide() })
  ).study;
  await page.goto(base + "/?study=" + s.id + "&tab=guide");
  const editor = page.locator(".answer-image-editor").first();
  await editor.locator("summary").click();
  const bytes = await sharp({
    create: { width: 900, height: 400, channels: 3, background: "#28884d" },
  })
    .png()
    .toBuffer();
  let lost = false;
  await page.route("**/api/studies/*/concept-images", async (route) => {
    if (route.request().method() === "POST" && !lost) {
      lost = true;
      await route.fetch();
      await route.abort("failed");
    } else await route.continue();
  });
  await editor
    .getByLabel("Upload answer image", { exact: true })
    .setInputFiles({ name: "green.png", mimeType: "image/png", buffer: bytes });
  await editor
    .getByRole("button", { name: "Retry image upload", exact: true })
    .click();
  await editor.getByRole("img").waitFor();
  await editor
    .getByLabel("Answer image description", { exact: true })
    .fill("Green package with a leaf symbol");
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  await page.getByText("Draft saved", { exact: true }).waitFor();
  s = (await call(root)).study;
  assert.equal((await call(root + "/concept-images")).images.length, 1);
  const originalId = s.draft.questions[0].options[0].imageAssetId;
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
  for (const language of ["en", "es", "fr"] as const) {
    const pc = await browser.newContext({
        viewport: { width: 390, height: 844 },
      }),
      p = await pc.newPage();
    p.on("pageerror", (e) => errors.push(e.message));
    await p.goto(base + "/s/" + s.id + "?language=" + language);
    await p.getByRole("checkbox").check();
    await p
      .getByRole("button", { name: copy(language, "Let’s begin"), exact: true })
      .click();
    const alt =
        (language === "en" ? "" : language.toUpperCase() + " ") +
        "Green package with a leaf symbol",
      img = p.getByRole("img", { name: alt, exact: true });
    await img.waitFor();
    await img.evaluate((el: HTMLImageElement) => el.decode());
    assert.ok((await img.getAttribute("src"))!.startsWith("blob:"));
    await p
      .getByRole("button", {
        name: /View full image|Ver imagen completa|Voir l’image entière/,
      })
      .click();
    await p.getByRole("dialog", { name: alt }).waitFor();
    await p.keyboard.press("Escape");
    assert.equal(await p.getByRole("dialog").count(), 0);
    assert.ok(
      await p.locator("body").evaluate((el) => el.scrollWidth <= innerWidth),
    );
    if (language === "en") {
      mkdirSync("test-results", { recursive: true });
      await p.screenshot({
        path: "test-results/option-images-mobile.png",
        fullPage: true,
      });
      await p
        .getByRole("radio", { name: "Purple design", exact: true })
        .check();
      await p.getByRole("button", { name: "Continue", exact: true }).click();
      await img.waitFor();
      await p
        .getByRole("checkbox", { name: "Green design", exact: true })
        .check();
      await p.reload();
      await img.waitFor();
      await p
        .getByRole("checkbox", { name: "Green design", exact: true })
        .check();
      // Removing a draft image leaves the existing participant's saved image intact.
      s = (await call(root)).study;
      const next = structuredClone(s.draft);
      next.questions[0].options[0].imageAssetId = null;
      s = (await call(root, "PUT", { version: s.version, guide: next })).study;
      await p.reload();
      await img.waitFor();
      const row = (await call(root)).interviews.find((i: any) => !i.preview);
      assert.equal(row.guide.questions[0].options[0].imageAssetId, originalId);
      await p
        .getByRole("checkbox", { name: "Green design", exact: true })
        .check();
      await p.getByRole("button", { name: "Continue", exact: true }).click();
      await p
        .getByRole("heading", { name: "Rank the other design", exact: true })
        .waitFor();
      await img.waitFor();
    }
    await pc.close();
  }
  assert.deepEqual(errors, []);
  console.log(
    "Image-answer browser passed: private upload/retry, required descriptions, single/multiple choices, full-image keyboard dialog, carried images, reload/frozen source, EN/ES/FR and dark/mobile layout.",
  );
} finally {
  await browser?.close();
  await stop();
}
