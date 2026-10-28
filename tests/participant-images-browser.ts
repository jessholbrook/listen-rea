import { chromium, type Browser } from "playwright";
import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import sharp from "sharp";
import { start, stop, base } from "./harness";
import { participantImageGuide } from "./participant-images-fixture";
import { translatedFields } from "./localization-fixture";
import { copy } from "../src/lib/participant-copy";
let browser: Browser | undefined;
try {
  await start();
  browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_PATH || "/usr/bin/chromium",
    args: ["--no-sandbox"],
  });
  const admin = await browser.newContext(),
    page = await admin.newPage();
  const call = async (path: string, method = "GET", data?: unknown) => {
    const r = await admin.request.fetch(base + "/api/" + path, {
      method,
      data,
    });
    assert.ok(r.ok(), path + ":" + r.status());
    return r.json();
  };
  await call("auth/signup", "POST", {
    name: "Participant image browser",
    email: "participant-image-browser@example.test",
    password: "test-image-browser-password",
  });
  let s = (
    await call("studies", "POST", { title: "Participant image feedback" })
  ).study;
  const root = "studies/" + s.id,
    guide = participantImageGuide();
  guide.questions[0].participantImages = false;
  s = (await call(root, "PUT", { version: s.version, guide })).study;
  await page.goto(base + "/?study=" + s.id + "&tab=guide");
  await page
    .getByLabel("Allow optional participant image attachment", { exact: true })
    .check();
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
  const bytes = await sharp({
    create: { width: 64, height: 48, channels: 3, background: "#398675" },
  })
    .png()
    .toBuffer();
  const errors: string[] = [];
  for (const language of ["en", "es", "fr"] as const) {
    const context = await browser.newContext({
        locale: language,
        viewport: { width: 390, height: 844 },
      }),
      p = await context.newPage();
    p.on("pageerror", (e) => errors.push(e.message));
    const t = (s: string) => copy(language, s);
    await p.goto(base + "/s/" + s.id + "?language=" + language);
    await p
      .getByRole("checkbox", {
        name: t(
          "I agree to take part and have my responses stored and analyzed for this study.",
        ),
        exact: true,
      })
      .check();
    await p.getByRole("button", { name: t("Let’s begin") }).click();
    const box = p.getByRole("region", {
      name: t("Optional image attachment"),
      exact: true,
    });
    await box.waitFor();
    const payload = {
        name: "private-workflow.png",
        mimeType: "image/png",
        buffer: bytes,
      },
      description =
        language === "es"
          ? "Captura del flujo de trabajo"
          : language === "fr"
            ? "Capture du parcours de travail"
            : "A screenshot of the sample workflow";
    const prepare = async () => {
      await box.locator("input[type=file]").setInputFiles(payload);
      await box
        .getByLabel(t("Describe your image"), { exact: true })
        .fill(description);
      const consent = box.getByRole("checkbox", {
        name: t(
          "I agree to share this image with the research team for this study.",
        ),
        exact: true,
      });
      assert.equal(await consent.isChecked(), false);
      assert.equal(
        await box
          .getByRole("button", { name: t("Upload image"), exact: true })
          .isDisabled(),
        true,
      );
      await consent.check();
    };
    await prepare();
    let dropped = false;
    if (language === "en")
      await p.route("**/api/interviews/*/participant-images", async (route) => {
        if (!dropped && route.request().method() === "POST") {
          dropped = true;
          const actual = await route.fetch();
          assert.equal(actual.status(), 201);
          await route.abort("failed");
        } else await route.continue();
      });
    await box
      .getByRole("button", { name: t("Upload image"), exact: true })
      .click();
    if (language === "en") {
      await box.getByRole("alert").waitFor();
      await box
        .getByRole("button", { name: t("Upload image"), exact: true })
        .click();
    }
    await box
      .getByRole("button", { name: t("Remove attached image"), exact: true })
      .waitFor();
    await box.getByAltText(description, { exact: true }).first().waitFor();
    await p.reload();
    await box
      .getByRole("button", { name: t("Remove attached image"), exact: true })
      .waitFor();
    if (language === "en") {
      await box
        .getByRole("button", { name: t("Remove attached image"), exact: true })
        .click();
      await box
        .getByRole("button", { name: t("Upload image"), exact: true })
        .waitFor();
      await prepare();
      await box
        .getByRole("button", { name: t("Upload image"), exact: true })
        .click();
      await box
        .getByRole("button", { name: t("Remove attached image"), exact: true })
        .waitFor();
    }
    await p
      .getByLabel(t("Your answer"), { exact: true })
      .fill("The example workflow kept the research notes easy to find.");
    await p.getByRole("button", { name: t("Continue"), exact: true }).click();
    await box.waitFor({ state: "hidden" });
    assert.equal(
      await p.evaluate(() => document.documentElement.scrollWidth > innerWidth),
      false,
    );
    await context.close();
  }
  const detail = await call(root);
  assert.equal(detail.interviews.length, 3);
  for (const i of detail.interviews) assert.ok(i.turns[0].participantImage.id);
  const id = detail.interviews[0].turns[0].participantImage.id;
  await page.goto(base + "/?study=" + s.id + "&tab=responses");
  await page
    .getByRole("button", { name: "Participant 1", exact: true })
    .click();
  await page
    .getByText("Participant image attachment", { exact: true })
    .waitFor();
  mkdirSync("test-results", { recursive: true });
  await page.screenshot({
    path: "test-results/participant-images-browser.png",
    fullPage: true,
  });
  page.once("dialog", (d) => d.accept());
  await page
    .getByRole("button", { name: "Delete attached image", exact: true })
    .click();
  await page
    .getByRole("heading", { name: "Response transcript", exact: true })
    .waitFor({ state: "hidden" });
  // Every response has an image; erasure should remove exactly one and preserve text.
  const after = await call(root);
  assert.equal(
    after.interviews.filter((i: any) => i.turns[0].participantImage).length,
    2,
  );
  assert.equal(
    after.interviews.filter((i: any) => i.turns[0].participantImageRemovedAt)
      .length,
    1,
  );
  assert.deepEqual(errors, []);
  console.log(
    "Participant image editor, explicit sharing, mobile EN/ES/FR upload/reload/removal, lost-response retry, answer attachment and researcher deletion passed.",
  );
} finally {
  await browser?.close();
  await stop();
}
