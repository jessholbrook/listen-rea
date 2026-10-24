import { chromium, type Browser } from "playwright";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { start, stop, base } from "./harness";
import { sampleDOCX, participantDOCXGuide } from "./participant-docx-fixture";
import { docxLabels } from "../src/lib/participant-docx";
import { copy } from "../src/lib/participant-copy";
import { translatedFields } from "./localization-fixture";
let browser: Browser | undefined;
try {
  await start({ port: 3226 });
  browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_PATH || "/usr/bin/chromium",
    args: ["--no-sandbox"],
  });
  const admin = await browser.newContext({
      viewport: { width: 390, height: 844 },
    }),
    page = await admin.newPage(),
    errors: string[] = [],
    external: string[] = [];
  const call = async (path: string, method = "GET", data?: any) => {
    const r = await admin.request.fetch(base + "/api/" + path, {
      method,
      data,
    });
    assert.ok(
      r.ok(),
      path + ":" + r.status() + " " + (r.ok() ? "" : await r.text()),
    );
    return r.json();
  };
  await call("auth/signup", "POST", {
    name: "DOCX browser reviewer",
    email: randomUUID() + "@example.test",
    password: "docx-browser-password",
  });
  let s = (
    await call("studies", "POST", { title: "DOCX participant feedback" })
  ).study;
  const root = "studies/" + s.id,
    guide = participantDOCXGuide();
  guide.questions[0].participantDOCX = false;
  s = (await call(root, "PUT", { version: s.version, guide })).study;
  await page.goto(base + "/?study=" + s.id + "&tab=guide");
  await page
    .getByLabel("Allow optional participant DOCX attachment", { exact: true })
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
  const bytes = await sampleDOCX();
  for (const language of ["en", "es", "fr"] as const) {
    const context = await browser.newContext({
        locale: language,
        viewport: { width: 390, height: 844 },
      }),
      p = await context.newPage(),
      l = docxLabels[language],
      t = (v: string) => copy(language, v);
    p.on("pageerror", (e) => errors.push(e.message));
    p.on("request", (r) => {
      if (r.url().includes("docx-external.example.test"))
        external.push(r.url());
    });
    p.setDefaultTimeout(30000);
    await p.goto(base + "/s/" + s.id + "?language=" + language);
    await p
      .getByRole("checkbox", {
        name: t(
          "I agree to take part and have my responses stored and analyzed for this study.",
        ),
        exact: true,
      })
      .check();
    await p
      .getByRole("button", { name: t("Let’s begin"), exact: true })
      .click();
    const box = p.getByRole("region", { name: l.title, exact: true });
    await box.waitFor();
    await box.locator("input[type=file]").setInputFiles({
      name: "synthetic.docx",
      mimeType:
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      buffer: bytes,
    });
    await box
      .getByLabel(l.description, { exact: true })
      .fill("Synthetic document " + language);
    assert.equal(
      await box
        .getByRole("button", { name: l.upload, exact: true })
        .isDisabled(),
      true,
    );
    assert.equal(
      await box
        .getByRole("checkbox", { name: l.consent, exact: true })
        .isChecked(),
      false,
    );
    await box.getByRole("checkbox", { name: l.consent, exact: true }).check();
    let dropped = false;
    if (language === "en")
      await p.route("**/api/interviews/*/participant-docx", async (route) => {
        if (!dropped && route.request().method() === "POST") {
          dropped = true;
          const r = await route.fetch();
          assert.equal(r.status(), 201);
          await route.abort("failed");
        } else await route.continue();
      });
    await box.getByRole("button", { name: l.upload, exact: true }).click();
    if (language === "en") {
      await box.getByRole("alert").waitFor();
      await box.getByRole("button", { name: l.upload, exact: true }).click();
    }
    await box.getByRole("button", { name: l.remove, exact: true }).waitFor();
    await p.reload();
    await box.getByRole("button", { name: l.view, exact: true }).click();
    await box
      .getByRole("region", { name: l.snapshot, exact: true })
      .getByText("Synthetic DOCX research note", { exact: true })
      .waitFor();
    await box.getByText("Save draft before review.", { exact: true }).waitFor();
    assert.ok(!(await box.innerText()).includes("HIDDEN-SENTINEL"));
    assert.equal(await box.locator("a[href^=http]").count(), 0);
    assert.equal(
      await p.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
      true,
    );
    await p
      .getByLabel(t("Your answer"), { exact: true })
      .fill("Synthetic answer with prepared document text.");
    await p.getByRole("button", { name: t("Continue"), exact: true }).click();
    await box.waitFor({ state: "hidden" });
    await context.close();
  }
  await page.goto(base + "/?study=" + s.id + "&tab=responses");
  await page
    .getByRole("button", { name: "Participant 1", exact: true })
    .click();
  const review = page.getByRole("region", {
    name: "Researcher DOCX review",
    exact: true,
  });
  await page
    .getByRole("button", { name: "View DOCX text", exact: true })
    .click();
  await page
    .getByRole("region", { name: "Prepared DOCX text", exact: true })
    .getByText("Synthetic DOCX research note", { exact: true })
    .waitFor();
  await review.getByText("DOCX not reviewed", { exact: true }).waitFor();
  await review
    .getByLabel("DOCX quality", { exact: true })
    .selectOption("usable");
  await review
    .getByLabel("DOCX review notes", { exact: true })
    .fill("Prepared document is readable.");
  await review
    .getByRole("button", { name: "Save DOCX review", exact: true })
    .click();
  await review
    .getByText("Saved DOCX review · revision 1", { exact: true })
    .waitFor();
  await review
    .getByLabel("DOCX review notes", { exact: true })
    .fill("Private follow-up review sentinel");
  await review
    .getByRole("button", { name: "Save DOCX review", exact: true })
    .click();
  await review
    .getByText("Saved DOCX review · revision 2", { exact: true })
    .waitFor();
  await review.getByText("DOCX review history (2)", { exact: true }).click();
  await review
    .getByText("Prepared document is readable.", { exact: true })
    .waitFor();
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
    true,
  );
  await page.reload();
  await page
    .getByRole("button", { name: "Participant 1", exact: true })
    .click();
  await review
    .getByText("Saved DOCX review · revision 2", { exact: true })
    .waitFor();
  page.once("dialog", (d) => d.accept());
  await page
    .getByRole("button", { name: "Delete attached DOCX", exact: true })
    .click();
  await page
    .getByRole("heading", { name: "Response transcript", exact: true })
    .waitFor({ state: "hidden" });
  const result = await call(root);
  assert.equal(
    result.interviews.filter((i: any) => i.turns[0].participantDOCX).length,
    2,
  );
  assert.deepEqual(errors, []);
  assert.deepEqual(external, []);
  console.log(
    "Mobile EN/ES/FR DOCX consent, lost-upload retry, prepared private text, answer binding, attributed review/history/reload and deletion passed without external document requests.",
  );
} finally {
  await browser?.close();
  await stop();
}
