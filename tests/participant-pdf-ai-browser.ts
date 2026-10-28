import { createClient } from "@libsql/client";
import path from "node:path";
import {
  pdfAIPermissionText,
  pdfAIPermissionVersion,
  pdfProbePromptVersion,
} from "../src/lib/participant-pdf-ai";
import { chromium, type Browser } from "playwright";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { start, stop, base, dataDirectory } from "./harness";
import { participantPDFGuide, samplePDF } from "./participant-pdfs-fixture";
import { translatedFields } from "./localization-fixture";
import { copy } from "../src/lib/participant-copy";
let browser: Browser | undefined;
try {
  await start({ port: 3196 });
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
    name: "PDF browser reviewer",
    email: randomUUID() + "@example.test",
    password: "pdf-browser-password",
  });
  let s = (await call("studies", "POST", { title: "Participant PDF feedback" }))
    .study;
  const root = "studies/" + s.id,
    guide = participantPDFGuide();
  guide.questions[0].participantPDFs = false;
  s = (await call(root, "PUT", { version: s.version, guide })).study;
  await page.goto(base + "/?study=" + s.id + "&tab=guide");
  await page
    .getByLabel("Allow optional participant PDF attachment", { exact: true })
    .check();
  await page
    .getByLabel("Allow optional AI PDF follow-up (OpenAI)", { exact: true })
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
  const bytes = await samplePDF(2, true);
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
      if (r.url().includes("pdf-external.example.test")) external.push(r.url());
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
      name: t("Optional PDF attachment"),
      exact: true,
    });
    await box.waitFor();
    const prepare = async () => {
      await box.locator("input[type=file]").setInputFiles({
        name: "synthetic.pdf",
        mimeType: "application/pdf",
        buffer: bytes,
      });
      await box
        .getByLabel(t("Describe your PDF"), { exact: true })
        .fill("Synthetic PDF " + language);
      const consent = box.getByRole("checkbox", {
        name: t(
          "I agree to share this PDF with the research team for this study.",
        ),
        exact: true,
      });
      assert.equal(await consent.isChecked(), false);
      assert.equal(
        await box
          .getByRole("button", { name: t("Upload PDF"), exact: true })
          .isDisabled(),
        true,
      );
      await consent.check();
      const ai = box.getByRole("checkbox", {
        name: t(pdfAIPermissionText),
        exact: true,
      });
      assert.equal(await ai.isChecked(), false);
      await ai.check();
    };
    await prepare();
    let dropped = false;
    if (language === "en")
      await p.route("**/api/interviews/*/participant-pdfs", async (route) => {
        if (!dropped && route.request().method() === "POST") {
          dropped = true;
          const actual = await route.fetch();
          assert.equal(actual.status(), 201);
          await route.abort("failed");
        } else await route.continue();
      });
    await box
      .getByRole("button", { name: t("Upload PDF"), exact: true })
      .click();
    if (language === "en") {
      await box.getByRole("alert").waitFor();
      await box
        .getByRole("button", { name: t("Upload PDF"), exact: true })
        .click();
    }
    await box
      .getByRole("button", { name: t("Remove attached PDF"), exact: true })
      .waitFor();
    await p.reload();
    await box.getByRole("button", { name: t("View PDF"), exact: true }).click();
    const canvas = box.getByRole("img", {
      name: t("Page") + " 1",
      exact: true,
    });
    await canvas.waitFor();
    await box
      .getByRole("button", { name: t("Next page"), exact: true })
      .waitFor();
    await box.getByRole("status").waitFor({ state: "hidden" });
    assert.ok(
      await canvas.evaluate((node: HTMLCanvasElement) => {
        const pixels = node
          .getContext("2d")!
          .getImageData(0, 0, node.width, node.height).data;
        let ink = 0;
        for (let k = 0; k < pixels.length; k += 4)
          if (pixels[k] < 150 && pixels[k + 3] > 0) ink++;
        return ink > 20;
      }),
    );
    await box
      .getByRole("button", { name: t("Next page"), exact: true })
      .click();
    await box
      .getByRole("img", { name: t("Page") + " 2", exact: true })
      .waitFor();
    assert.equal(
      await p.evaluate(() => (globalThis as any).PDF_ACTION_EXECUTED),
      undefined,
    );
    assert.equal(
      await p.evaluate(() => document.documentElement.scrollWidth > innerWidth),
      false,
    );
    await p
      .getByLabel(t("Your answer"), { exact: true })
      .fill("The synthetic document illustrates the research workflow.");
    await p.getByRole("button", { name: t("Continue"), exact: true }).click();
    await box.waitFor({ state: "hidden" });
    if (language === "en") {
      englishPage = p;
      englishContext = context;
    } else await context.close();
  }
  const detailBefore = await call(root),
    english = detailBefore.interviews.find((i: any) => i.language === "en"),
    file = english.turns[0].participantPDF;
  assert.equal(file.aiPermission.version, pdfAIPermissionVersion);
  assert.equal(english.turns[0].pdfProbe.status, "unavailable");
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
    english.promptPDFId = file.id;
    english.prompt = "How does Synthetic research PDF page 2 help you?";
    english.strategy = "ai";
    english.turns[0].pdfProbe = {
      pdfId: file.id,
      permissionVersion: pdfAIPermissionVersion,
      promptVersion: pdfProbePromptVersion,
      model: "synthetic-browser-fixture",
      generatedAt: new Date().toISOString(),
      status: "asked",
      probe: english.prompt,
      page: 2,
      quote: "Synthetic research PDF page 2",
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
    name: "PDF question source",
    exact: true,
  });
  await citation.getByText("PDF page 2", { exact: true }).waitFor();
  await citation.getByRole("button", { name: "View PDF", exact: true }).click();
  await citation.getByRole("img", { name: "Page 2", exact: true }).waitFor();
  await englishPage.waitForFunction(() => {
    const c = document.querySelector(
      '[aria-label="PDF question source"] canvas',
    ) as HTMLCanvasElement;
    return (
      c?.width > 0 &&
      c
        .getContext("2d")!
        .getImageData(0, 0, c.width, c.height)
        .data.some((v, n) => n % 4 === 0 && v < 200)
    );
  });
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
  const review = page.getByRole("region", {
    name: "Researcher PDF review",
    exact: true,
  });
  await review.getByText("Not reviewed", { exact: true }).waitFor();
  await review
    .getByLabel("PDF quality", { exact: true })
    .selectOption("usable");
  await review
    .getByLabel("PDF review notes", { exact: true })
    .fill("The prepared PDF pages are readable.");
  await review
    .getByRole("region", { name: "Original PDF follow-up", exact: true })
    .getByText("How does Synthetic research PDF page 2 help you?", {
      exact: true,
    })
    .waitFor();
  await review
    .getByLabel("PDF question grounding", { exact: true })
    .selectOption("supported");
  await review
    .getByLabel("Researcher correction", { exact: true })
    .fill("First private PDF correction.");
  await review
    .getByRole("button", { name: "Save PDF review", exact: true })
    .click();
  await review
    .getByText("Saved PDF review · revision 1", { exact: true })
    .waitFor();
  await page.reload();
  await page
    .getByRole("button", { name: "Participant 1", exact: true })
    .click();
  await review
    .getByText("Saved PDF review · revision 1", { exact: true })
    .waitFor();
  assert.equal(
    await review
      .getByLabel("Researcher correction", { exact: true })
      .inputValue(),
    "First private PDF correction.",
  );
  await review
    .getByLabel("PDF question grounding", { exact: true })
    .selectOption("unsupported");
  await review
    .getByLabel("Researcher correction", { exact: true })
    .fill("The wording overstates what the document supports.");
  await review
    .getByLabel("PDF quality", { exact: true })
    .selectOption("privacy_concern");
  await review
    .getByLabel("PDF review notes", { exact: true })
    .fill("Remove the private example before reuse.");
  await review
    .getByRole("button", { name: "Save PDF review", exact: true })
    .click();
  await review
    .getByText("Saved PDF review · revision 2", { exact: true })
    .waitFor();
  await review.getByText("PDF review history (2)", { exact: true }).click();
  await review
    .getByText("The prepared PDF pages are readable.", { exact: true })
    .waitFor();
  await review
    .getByText("Researcher correction: First private PDF correction.", {
      exact: true,
    })
    .waitFor();
  await review.getByText("Grounding: unsupported", { exact: true }).waitFor();
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth,
    ),
    false,
  );
  page.once("dialog", (d) => d.accept());
  await page
    .getByRole("button", { name: "Delete attached PDF", exact: true })
    .click();
  await page
    .getByRole("heading", { name: "Response transcript", exact: true })
    .waitFor({ state: "hidden" });
  const detail = await call(root);
  assert.equal(
    detail.interviews.filter((i: any) => i.turns[0].participantPDF).length,
    2,
  );
  assert.equal(
    detail.interviews.filter((i: any) => i.turns[0].participantPDFRemovedAt)
      .length,
    1,
  );
  assert.deepEqual(errors, []);
  assert.deepEqual(external, []);
  console.log(
    "Mobile EN/ES/FR separate PDF AI consent, upload retry/reload, frozen permission, unavailable-provider notice, real cited-page pixels, follow-up answer, private grounding/correction revision history, reload and source erasure passed.",
  );
} finally {
  await browser?.close();
  await stop();
}
