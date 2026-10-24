import { chromium, type Browser } from "playwright";
import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import sharp from "sharp";
import { start, stop, base } from "./harness";
import { participantImageGuide } from "./participant-images-fixture";
import { translatedFields } from "./localization-fixture";
import { copy } from "../src/lib/participant-copy";
import {
  imageAIPermissionText,
  imageAIPermissionVersion,
} from "../src/lib/participant-image-ai";
let browser: Browser | undefined;
try {
  await start();
  browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_PATH || "/usr/bin/chromium",
    args: ["--no-sandbox"],
  });
  const admin = await browser.newContext(),
    page = await admin.newPage();
  const call = async (p: string, method = "GET", data?: unknown) => {
    const r = await admin.request.fetch(base + "/api/" + p, { method, data });
    assert.ok(r.ok(), p + ":" + r.status());
    return r.json();
  };
  await call("auth/signup", "POST", {
    name: "Image AI browser",
    email: "image-ai-browser@example.test",
    password: "image-ai-browser-password",
  });
  let s = (await call("studies", "POST", { title: "Image AI permissions" }))
    .study;
  const root = "studies/" + s.id;
  s = (
    await call(root, "PUT", {
      version: s.version,
      guide: participantImageGuide(),
    })
  ).study;
  await page.goto(base + "/?study=" + s.id + "&tab=guide");
  const setting = page.getByLabel(
    "Allow optional AI image follow-up (OpenAI)",
    { exact: true },
  );
  assert.equal(await setting.isChecked(), false);
  await setting.check();
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  await page.getByText("Draft saved", { exact: true }).waitFor();
  s = (await call(root)).study;
  assert.equal(s.draft.questions[0].followUps, 1);
  assert.equal(s.draft.questions[0].participantImageAI, true);
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
    create: { width: 64, height: 48, channels: 3, background: "#3377aa" },
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
    const ai = box.getByRole("checkbox", {
      name: t(imageAIPermissionText),
      exact: true,
    });
    assert.equal(await ai.isChecked(), false);
    await box
      .locator("input[type=file]")
      .setInputFiles({
        name: "workflow.png",
        mimeType: "image/png",
        buffer: bytes,
      });
    await box
      .getByLabel(t("Describe your image"), { exact: true })
      .fill("The blue Save draft button");
    await box
      .getByRole("checkbox", {
        name: t(
          "I agree to share this image with the research team for this study.",
        ),
        exact: true,
      })
      .check();
    assert.equal(
      await box
        .getByRole("button", { name: t("Upload image"), exact: true })
        .isEnabled(),
      true,
    );
    if (language !== "es") await ai.check();
    await box
      .getByRole("button", { name: t("Upload image"), exact: true })
      .click();
    const status = t(
      language === "es"
        ? "This image is shared with the research team only; AI image review was not permitted."
        : "AI image review permitted for this upload.",
    );
    await box.getByText(status, { exact: true }).waitFor();
    await p.reload();
    await box.getByText(status, { exact: true }).waitFor();
    await p
      .getByLabel(t("Your answer"), { exact: true })
      .fill("The workflow helped me keep all of my example notes together.");
    await p.getByRole("button", { name: t("Continue"), exact: true }).click();
    await box.waitFor({ state: "hidden" });
    if (language !== "es")
      await p
        .getByText(
          t(
            "No AI image follow-up was available. Your answer and image were saved.",
          ),
          { exact: true },
        )
        .waitFor();
    assert.equal(
      await p.evaluate(() => document.documentElement.scrollWidth > innerWidth),
      false,
    );
    await context.close();
  }
  const detail = await call(root);
  const en = detail.interviews.find((i: any) => i.language === "en"),
    es = detail.interviews.find((i: any) => i.language === "es"),
    fr = detail.interviews.find((i: any) => i.language === "fr");
  for (const i of [en, fr]) {
    assert.equal(
      i.turns[0].participantImage.aiPermission.version,
      imageAIPermissionVersion,
    );
    assert.equal(
      i.turns[0].participantImage.aiPermission.text,
      copy(i.language, imageAIPermissionText),
    );
    assert.equal(i.turns[0].imageProbe.status, "unavailable");
  }
  assert.equal(es.turns[0].imageProbe, undefined);
  assert.equal(es.turns[0].participantImage.aiPermission, undefined);
  await page.goto(base + "/?study=" + s.id + "&tab=responses");
  await page
    .getByRole("button", { name: "Participant 1", exact: true })
    .click();
  await page
    .getByRole("heading", {
      name: "AI image follow-up provenance",
      exact: true,
    })
    .waitFor();
  mkdirSync("test-results", { recursive: true });
  await page.screenshot({
    path: "test-results/participant-image-ai-browser.png",
    fullPage: true,
  });
  assert.deepEqual(errors, []);
  console.log(
    "Image AI editor setting, independent unchecked EN/ES/FR permission, opt-out, saved permission text/version, reload, unavailable-provider continuation and researcher provenance passed.",
  );
} finally {
  await browser?.close();
  await stop();
}
