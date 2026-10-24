import { createClient } from "@libsql/client";
import path from "node:path";
import { dataDirectory } from "./harness";
import { seed } from "./image-review-fixture";
import { chromium, type Browser } from "playwright";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { start, stop, base } from "./harness";
import { participantPDFGuide, samplePDF } from "./participant-pdfs-fixture";
let browser: Browser | undefined;
try {
  await start({ port: 3211 });
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
  const call = async (
    path: string,
    method = "GET",
    data?: any,
    headers?: any,
  ) => {
    const r = await context.request.fetch(base + "/api/" + path, {
      method,
      data,
      headers,
    });
    assert.ok(
      r.ok(),
      path + ":" + r.status() + " " + (r.ok() ? "" : await r.text()),
    );
    return r.json();
  };
  await call("auth/signup", "POST", {
    name: "PDF appendix reviewer",
    email: randomUUID() + "@example.test",
    password: "pdf-appendix-test-password",
  });
  let s = (
    await call("studies", "POST", { title: "Verified document feedback" })
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
    headers = { "x-interview-token": r.token };
  const saved = await call(
    ip + "/participant-pdfs",
    "POST",
    await samplePDF(2),
    {
      ...headers,
      "content-type": "application/pdf",
      "x-upload-id": randomUUID(),
      "x-interview-version": "0",
      "x-pdf-description": "Synthetic two-page evidence PDF",
      "x-pdf-consent": "yes",
    },
  );
  await call(
    ip + "/answer",
    "POST",
    {
      version: 0,
      requestId: randomUUID(),
      answer: "The document illustrates the workflow.",
      participantPDFId: saved.pdf.id,
    },
    headers,
  );
  await call(
    ip + "/answer",
    "POST",
    {
      version: 1,
      requestId: randomUUID(),
      answer: "That is all for this synthetic study.",
    },
    headers,
  );
  await seed(r, (i) => {
    i.turns[0].pdfProbe = {
      pdfId: saved.pdf.id,
      status: "asked",
      probe: "How does Synthetic research PDF page 2 help?",
      page: 2,
      quote: "Synthetic research PDF page 2",
      model: "synthetic-fixture",
      permissionVersion: "synthetic-fixture",
      promptVersion: "synthetic-fixture",
      generatedAt: new Date().toISOString(),
    };
  });
  await page.route("**/api/me", async (route) => {
    const r = await route.fetch();
    await route.fulfill({
      response: r,
      json: { ...(await r.json()), ai: true },
    });
  });
  await page.goto(base + "/?study=" + s.id + "&tab=responses");
  await page
    .getByRole("button", { name: "Participant 1", exact: true })
    .click();
  const review = page.getByRole("region", {
      name: "Researcher PDF review",
      exact: true,
    }),
    include = review.getByRole("checkbox", {
      name: "Include PDF notes and corrections in analysis and report appendices",
      exact: true,
    });
  await review.getByText("Not reviewed", { exact: true }).waitFor();
  assert.equal(await include.isChecked(), false);
  await review
    .getByLabel("PDF quality", { exact: true })
    .selectOption("usable");
  await review
    .getByLabel("PDF review notes", { exact: true })
    .fill("Researcher observation: the second page is readable.");
  await review
    .getByLabel("PDF question grounding", { exact: true })
    .selectOption("unsupported");
  await review
    .getByLabel("Researcher correction", { exact: true })
    .fill(
      "Researcher correction: ask about the document without assuming success.",
    );
  await include.check();
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
  assert.equal(await include.isChecked(), true);
  await page.goto(base + "/?study=" + s.id + "&tab=analysis");
  await page
    .getByRole("button", { name: "Create evidence memo", exact: true })
    .click();
  const panel = page.getByRole("region", {
    name: "Ask about researcher PDF observations",
    exact: true,
  });
  await panel.waitFor();
  let a = (await call(root + "/analysis")).analysis;
  const e = a.pdfObservations[0];
  const original = {
    question: "What wording change was recommended?",
    answer: "Private original generated answer sentinel",
    citations: [
      {
        pdfId: e.pdfId,
        reviewVersion: e.reviewVersion,
        field: "correction",
        quote: "ask about the document without assuming success",
      },
    ],
    model: "synthetic-browser-fixture",
    promptVersion: "synthetic-browser-fixture",
    generatedAt: new Date().toISOString(),
  };
  await page.route("**/api/studies/*/pdf-observation-qa", async (route) => {
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
    a = { ...a, version: a.version + 1, pdfObservationAnswers: [saved] };
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
    .getByLabel("Your PDF observation question", { exact: true })
    .fill(original.question);
  await panel
    .getByRole("button", { name: "Ask and save PDF answer draft", exact: true })
    .click();
  const answerPanel = page.getByRole("region", {
    name: "Saved PDF observation answers",
    exact: true,
  });
  await answerPanel.getByText(/Private draft · review required/).waitFor();
  await page.reload();
  await answerPanel.getByText(/Private draft · review required/).waitFor();
  const answerReview = answerPanel.getByRole("checkbox", {
      name: "I reviewed this answer against its cited researcher notes or corrections.",
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
    .getByLabel("Saved PDF answer", { exact: true })
    .fill("Reviewed neutral wording recommendation for the synthetic study.");
  await answerReview.check();
  await answerInclude.check();
  await answerPanel
    .getByRole("button", { name: "Save PDF answer review", exact: true })
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
    name: "Reviewed PDF observation Q&A",
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
    .getByRole("button", { name: "Save PDF answer review", exact: true })
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
    .getByRole("button", { name: "Delete saved PDF answer", exact: true })
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
