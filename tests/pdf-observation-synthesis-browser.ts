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
  await start({ port: 3205 });
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
  const controls = page.getByRole("region", {
    name: "PDF observation synthesis controls",
    exact: true,
  });
  await controls.waitFor();
  assert.equal(
    await controls
      .getByRole("button", {
        name: "Synthesize PDF observations with AI",
        exact: true,
      })
      .isDisabled(),
    true,
  );
  let a = (await call(root + "/analysis")).analysis;
  const entry = a.pdfObservations[0];
  const draft = {
    findings: [
      {
        title: "Question wording needs review",
        description:
          "A researcher correction recommends avoiding an assumption of success.",
        citations: [
          {
            pdfId: entry.pdfId,
            reviewVersion: entry.reviewVersion,
            field: "correction",
            quote: "ask about the document without assuming success",
          },
          {
            pdfId: entry.pdfId,
            reviewVersion: entry.reviewVersion,
            field: "notes",
            quote: "the second page is readable",
          },
        ],
      },
    ],
    limitations:
      "Selected researcher annotations do not verify document facts or participant experiences.",
    model: "synthetic-browser-fixture",
    promptVersion: "synthetic-browser-fixture",
    generatedAt: new Date().toISOString(),
    reviewed: false,
  };
  const sql = createClient({
    url: "file:" + path.join(dataDirectory(), "research.sqlite"),
  });
  try {
    await sql.execute({
      sql: "UPDATE documents SET data=? WHERE kind='analysis' AND id=?",
      args: [JSON.stringify({ ...a, pdfObservationSynthesis: draft }), a.id],
    });
  } finally {
    sql.close();
  }
  await page.reload();
  const view = page.getByRole("region", {
    name: "Synthesis of researcher PDF observations",
    exact: true,
  });
  await view.getByText("Draft · review required", { exact: true }).waitFor();
  await view
    .getByText(
      "Researcher correction: ask about the document without assuming success",
      { exact: true },
    )
    .waitFor();
  const checkbox = controls.getByRole("checkbox", {
    name: "I checked each interpretation against its cited researcher PDF notes or corrections and reviewed the limitations.",
    exact: true,
  });
  assert.equal(await checkbox.isChecked(), false);
  await controls
    .getByLabel("PDF observation synthesis finding 1 interpretation", {
      exact: true,
    })
    .fill(
      "The reviewer recommends neutral wording; actual participant experiences need separate evidence.",
    );
  await checkbox.check();
  await controls
    .getByRole("button", {
      name: "Save PDF observation synthesis review",
      exact: true,
    })
    .click();
  await view.getByText("Reviewed", { exact: true }).waitFor();
  await page.reload();
  await view.getByText("Reviewed", { exact: true }).waitFor();
  a = (await call(root + "/analysis")).analysis;
  assert.equal(a.pdfObservationSynthesis.reviewed, true);
  assert.equal(a.reviewed, false);
  await view.getByRole("link").first().click();
  await review
    .getByText("Saved PDF review · revision 1", { exact: true })
    .waitFor();
  await page.goto(base + "/?study=" + s.id + "&tab=analysis");
  await view.getByText("Reviewed", { exact: true }).waitFor();
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth,
    ),
    false,
  );
  page.once("dialog", (d) => d.accept());
  await controls
    .getByRole("button", {
      name: "Discard PDF observation synthesis",
      exact: true,
    })
    .click();
  await view.waitFor({ state: "hidden" });
  await page
    .getByRole("region", { name: "Researcher PDF observations", exact: true })
    .waitFor();
  assert.equal(
    (await call(root + "/analysis")).analysis.pdfObservationSynthesis,
    undefined,
  );
  assert.deepEqual(errors, []);
  console.log(
    "Mobile PDF observation synthesis draft, exact note/correction citations, explicit human review edits, persisted attribution, source links, narrow-screen layout and discard passed.",
  );
} finally {
  await browser?.close();
  await stop();
}
