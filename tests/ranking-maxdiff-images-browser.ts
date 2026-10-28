import { chromium, type Browser } from "playwright";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import sharp from "sharp";
import { mkdirSync, writeFileSync } from "node:fs";
import { start, stop, base } from "./harness";
import { rankingMaxdiffImageGuide } from "./ranking-maxdiff-images-fixture";
import { translatedFields } from "./localization-fixture";
import { copy } from "../src/lib/participant-copy";
import { maxdiffCopy } from "../src/lib/maxdiff";
import { defaultBranding } from "../src/lib/branding";
let browser: Browser | undefined;
let debugPage: any;
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
  debugPage = page;
  page.on("pageerror", (e) => errors.push(e.message));
  const call = async (path: string, method = "GET", data?: unknown) => {
    const r = await team.request.fetch(base + "/api/" + path, { method, data });
    assert.ok(r.ok(), path + ": " + r.status());
    return r.json();
  };
  await call("auth/signup", "POST", {
    name: "Ranking MaxDiff image browser",
    email: "rank-maxdiff-browser@example.test",
    password: "ranking-images-password",
  });
  let s = (await call("studies", "POST", { title: "Package design images" }))
    .study;
  const root = "studies/" + s.id,
    ids: string[] = [];
  const bytes = await sharp({
    create: { width: 800, height: 350, channels: 3, background: "#338855" },
  })
    .png()
    .toBuffer();
  for (let n = 0; n < 4; n++) {
    const id = randomUUID();
    ids.push(id);
    const r = await team.request.post(
      base + "/api/" + root + "/concept-images",
      {
        data: bytes,
        headers: { "content-type": "image/png", "x-upload-id": id },
      },
    );
    assert.equal(r.status(), 201);
  }
  s = (
    await call(root, "PUT", {
      version: s.version,
      guide: rankingMaxdiffImageGuide(ids),
    })
  ).study;
  await page.goto(base + "/?study=" + s.id + "&tab=guide");
  const rankEditor = page.locator(".answer-image-editor").first();
  await rankEditor.locator("summary").click();
  await rankEditor.getByRole("img").waitFor();
  await rankEditor
    .getByLabel("Upload answer image", { exact: true })
    .setInputFiles({ name: "rank.png", mimeType: "image/png", buffer: bytes });
  await rankEditor
    .getByLabel("Answer image description", { exact: true })
    .fill("Green leaf box");
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  await page.getByText("Draft saved", { exact: true }).waitFor();
  await page.locator(".question-list button").nth(1).click();
  const mdEditor = page
    .locator(".maxdiff-item-editor")
    .first()
    .locator(".answer-image-editor");
  await mdEditor.locator("summary").click();
  await mdEditor
    .getByLabel("Upload answer image", { exact: true })
    .setInputFiles({
      name: "maxdiff.png",
      mimeType: "image/png",
      buffer: bytes,
    });
  await mdEditor.getByRole("img").waitFor();
  await mdEditor
    .getByLabel("Answer image description", { exact: true })
    .fill("Green leaf box");
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
  await call(root + "/publish", "POST", { version: s.version });
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
    debugPage = p;
    p.on("pageerror", (e) => errors.push(e.message));
    await p.goto(base + "/s/" + s.id + "?language=" + language);
    await p.getByRole("checkbox").check();
    await p
      .getByRole("button", { name: copy(language, "Let’s begin"), exact: true })
      .click();
    const prefix = language === "en" ? "" : language.toUpperCase() + " ",
      img = p.getByRole("img", {
        name: prefix + "Green leaf box",
        exact: true,
      });
    await img.waitFor();
    await img.evaluate((el: HTMLImageElement) => el.decode());
    await p
      .getByRole("button", {
        name: /View full image|Ver imagen completa|Voir l’image entière/,
      })
      .first()
      .click();
    await p.getByRole("dialog").waitFor();
    await p.keyboard.press("Escape");
    assert.equal(await p.getByRole("dialog").count(), 0);
    for (const label of ["Green package", "Purple package"]) {
      await p
        .getByRole("button", {
          name: copy(language, "Add the next item") + ": " + prefix + label,
          exact: true,
        })
        .click();
    }
    await p
      .getByRole("button", {
        name: copy(language, "Move ") + "1" + copy(language, " down"),
        exact: true,
      })
      .click();
    assert.match(
      await p.locator(".ranking-list li").first().innerText(),
      /Purple package/,
    );
    await p.locator(".mixed-input select").selectOption("2");
    await p.locator(".mixed-input select").selectOption("3");
    assert.ok(
      await p.locator("body").evaluate((el) => el.scrollWidth <= innerWidth),
    );
    if (language === "en") {
      mkdirSync("test-results", { recursive: true });
      await p.screenshot({
        path: "test-results/ranking-images-mobile.png",
        fullPage: true,
      });
    }
    await p
      .getByRole("button", { name: copy(language, "Continue"), exact: true })
      .click();
    await p.locator(".maxdiff-item img").first().waitFor();
    const initialLabels = await p
      .locator(".maxdiff-item > p")
      .allTextContents();
    await p.reload();
    await p.locator(".maxdiff-item img").first().waitFor();
    assert.deepEqual(
      await p.locator(".maxdiff-item > p").allTextContents(),
      initialLabels,
    );
    const words = maxdiffCopy(language);
    for (let task = 0; task < 4; task++) {
      await p.locator(".maxdiff-item img").first().waitFor();
      assert.equal(await p.locator(".maxdiff-item").count(), 3);
      await p
        .getByRole("radio", { name: new RegExp("^" + words.best + ":") })
        .nth(0)
        .check();
      await p
        .getByRole("radio", { name: new RegExp("^" + words.worst + ":") })
        .nth(1)
        .check();
      if (task === 0 && language === "en")
        await p.screenshot({
          path: "test-results/maxdiff-images-mobile.png",
          fullPage: true,
        });
      const nextResponse = p.waitForResponse(
        (response) =>
          response.url().includes("/answer") &&
          response.request().method() === "POST",
      );
      await p
        .getByRole("button", { name: copy(language, "Continue"), exact: true })
        .click();
      const nextInterview = (await (await nextResponse).json()).interview;
      await p
        .getByRole("heading", { name: nextInterview.prompt, exact: true })
        .waitFor();
    }
    await p
      .getByRole("heading", { name: prefix + "Thank you.", exact: true })
      .waitFor();
    assert.equal(await p.locator(".answer-option img").count(), 0);
    await pc.close();
  }
  assert.deepEqual(errors, []);
  console.log(
    "Ranking/MaxDiff image browser passed: researcher uploads, ranked image cards/add/reorder, saved task resume, full-size keyboard viewing, all MaxDiff tasks, EN/ES/FR and dark/mobile layout.",
  );
} catch (error) {
  if (debugPage) {
    await debugPage.screenshot({
      path: "/tmp/rank-browser-debug.png",
      fullPage: true,
    });
    writeFileSync(
      "/tmp/rank-browser-debug.txt",
      await debugPage.locator("body").innerText(),
    );
  }
  throw error;
} finally {
  await browser?.close();
  await stop();
}
