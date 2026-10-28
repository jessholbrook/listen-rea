import { chromium, type Browser } from "playwright";
import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { start, stop, base } from "./harness";
import { prototypeGuide } from "./prototypes-fixture";
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
    name: "Confidentiality browser",
    email: "confidentiality-browser@example.test",
    password: "test-confidentiality-password",
  });
  let s = (
    await call("studies", "POST", { title: "Confidentiality browser study" })
  ).study;
  const root = "studies/" + s.id;
  s = (await call(root, "PUT", { version: s.version, guide: prototypeGuide() }))
    .study;
  await page.goto(base + "/?study=" + s.id + "&tab=guide");
  await page.getByLabel("Require acknowledgement", { exact: true }).check();
  await page
    .getByLabel("Confidentiality title", { exact: true })
    .fill("Private concept review");
  await page
    .getByLabel("Confidentiality text", { exact: true })
    .fill(
      "Please keep these study materials private. Do not share screenshots.",
    );
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
  for (const language of ["en", "es", "fr"] as const) {
    const context = await browser.newContext({
        locale: language,
        viewport: { width: 390, height: 844 },
      }),
      p = await context.newPage();
    await p.goto(base + "/s/" + s.id + "?language=" + language);
    const agree = p.getByRole("checkbox", {
        name: copy(
          language,
          "I acknowledge and agree to the confidentiality text above.",
        ),
        exact: true,
      }),
      consent = p.getByRole("checkbox", {
        name: copy(
          language,
          "I agree to take part and have my responses stored and analyzed for this study.",
        ),
        exact: true,
      }),
      begin = p.getByRole("button", { name: copy(language, "Let’s begin") });
    await agree.waitFor();
    assert.equal(await agree.isChecked(), false);
    await consent.check();
    assert.equal(await begin.isDisabled(), true);
    await agree.check();
    assert.equal(await begin.isEnabled(), true);
    if (language === "en") {
      // Publication race must not admit someone who checked the old text.
      s = (await call(root)).study;
      s = (await call(root + "/publish", "POST", { version: s.version })).study;
      await begin.click();
      await p
        .getByText(
          "Review the current confidentiality text before starting. Reload this page to continue.",
          { exact: true },
        )
        .waitFor();
      await p.reload();
      await agree.waitFor();
      assert.equal(await agree.isChecked(), false);
      await consent.check();
      await agree.check();
    }
    await begin.click();
    await p.locator(".interview-progress").waitFor();
    await p.reload();
    await p.locator(".interview-progress").waitFor();
    assert.equal(
      await p.evaluate(() => document.documentElement.scrollWidth > innerWidth),
      false,
    );
    await context.close();
  }
  const result = await call(root);
  assert.equal(result.interviews.length, 3);
  for (const i of result.interviews)
    assert.ok(i.confidentialityAcknowledgement.acceptedAt);
  await page.goto(base + "/?study=" + s.id + "&tab=responses");
  await page
    .getByRole("button", { name: "Participant 1", exact: true })
    .click();
  await page
    .getByText("Confidentiality acknowledgement", { exact: true })
    .waitFor();
  mkdirSync("test-results", { recursive: true });
  await page.screenshot({
    path: "test-results/confidentiality-browser.png",
    fullPage: true,
  });
  console.log(
    "Confidentiality editor, independent consent, mobile EN/ES/FR, publication-race reload, resume and response audit passed.",
  );
} finally {
  await browser?.close();
  await stop();
}
