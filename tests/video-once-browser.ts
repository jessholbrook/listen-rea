import { chromium, type Browser } from "playwright";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { start, stop, base } from "./harness";
import { onceGuide } from "./video-once-fixture";
import { fixtureVideo } from "./concept-videos-fixture";
import { translatedFields } from "./localization-fixture";
import { copy } from "../src/lib/participant-copy";
import { videoOnceCopy } from "../src/lib/video-once";
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
    name: "Single-view browser",
    email: "video-once-browser@example.test",
    password: "video-once-password",
  });
  let s = (await call("studies", "POST", { title: "Single-view concepts" }))
    .study;
  const root = "studies/" + s.id,
    ids = [randomUUID(), randomUUID()];
  for (const id of ids)
    assert.equal(
      (
        await team.request.post(base + "/api/" + root + "/concept-videos", {
          data: await fixtureVideo("mp4", 2),
          headers: { "content-type": "video/mp4", "x-upload-id": id },
        })
      ).status(),
      201,
    );
  s = (await call(root, "PUT", { version: s.version, guide: onceGuide(ids) }))
    .study;
  await page.goto(base + "/?study=" + s.id + "&tab=guide");
  const mode = page
    .locator(".concept-config")
    .first()
    .getByLabel("Presentation mode", { exact: true });
  await mode.selectOption("self");
  await mode.selectOption("once");
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
    p.on("pageerror", (e) => errors.push(e.message));
    const w = videoOnceCopy(language);
    await p.goto(base + "/s/" + s.id + "?language=" + language);
    await p.getByRole("checkbox").check();
    await p
      .getByRole("button", { name: copy(language, "Let’s begin"), exact: true })
      .click();
    await p
      .getByRole("radio", {
        name: (language === "en" ? "" : language.toUpperCase() + " ") + "Ready",
        exact: true,
      })
      .check();
    await p
      .getByRole("button", { name: copy(language, "Continue"), exact: true })
      .click();
    await p.getByRole("button", { name: w.start, exact: true }).waitFor();
    assert.equal(
      await p.getByRole("radio", { name: "4", exact: true }).count(),
      0,
    );
    if (language === "en") {
      let lost = false;
      await p.route("**/api/interviews/*/video-presentation", async (route) => {
        if (
          route.request().method() === "POST" &&
          route.request().postDataJSON().action === "start" &&
          !lost
        ) {
          lost = true;
          await route.fetch();
          await route.abort("failed");
        } else await route.continue();
      });
      await p.getByRole("button", { name: w.start, exact: true }).click();
      await p.getByRole("alert").waitFor();
      await p.getByRole("button", { name: w.retry, exact: true }).click();
    } else await p.getByRole("button", { name: w.start, exact: true }).click();
    await p.locator(".single-view-player video").waitFor();
    assert.equal(
      await p.locator(".single-view-player video").getAttribute("controls"),
      null,
    );
    if (language === "en") {
      await p.getByRole("button", { name: w.play, exact: true }).click();
      await p.getByRole("button", { name: w.pause, exact: true }).click();
      assert.ok(
        await p.locator("body").evaluate((el) => el.scrollWidth <= innerWidth),
      );
      mkdirSync("test-results", { recursive: true });
      await p.screenshot({
        path: "test-results/video-once-mobile.png",
        fullPage: true,
      });
      await p.getByRole("button", { name: w.play, exact: true }).click();
      await p.getByText(w.used, { exact: true }).waitFor();
      assert.equal(await p.locator(".single-view-player video").count(), 0);
      await p.getByRole("radio", { name: "4", exact: true }).check();
      await p
        .getByRole("button", { name: copy(language, "Continue"), exact: true })
        .click();
      await p
        .getByRole("heading", {
          name: "How confident is your rating?",
          exact: true,
        })
        .waitFor();
      assert.equal(
        await p.getByRole("button", { name: w.start, exact: true }).count(),
        0,
      );
    } else if (language === "es") {
      await p.reload();
      await p.getByText(w.interrupted, { exact: true }).waitFor();
      assert.equal(await p.locator("video").count(), 0);
      await p.getByRole("button", { name: w.skip, exact: true }).click();
      await p.getByRole("radio", { name: "4", exact: true }).check();
      await p
        .getByRole("button", { name: copy(language, "Continue"), exact: true })
        .click();
      await p
        .getByRole("heading", {
          name: "ES How confident is your rating?",
          exact: true,
        })
        .waitFor();
      assert.equal(
        await p.getByRole("button", { name: w.start, exact: true }).count(),
        0,
      );
    } else {
      await p.getByRole("button", { name: w.switch, exact: true }).click();
      await p.getByText(w.alternative, { exact: true }).waitFor();
      await p.locator("video[controls]").waitFor();
      await p.reload();
      await p.getByText(w.alternative, { exact: true }).waitFor();
      await p.getByRole("radio", { name: "4", exact: true }).waitFor();
    }
    await pc.close();
  }
  await page.goto(base + "/?study=" + s.id + "&tab=responses");
  await page
    .getByRole("button", { name: /Participant / })
    .first()
    .click();
  await page
    .getByRole("heading", { name: "Video viewing", exact: true })
    .waitFor();
  await page.getByText(/Participant chose replayable viewing/).waitFor();
  assert.deepEqual(errors, []);
  console.log(
    "One-time video browser passed: editor, recoverable lost-start reply, explicit play/pause, natural end, repeated questions, reload denial/skip, persistent replayable alternative, researcher audit, EN/ES/FR and dark/mobile layout.",
  );
} finally {
  await browser?.close();
  await stop();
}
