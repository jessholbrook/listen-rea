import { createClient } from "@libsql/client";
import path from "node:path";
import {
  docxAIPermissionText,
  docxAIPermissionVersion,
  docxProbePromptVersion,
} from "../src/lib/participant-docx-ai";
import { chromium, type Browser } from "playwright";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { start, stop, base, dataDirectory } from "./harness";
import { participantDOCXGuide, sampleDOCX } from "./participant-docx-fixture";
import { translatedFields } from "./localization-fixture";
import { docxLabels, docxMime } from "../src/lib/participant-docx";
import { docxAILabels } from "../src/lib/participant-docx-ai";
import { copy } from "../src/lib/participant-copy";
let browser: Browser | undefined;
try {
  await start({ port: 3244 });
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
    await call("studies", "POST", { title: "Participant DOCX feedback" })
  ).study;
  const root = "studies/" + s.id,
    guide = participantDOCXGuide();
  guide.questions[0].participantDOCX = false;
  s = (await call(root, "PUT", { version: s.version, guide })).study;
  await page.goto(base + "/?study=" + s.id + "&tab=guide");
  await page
    .getByLabel("Allow optional participant DOCX attachment", { exact: true })
    .check();
  await page
    .getByLabel("Allow optional AI DOCX follow-up (OpenAI)", { exact: true })
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
  let englishPage: any, englishContext: any;
  for (const language of ["en", "es", "fr"] as const) {
    const context = await browser.newContext({
        locale: language,
        viewport: { width: 390, height: 844 },
      }),
      p = await context.newPage();
    p.setDefaultTimeout(25000);
    p.on("pageerror", (e) => errors.push(e.message));
    p.on("request", (r) => {
      if (r.url().includes("docx-external.example.test"))
        external.push(r.url());
    });
    const t = (v: string) => copy(language, v);
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
    const box = p.getByRole("region", {
      name: docxLabels[language].title,
      exact: true,
    });
    await box.waitFor();
    const prepare = async () => {
      await box.locator("input[type=file]").setInputFiles({
        name: "synthetic.docx",
        mimeType: docxMime,
        buffer: bytes,
      });
      await box
        .getByLabel(docxLabels[language].description, { exact: true })
        .fill("Synthetic DOCX " + language);
      const consent = box.getByRole("checkbox", {
        name: docxLabels[language].consent,
        exact: true,
      });
      assert.equal(await consent.isChecked(), false);
      assert.equal(
        await box
          .getByRole("button", {
            name: docxLabels[language].upload,
            exact: true,
          })
          .isDisabled(),
        true,
      );
      await consent.check();
      const ai = box.getByRole("checkbox", {
        name: docxAILabels[language].permission,
        exact: true,
      });
      assert.equal(await ai.isChecked(), false);
      await ai.check();
    };
    await prepare();
    let dropped = false;
    if (language === "en")
      await p.route("**/api/interviews/*/participant-docx", async (route) => {
        if (!dropped && route.request().method() === "POST") {
          dropped = true;
          const actual = await route.fetch();
          assert.equal(actual.status(), 201);
          await route.abort("failed");
        } else await route.continue();
      });
    await box
      .getByRole("button", { name: docxLabels[language].upload, exact: true })
      .click();
    if (language === "en") {
      await box.getByRole("alert").waitFor();
      await box
        .getByRole("button", { name: docxLabels[language].upload, exact: true })
        .click();
    }
    await box
      .getByRole("button", { name: docxLabels[language].remove, exact: true })
      .waitFor();
    await p.reload();
    await box
      .getByText(docxAILabels[language].granted, { exact: true })
      .waitFor();
    await box
      .getByRole("button", { name: docxLabels[language].view, exact: true })
      .click();
    await box.getByText("Save draft before review.", { exact: true }).waitFor();
    await p
      .getByLabel(t("Your answer"), { exact: true })
      .fill("The synthetic document illustrates the research workflow.");
    await p.getByRole("button", { name: t("Continue"), exact: true }).click();
    await box.waitFor({ state: "hidden" });
    await p
      .getByText(docxAILabels[language].unavailable, { exact: true })
      .waitFor();
    assert.equal(
      await p.evaluate(() => document.documentElement.scrollWidth > innerWidth),
      false,
    );
    if (language === "en") {
      englishPage = p;
      englishContext = context;
    } else await context.close();
  }
  const detailBefore = await call(root),
    english = detailBefore.interviews.find((i: any) => i.language === "en"),
    file = english.turns[0].participantDOCX;
  assert.equal(file.aiPermission.version, docxAIPermissionVersion);
  assert.equal(english.turns[0].docxProbe.status, "unavailable");
  const sql = createClient({
    url: "file:" + path.join(dataDirectory(), "research.sqlite"),
  });
  try {
    const row = (
      await sql.execute({
        sql: "SELECT data FROM documents WHERE kind='interview' AND id=?",
        args: [english.id],
      })
    ).rows[0];
    Object.assign(english, JSON.parse(String(row.data)));
    english.current = 0;
    english.promptDOCXId = file.id;
    english.prompt = "How does Save draft before review. help you?";
    english.strategy = "ai";
    english.turns[0].docxProbe = {
      docxId: file.id,
      permissionVersion: docxAIPermissionVersion,
      promptVersion: docxProbePromptVersion,
      model: "synthetic-browser-fixture",
      generatedAt: new Date().toISOString(),
      status: "asked",
      probe: english.prompt,
      paragraph: 2,
      quote: "Save draft before review.",
    };
    await sql.execute({
      sql: "UPDATE documents SET data=? WHERE kind='interview' AND id=?",
      args: [JSON.stringify(english), english.id],
    });
  } finally {
    sql.close();
  }
  await englishPage.reload();
  const citation = englishPage.getByRole("region", {
    name: "DOCX question source",
    exact: true,
  });
  await citation.getByText("DOCX paragraph 2", { exact: true }).waitFor();
  await citation
    .getByRole("button", { name: "View DOCX text", exact: true })
    .click();
  await citation
    .locator("mark")
    .getByText("Save draft before review.", { exact: true })
    .waitFor();
  await englishPage
    .getByLabel("Your answer", { exact: true })
    .fill("The cited page explains the synthetic workflow.");
  await englishPage
    .getByRole("button", { name: "Continue", exact: true })
    .click();
  await citation.waitFor({ state: "hidden" });
  await englishContext.close();
  await page.goto(base + "/?study=" + s.id + "&tab=responses");
  await page
    .getByRole("button", { name: "Participant 1", exact: true })
    .click();
  await page
    .getByRole("heading", { name: "DOCX-aware AI follow-up", exact: true })
    .waitFor();
  await page
    .getByText("Synthetic prepared text snapshot", { exact: true })
    .count();
  page.once("dialog", (d) => d.accept());
  await page
    .getByRole("button", { name: "Delete attached DOCX", exact: true })
    .click();
  await page
    .getByRole("heading", { name: "Response transcript", exact: true })
    .waitFor({ state: "hidden" });
  const detail = await call(root);
  assert.equal(
    detail.interviews.find((i: any) => i.language === "en").turns[0].docxProbe,
    undefined,
  );
  assert.deepEqual(errors, []);
  assert.deepEqual(external, []);
  console.log(
    "Mobile EN/ES/FR separate DOCX AI consent, immutable upload retry/reload, permission receipt, unavailable-provider notice, cited prepared paragraph highlighting, follow-up answer/provenance and source erasure passed; asked probe is a marked fixture.",
  );
} finally {
  await browser?.close();
  await stop();
}
