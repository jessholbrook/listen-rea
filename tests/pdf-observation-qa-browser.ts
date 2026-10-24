import { seed } from "./image-review-fixture";
import { chromium, type Browser } from "playwright";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { start, stop, base } from "./harness";
import { participantPDFGuide, samplePDF } from "./participant-pdfs-fixture";
let browser: Browser | undefined;
try {
  await start({ port: 3208 });
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
    }),
    output = page.getByRole("region", {
      name: "AI answer about researcher annotations",
      exact: true,
    });
  await panel.waitFor();
  let a = (await call(root + "/analysis")).analysis;
  const e = a.pdfObservations[0];
  const question = "What change did the reviewer recommend?",
    response = {
      question,
      answer:
        "The reviewer recommends neutral wording without assuming success.",
      citations: [
        {
          pdfId: e.pdfId,
          reviewVersion: e.reviewVersion,
          field: "correction",
          quote: "ask about the document without assuming success",
        },
        {
          pdfId: e.pdfId,
          reviewVersion: e.reviewVersion,
          field: "notes",
          quote: "the second page is readable",
        },
      ],
      model: "synthetic-browser-fixture",
      promptVersion: "synthetic-browser-fixture",
      generatedAt: new Date().toISOString(),
    };
  let pending: any, release!: () => void, resolvePending!: () => void;
  let mode: "answer" | "pending" | "error" = "answer";
  await page.route("**/api/studies/*/pdf-observation-qa", async (route) => {
    const data = route.request().postDataJSON();
    assert.equal(data.question, question);
    assert.equal(data.id, a.id);
    assert.equal(data.version, a.version);
    if (mode === "pending") {
      pending = route;
      resolvePending();
      return;
    }
    if (mode === "error") {
      await route.fulfill({
        status: 409,
        json: {
          error: "Synthetic sources changed. Reload before asking again.",
        },
      });
      return;
    }
    await route.fulfill({ status: 200, json: response });
  });
  await panel
    .getByLabel("Your PDF observation question", { exact: true })
    .fill(question);
  await panel
    .getByRole("button", { name: "Ask about PDF observations", exact: true })
    .click();
  await output.getByText(response.answer, { exact: true }).waitFor();
  await output
    .getByText(
      "Researcher correction: ask about the document without assuming success",
      { exact: true },
    )
    .waitFor();
  await output
    .getByText("Researcher note: the second page is readable", { exact: true })
    .waitFor();
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth,
    ),
    false,
  );
  await output
    .getByRole("button", { name: "Clear PDF observation answer", exact: true })
    .click();
  await output.waitFor({ state: "hidden" });
  await panel
    .getByRole("button", { name: "Ask about PDF observations", exact: true })
    .click();
  await output.getByText(response.answer, { exact: true }).waitFor();
  await output.getByRole("link").first().click();
  await review
    .getByText("Saved PDF review · revision 1", { exact: true })
    .waitFor();
  await page.keyboard.press("Escape");
  await page
    .getByRole("button", { name: "Analysis & report", exact: true })
    .click();
  await panel.waitFor();
  assert.equal(await output.count(), 0);
  mode = "pending";
  const waiting = new Promise<void>((resolve) => {
    resolvePending = resolve;
  });
  await panel
    .getByLabel("Your PDF observation question", { exact: true })
    .fill(question);
  await panel
    .getByRole("button", { name: "Ask about PDF observations", exact: true })
    .click();
  await waiting;
  await page.getByRole("button", { name: /^Responses/ }).click();
  a = (await call(root + "/analysis", "PUT", { ...a, reviewed: false }))
    .analysis;
  await page
    .getByRole("button", { name: "Analysis & report", exact: true })
    .click();
  await panel.waitFor();
  await pending.fulfill({
    status: 200,
    json: { ...response, answer: "Stale synthetic answer must not appear." },
  });
  assert.equal(
    await page
      .getByText("Stale synthetic answer must not appear.", { exact: true })
      .count(),
    0,
  );
  assert.equal(await output.count(), 0);
  mode = "error";
  await panel
    .getByLabel("Your PDF observation question", { exact: true })
    .fill(question);
  await panel
    .getByRole("button", { name: "Ask about PDF observations", exact: true })
    .click();
  await panel
    .getByRole("alert")
    .getByText("Synthetic sources changed. Reload before asking again.", {
      exact: true,
    })
    .waitFor();
  assert.equal(await output.count(), 0);
  await page.reload();
  await panel.waitFor();
  assert.equal(await output.count(), 0);
  assert.equal(
    await panel
      .getByLabel("Your PDF observation question", { exact: true })
      .inputValue(),
    "",
  );
  assert.deepEqual(errors, []);
  console.log(
    "Mobile separate PDF annotation Q&A, exact note/correction labels, source links, clear/error/reload behavior and rejection of late answers after analysis navigation/version change passed.",
  );
} finally {
  await browser?.close();
  await stop();
}
