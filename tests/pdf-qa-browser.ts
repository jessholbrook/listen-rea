import { chromium, type Browser } from "playwright";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createClient } from "@libsql/client";
import path from "node:path";
import { start, stop, base, dataDirectory } from "./harness";
import { participantPDFGuide } from "./participant-pdfs-fixture";
import { scannedPDF } from "./pdf-ocr-fixture";
import {
  pdfOCRPermissionText,
  pdfOCRPermissionVersion,
} from "../src/lib/pdf-ocr";
import { pdfQALabels } from "../src/lib/pdf-qa";
let browser: Browser | undefined;
try {
  await start({ port: 3217 });
  browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_PATH || "/usr/bin/chromium",
    args: ["--no-sandbox"],
  });
  const context = await browser.newContext({
      viewport: { width: 390, height: 844 },
    }),
    page = await context.newPage(),
    errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.setDefaultTimeout(30000);
  const call = async (p: string, method = "GET", data?: any, headers?: any) => {
    const r = await context.request.fetch(base + "/api/" + p, {
      method,
      data,
      headers,
    });
    assert.ok(
      r.ok(),
      p + ":" + r.status() + " " + (r.ok() ? "" : await r.text()),
    );
    return r.json();
  };
  await call("auth/signup", "POST", {
    name: "PDF Q&A browser reviewer",
    email: randomUUID() + "@example.test",
    password: "pdf-qa-browser-password",
  });
  let s = (
    await call("studies", "POST", { title: "Verified document questions" })
  ).study;
  const root = "studies/" + s.id;
  s = (
    await call(root, "PUT", {
      version: s.version,
      guide: participantPDFGuide(),
    })
  ).study;
  s = (await call(root + "/publish", "POST", { version: s.version })).study;
  await call(root + "/fielding", "POST", { state: "active" });
  const r = await call("public/" + s.id, "POST", { consent: true }),
    ip = "interviews/" + r.interview.id,
    h = { "x-interview-token": r.token };
  const file = await call(
    ip + "/participant-pdfs",
    "POST",
    await scannedPDF(),
    {
      ...h,
      "content-type": "application/pdf",
      "x-upload-id": randomUUID(),
      "x-interview-version": "0",
      "x-pdf-description": "Synthetic native and scanned PDF",
      "x-pdf-consent": "yes",
    },
  );
  await call(
    ip + "/answer",
    "POST",
    {
      version: 0,
      requestId: randomUUID(),
      answer: "Synthetic scan",
      participantPDFId: file.pdf.id,
    },
    h,
  );
  await call(
    ip + "/answer",
    "POST",
    { version: 1, requestId: randomUUID(), answer: "Synthetic closing answer" },
    h,
  );
  const asset = root + "/participant-pdfs/" + file.pdf.id;
  let view = await call(asset + "/text", "POST", {});
  const d = createClient({
      url: "file:" + path.join(dataDirectory(), "research.sqlite"),
    }),
    draftId = randomUUID(),
    text = view.text;
  text.ocr = [
    {
      id: draftId,
      page: 2,
      draft: "Save draft befor review.",
      model: "synthetic-browser",
      promptVersion: pdfOCRPermissionVersion,
      generatedAt: new Date().toISOString(),
      permission: {
        version: pdfOCRPermissionVersion,
        text: pdfOCRPermissionText,
        provider: "OpenAI",
        grantedAt: new Date().toISOString(),
        actor: { id: "fixture", name: "Browser fixture permission" },
      },
    },
  ];
  await d.execute({
    sql: "UPDATE documents SET data=? WHERE kind='participantPDFText' AND id=?",
    args: [JSON.stringify(text), file.pdf.id],
  });
  d.close();
  view = await call(asset + "/ocr", "PUT", {
    source: view.source,
    digest: text.digest,
    page: 2,
    draftId,
    text: "Save draft before review.",
    attested: true,
    version: 0,
  });
  await call(asset + "/text", "PUT", {
    source: view.source,
    digest: view.text.digest,
    version: 1,
    attested: true,
    includeInReports: true,
    passages: view.text.pages.map((quote: string, n: number) => ({
      page: n + 1,
      start: 0,
      end: quote.length,
      quote,
    })),
  });
  let a = (await call(root + "/analysis", "POST", { mode: "manual" })).analysis;
  await page.route("**/api/me", async (route) => {
    const r = await route.fetch();
    await route.fulfill({
      response: r,
      json: { ...(await r.json()), ai: true },
    });
  });
  const question = "What should happen before review?",
    evidence = a.pdfEvidence[0],
    response = {
      question,
      answer:
        "The selected document excerpt says to save the draft before review.",
      citations: evidence.passages.map((p: any) => ({
        pdfId: evidence.pdfId,
        verificationVersion: evidence.verificationVersion,
        ...p,
      })),
      model: "synthetic-browser-fixture",
      promptVersion: "synthetic-browser-fixture",
      generatedAt: new Date().toISOString(),
    };
  let mode: "answer" | "insufficient" | "error" | "pending" = "answer",
    language: "en" | "es" | "fr" = "en",
    pending: any,
    resolvePending!: () => void;
  await page.route("**/api/studies/*/pdf-qa", async (route) => {
    const data = route.request().postDataJSON();
    assert.equal(data.question, question);
    assert.equal(data.id, a.id);
    assert.equal(data.version, a.version);
    assert.equal(data.sources, undefined);
    if (mode === "pending") {
      pending = route;
      resolvePending();
      return;
    }
    if (mode === "error") {
      await route.fulfill({
        status: 409,
        json: {
          error:
            "Synthetic passage sources changed. Reload before asking again.",
        },
      });
      return;
    }
    await route.fulfill({
      json:
        mode === "insufficient"
          ? {
              ...response,
              answer: pdfQALabels[language].insufficient,
              citations: [],
            }
          : response,
    });
  });
  await page.goto(base + "/?study=" + s.id + "&tab=analysis");
  const panel = page.getByRole("region", {
      name: pdfQALabels.en.title,
      exact: true,
    }),
    output = page.getByRole("region", {
      name: pdfQALabels.en.answer,
      exact: true,
    });
  const ask = async () => {
    await panel
      .getByLabel(pdfQALabels.en.question, { exact: true })
      .fill(question);
    await panel
      .getByRole("button", { name: pdfQALabels.en.ask, exact: true })
      .click();
  };
  await panel.waitFor();
  await ask();
  await output.getByText(response.answer, { exact: true }).waitFor();
  await output.getByText("Researcher-verified OCR", { exact: true }).waitFor();
  await output.getByRole("button", { name: "PDF page 2", exact: true }).click();
  await output.getByRole("img", { name: "Page 2", exact: true }).waitFor();
  await page.waitForFunction(() => {
    const c = document.querySelector(".pdf-qa canvas") as HTMLCanvasElement;
    return (
      c?.width > 0 &&
      c
        .getContext("2d")!
        .getImageData(0, 0, c.width, c.height)
        .data.some((v, n) => n % 4 === 0 && v < 150)
    );
  });
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
    true,
  );
  await output
    .getByRole("button", { name: pdfQALabels.en.clear, exact: true })
    .click();
  await output.waitFor({ state: "hidden" });
  await ask();
  await output.getByText(response.answer, { exact: true }).waitFor();
  await output.getByRole("link").first().click();
  await page
    .getByRole("heading", { name: "Response transcript", exact: true })
    .waitFor();
  await page.keyboard.press("Escape");
  await page
    .getByRole("button", { name: "Analysis & report", exact: true })
    .click();
  await panel.waitFor();
  assert.equal(await output.count(), 0);
  mode = "pending";
  const waiting = new Promise<void>((r) => {
    resolvePending = r;
  });
  await ask();
  await waiting;
  await page.getByRole("button", { name: /^Responses/ }).click();
  a = (await call(root + "/analysis", "PUT", { ...a, reviewed: false }))
    .analysis;
  await page
    .getByRole("button", { name: "Analysis & report", exact: true })
    .click();
  await panel.waitFor();
  await pending.fulfill({
    json: {
      ...response,
      answer: "Stale synthetic passage answer must not appear.",
    },
  });
  assert.equal(
    await page
      .getByText("Stale synthetic passage answer must not appear.", {
        exact: true,
      })
      .count(),
    0,
  );
  assert.equal(await output.count(), 0);
  mode = "error";
  await ask();
  await panel
    .getByRole("alert")
    .getByText(
      "Synthetic passage sources changed. Reload before asking again.",
      { exact: true },
    )
    .waitFor();
  assert.equal(await output.count(), 0);
  await page.reload();
  await panel.waitFor();
  assert.equal(
    await panel
      .getByLabel(pdfQALabels.en.question, { exact: true })
      .inputValue(),
    "",
  );
  assert.equal(await output.count(), 0);
  for (const nextLanguage of ["en", "es", "fr"] as const) {
    language = nextLanguage;
    s = (await call(root)).study;
    const guide = structuredClone(s.draft);
    guide.localization = {
      sourceLanguage: "en",
      reportingLanguage: language,
      guidance: "",
      translations: [],
    };
    await call(root, "PUT", { version: s.version, guide });
    a = (await call(root + "/analysis", "POST", { mode: "manual" })).analysis;
    mode = "insufficient";
    await page.goto(base + "/?study=" + s.id + "&tab=analysis");
    const l = pdfQALabels[language],
      p = page.getByRole("region", { name: l.title, exact: true });
    await p.getByLabel(l.question, { exact: true }).fill(question);
    await p.getByRole("button", { name: l.ask, exact: true }).click();
    await p.getByText(l.insufficient, { exact: true }).waitFor();
    assert.equal(await p.locator("blockquote").count(), 0);
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
      true,
    );
  }
  assert.deepEqual(errors, []);
  console.log(
    "Mobile verified native/OCR passage Q&A, exact page links and pixels, OCR attribution, source response, localized insufficiency, clear/error/reload and late-answer isolation passed.",
  );
} finally {
  await browser?.close();
  await stop();
}
