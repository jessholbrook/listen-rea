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
  await start({ port: 3220 });
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
  const e = a.pdfEvidence[0];
  await page.goto(base + "/?study=" + s.id + "&tab=analysis");
  const panel = page.getByRole("region", {
    name: "Ask about verified PDF passages",
    exact: true,
  });
  await panel.waitFor();
  const original = {
    question: "What wording change was recommended?",
    answer: "Private original generated answer sentinel",
    citations: [
      {
        pdfId: e.pdfId,
        verificationVersion: e.verificationVersion,
        page: 2,
        start: 0,
        end: 25,
        quote: "Save draft before review.",
      },
    ],
    model: "synthetic-browser-fixture",
    promptVersion: "synthetic-browser-fixture",
    generatedAt: new Date().toISOString(),
  };
  await page.route("**/api/studies/*/pdf-qa", async (route) => {
    const input = route.request().postDataJSON();
    assert.equal(input.saveDraft, true);
    const saved = {
      id: randomUUID(),
      original,
      sources: [e],
      history: [
        {
          version: 1,
          answer: original.answer,
          citations: original.citations,
          reviewed: false,
          includeInReports: false,
          editor: { id: "synthetic", name: "Synthetic saver" },
          at: new Date().toISOString(),
        },
      ],
    };
    a = { ...a, version: a.version + 1, pdfAnswers: [saved] };
    const sql = createClient({
      url: "file:" + path.join(dataDirectory(), "research.sqlite"),
    });
    try {
      await sql.execute({
        sql: "UPDATE documents SET data=? WHERE kind='analysis' AND id=?",
        args: [JSON.stringify(a), a.id],
      });
    } finally {
      sql.close();
    }
    await route.fulfill({
      status: 200,
      json: { ...original, analysis: a, savedAnswerId: saved.id },
    });
  });
  await panel
    .getByLabel("Your PDF passage question", { exact: true })
    .fill(original.question);
  await panel
    .getByRole("button", {
      name: "Ask and save PDF passage answer draft",
      exact: true,
    })
    .click();
  const answerPanel = page.getByRole("region", {
    name: "Saved PDF passage answers",
    exact: true,
  });
  await answerPanel.getByText(/Private draft · review required/).waitFor();
  await page.reload();
  await answerPanel.getByText(/Private draft · review required/).waitFor();
  const answerReview = answerPanel.getByRole("checkbox", {
      name: "I reviewed this answer against its selected passages and original PDF pages, including any OCR transcription.",
      exact: true,
    }),
    answerInclude = answerPanel.getByRole("checkbox", {
      name: "Include this reviewed PDF answer in report appendices",
      exact: true,
    });
  assert.equal(await answerReview.isChecked(), false);
  assert.equal(await answerInclude.isChecked(), false);
  assert.equal(await answerInclude.isDisabled(), true);
  await answerPanel
    .getByLabel("Saved PDF passage answer", { exact: true })
    .fill("Reviewed neutral wording recommendation for the synthetic study.");
  await answerPanel
    .getByRole("button", {
      name: "Compare saved answer PDF page 2",
      exact: true,
    })
    .click();
  await answerPanel.getByRole("img", { name: "Page 2", exact: true }).waitFor();
  await answerPanel
    .getByText("Researcher-verified OCR", { exact: true })
    .waitFor();
  await answerReview.check();
  await answerInclude.check();
  await answerPanel
    .getByLabel("Saved PDF passage answer", { exact: true })
    .fill(
      "Reviewed neutral wording recommendation for the synthetic study. Revised.",
    );
  assert.equal(await answerReview.isChecked(), false);
  assert.equal(await answerInclude.isChecked(), false);
  await answerReview.check();
  await answerInclude.check();
  await answerPanel
    .getByRole("button", {
      name: "Save PDF passage answer review",
      exact: true,
    })
    .click();
  await answerPanel.getByText(/Included in reports/).waitFor();
  await answerPanel
    .getByText("Original AI answer and review history (2)", { exact: true })
    .click();
  await answerPanel
    .getByText(original.answer, { exact: true })
    .first()
    .waitFor();
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth,
    ),
    false,
  );
  a = (await call(root + "/analysis")).analysis;
  assert.equal(a.reviewed, false);
  a = (await call(root + "/analysis", "PUT", { ...a, reviewed: true }))
    .analysis;
  const edition = (
    await call(root + "/reporting/editions", "POST", {
      analysisId: a.id,
      title: "Reviewed PDF Q&A report",
    })
  ).edition;
  await page.goto(base + "/?study=" + s.id + "&tab=reporting");
  const appendix = page.getByRole("region", {
    name: "Reviewed PDF passage Q&A",
    exact: true,
  });
  await appendix.getByText(/Reviewed neutral wording recommendation/).waitFor();
  assert.equal(
    await appendix.getByText(original.answer, { exact: true }).count(),
    0,
  );
  await appendix.getByRole("link").first().click();
  await page
    .getByRole("heading", { name: "Response transcript", exact: true })
    .waitFor();
  await page.keyboard.press("Escape");
  await page
    .getByRole("button", { name: "Analysis & report", exact: true })
    .click();
  await answerPanel.getByText(/Included in reports/).waitFor();
  await answerInclude.uncheck();
  await answerPanel
    .getByRole("button", {
      name: "Save PDF passage answer review",
      exact: true,
    })
    .click();
  await answerPanel.getByText(/^Reviewed · Internal only/).waitFor();
  assert.equal(
    (
      await context.request.get(
        base + "/api/" + root + "/reporting/editions/" + edition.id,
      )
    ).status(),
    404,
  );
  page.once("dialog", (d) => d.accept());
  await answerPanel
    .getByRole("button", {
      name: "Delete saved PDF passage answer",
      exact: true,
    })
    .click();
  await answerPanel.waitFor({ state: "hidden" });
  assert.deepEqual(errors, []);
  console.log(
    "Mobile explicit saved draft, reload, separate review/inclusion, immutable original/history, attributed report projection, source links, withdrawal and deletion passed.",
  );
} finally {
  await browser?.close();
  await stop();
}
