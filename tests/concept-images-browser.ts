import { chromium, type Browser } from "playwright";
import assert from "node:assert/strict";
import sharp from "sharp";
import { mkdirSync } from "node:fs";
import { start, stop, base } from "./harness";
import { imageGuide } from "./concept-images-fixture";
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
    name: "Concept image browser",
    email: "image-browser@example.test",
    password: "concept-image-password",
  });
  let s = (await call("studies", "POST", { title: "Private concept browser" }))
    .study;
  s = (
    await call("studies/" + s.id, "PUT", {
      version: s.version,
      guide: imageGuide(),
    })
  ).study;
  await page.goto(base + "/?study=" + s.id + "&tab=guide");
  const concept = page.locator(".concept-config").first();
  const bytes = await sharp(
    Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg" width="900" height="400"><rect width="900" height="400" fill="#dce9e8"/><rect x="50" y="55" width="240" height="290" rx="18" fill="#385a40"/><text x="330" y="160" font-size="42" fill="#232e28">Concept Alpha</text><text x="330" y="225" font-size="25" fill="#232e28">Fast summaries for your team</text></svg>',
    ),
  )
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
  await concept
    .getByLabel("Upload concept image", { exact: true })
    .setInputFiles({
      name: "concept.png",
      mimeType: "image/png",
      buffer: bytes,
    });
  await concept
    .getByRole("button", { name: "Retry image upload", exact: true })
    .click();
  await concept
    .getByRole("img", { name: "Concept Alpha image", exact: true })
    .waitFor();
  assert.equal(
    (await call("studies/" + s.id + "/concept-images")).images.length,
    1,
  );
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  await page.getByText("Draft saved", { exact: true }).waitFor();
  s = (await call("studies/" + s.id)).study;
  s = (
    await call("studies/" + s.id + "/publish", "POST", { version: s.version })
  ).study;
  const firstId = s.draft.conceptTest.concepts[0].imageAssetId;
  await call("studies/" + s.id + "/fielding", "POST", { state: "active" });
  await page.reload();
  await concept
    .getByRole("img", { name: "Concept Alpha image", exact: true })
    .waitFor();
  await call("studies/" + s.id + "/branding", "PUT", {
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
  assert.equal(
    await p
      .locator(".concept-stimulus")
      .evaluate((el) => getComputedStyle(el).backgroundColor),
    "rgb(16, 24, 32)",
  );
  assert.ok(
    await img.evaluate(
      (el: HTMLImageElement) => el.complete && el.naturalWidth > 0,
    ),
  );
  assert.ok((await img.getAttribute("src"))!.startsWith("blob:"));
  mkdirSync("test-results", { recursive: true });
  await p.screenshot({
    path: "test-results/concept-upload-mobile.png",
    fullPage: true,
  });
  assert.ok(
    await p.locator("body").evaluate((el) => el.scrollWidth <= innerWidth),
  );
  await concept
    .getByRole("button", {
      name: "Remove uploaded image from concept",
      exact: true,
    })
    .click();
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  await page.getByText("Draft saved", { exact: true }).waitFor();
  s = (await call("studies/" + s.id)).study;
  await call("studies/" + s.id + "/publish", "POST", { version: s.version });
  await p.reload();
  await img.waitFor();
  await img.evaluate((el: HTMLImageElement) => el.decode());
  assert.ok(await img.evaluate((el: HTMLImageElement) => el.naturalWidth > 0));
  await page.getByText("Uploaded images (1)", { exact: true }).click();
  await page
    .getByRole("button", { name: "Delete unused image 1", exact: true })
    .click();
  await page.getByRole("alert").filter({ hasText: "retained by" }).waitFor();
  assert.equal(
    (await call("studies/" + s.id + "/concept-images")).images[0].id,
    firstId,
  );
  await concept
    .getByLabel("Upload concept image", { exact: true })
    .setInputFiles({
      name: "concept.png",
      mimeType: "image/png",
      buffer: bytes,
    });
  await concept
    .getByRole("img", { name: "Concept Alpha image", exact: true })
    .waitFor();
  await concept
    .getByRole("button", {
      name: "Remove uploaded image from concept",
      exact: true,
    })
    .click();
  await page.getByText("Uploaded images (2)", { exact: true }).waitFor();
  await page
    .getByRole("button", { name: "Delete unused image 1", exact: true })
    .click();
  await page.getByText("Uploaded images (1)", { exact: true }).waitFor();
  await page
    .locator(".concept-editor")
    .screenshot({ path: "test-results/concept-upload-desktop-controls.png" });
  await page.setViewportSize({ width: 390, height: 844 });
  assert.ok(
    await page
      .locator(".concept-editor")
      .evaluate((el) => el.scrollWidth <= el.clientWidth + 1),
  );
  // The original participant may finish after the public guide stopped using its image.
  await p.getByRole("radio", { name: "4", exact: true }).check();
  await p.getByRole("button", { name: "Continue", exact: true }).click();
  await p.getByRole("heading", { name: "Beta idea", exact: true }).waitFor();
  assert.equal(await p.locator(".private-concept-image").count(), 0);
  assert.deepEqual(errors, []);
  console.log(
    "Concept-image browser passed: lost-upload retry, private editor/participant pixels, save/publish, mobile layout, original-image resume, reference protection and unused-upload deletion.",
  );
} finally {
  await browser?.close();
  await stop();
}
