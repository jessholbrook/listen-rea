import { chromium, type Browser } from "playwright";
import assert from "node:assert/strict";
import sharp from "sharp";
import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { start, stop, base } from "./harness";
import { videoGuide, fixtureVideo } from "./concept-videos-fixture";
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
    name: "Watermark browser",
    email: "watermark-browser@example.test",
    password: "watermark-password",
  });
  let s = (await call("studies", "POST", { title: "Marked concepts" })).study;
  const root = "studies/" + s.id,
    imageId = randomUUID(),
    videoId = randomUUID();
  const image = await sharp(
    Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg" width="800" height="450"><rect width="800" height="450" fill="#dbe7da"/><rect x="100" y="50" width="230" height="350" rx="18" fill="#447a58"/><circle cx="520" cy="225" r="100" fill="#c2a655"/></svg>',
    ),
  )
    .png()
    .toBuffer();
  for (const [kind, id, data, mime] of [
    ["images", imageId, image, "image/png"],
    ["videos", videoId, await fixtureVideo(), "video/mp4"],
  ] as const) {
    assert.equal(
      (
        await team.request.post(base + "/api/" + root + "/concept-" + kind, {
          data,
          headers: { "content-type": mime, "x-upload-id": id },
        })
      ).status(),
      201,
    );
  }
  const guide = videoGuide([videoId]);
  guide.conceptTest!.concepts[0].imageAssetId = imageId;
  s = (await call(root, "PUT", { version: s.version, guide })).study;
  await page.goto(base + "/?study=" + s.id + "&tab=guide");
  const concept = page.locator(".concept-config").first(),
    imageToggle = concept.getByRole("checkbox", {
      name: "Watermark this image",
      exact: true,
    }),
    videoToggle = concept.getByRole("checkbox", {
      name: "Watermark this video",
      exact: true,
    });
  const toggleMark = async (kind: "image" | "video", enabled: boolean) => {
    await page.waitForFunction((kind) => {
      const input = document.querySelector<HTMLInputElement>(
        'input[aria-label="Watermark this ' + kind + '"]',
      );
      return input && !input.disabled;
    }, kind);
    const checkbox = kind === "image" ? imageToggle : videoToggle;
    if ((await checkbox.isChecked()) !== enabled) {
      const response = page.waitForResponse(
        (r) =>
          r.url().endsWith("/watermark") && r.request().method() === "POST",
      );
      await checkbox.setChecked(enabled);
      assert.ok((await response).ok());
    }
    await page.waitForFunction((kind) => {
      const input = document.querySelector<HTMLInputElement>(
        'input[aria-label="Watermark this ' + kind + '"]',
      );
      return input && !input.disabled;
    }, kind);
  };
  await toggleMark("image", true);
  await toggleMark("video", true);
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  await page.getByText("Draft saved", { exact: true }).waitFor();
  s = (await call(root)).study;
  const markedImage = s.draft.conceptTest.concepts[0].imageAssetId,
    markedVideo = s.draft.conceptTest.concepts[0].videoAssetId;
  assert.notEqual(markedImage, imageId);
  assert.notEqual(markedVideo, videoId);
  await toggleMark("image", false);
  await toggleMark("image", true);
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  await page.getByText("Draft saved", { exact: true }).waitFor();
  assert.equal(
    (await call(root)).study.draft.conceptTest.concepts[0].imageAssetId,
    markedImage,
  );
  s = (await call(root)).study;
  await call(root + "/publish", "POST", { version: s.version });
  await call(root + "/fielding", "POST", { state: "active" });
  await call(root + "/branding", "PUT", {
    ...defaultBranding,
    version: 0,
    enabled: true,
    background: "#101820",
    text: "#ffffff",
  });
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
  const img = p.getByRole("img", { name: "Concept Alpha image", exact: true });
  await img.waitFor();
  await img.evaluate((el: HTMLImageElement) => el.decode());
  await p.locator("video").waitFor();
  await p.locator("video").evaluate(async (v: HTMLVideoElement) => {
    await v.play();
    v.pause();
  });
  assert.ok((await img.getAttribute("src"))!.startsWith("blob:"));
  assert.ok(
    await p.locator("body").evaluate((el) => el.scrollWidth <= innerWidth),
  );
  mkdirSync("test-results", { recursive: true });
  await p.screenshot({
    path: "test-results/watermarked-media-mobile.png",
    fullPage: true,
  });
  await page.reload();
  await toggleMark("image", false);
  await toggleMark("video", false);
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  await page.getByText("Draft saved", { exact: true }).waitFor();
  s = (await call(root)).study;
  await call(root + "/publish", "POST", { version: s.version });
  await p.reload();
  await img.waitFor();
  const session = await p.evaluate(() =>
    JSON.parse(
      localStorage.getItem(
        Object.keys(localStorage).find((k) => k.startsWith("study-session:"))!,
      )!,
    ),
  );
  const stored = await (
    await pc.request.get(base + "/api/interviews/" + session.id, {
      headers: { "x-interview-token": session.token },
    })
  ).json();
  assert.equal(
    stored.interview.guide.conceptTest.concepts[0].imageAssetId,
    markedImage,
  );
  assert.equal(
    stored.interview.guide.conceptTest.concepts[0].videoAssetId,
    markedVideo,
  );
  assert.equal(s.draft.conceptTest.concepts[0].imageAssetId, imageId);
  assert.deepEqual(errors, []);
  console.log(
    "Watermark browser passed: image/video toggles, original restoration and cache reuse, private marked pixels/native playback, frozen publication/resume and dark/mobile layout.",
  );
  await pc.close();
} finally {
  await browser?.close();
  await stop();
}
