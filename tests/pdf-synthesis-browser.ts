import { createClient } from "@libsql/client";
import path from "node:path";
import { chromium, type Browser } from "playwright";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { start, stop, base, dataDirectory } from "./harness";
import { participantPDFGuide, samplePDF } from "./participant-pdfs-fixture";
let browser: Browser | undefined;
try {
  await start({ port: 3193 });
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
  await page.goto(base + "/?study=" + s.id + "&tab=responses");
  await page
    .getByRole("button", { name: "Participant 1", exact: true })
    .click();
  const text = page.getByRole("region", {
      name: "PDF text and verified passages",
      exact: true,
    }),
    include = text.getByRole("checkbox", {
      name: /Include this verified passage selection/,
    }),
    attest = text.getByRole("checkbox", { name: /I checked these passages/ });
  await text
    .getByRole("button", { name: "Extract PDF text", exact: true })
    .click();
  assert.equal(await include.isChecked(), false);
  await text.getByLabel("Extracted page", { exact: true }).selectOption("2");
  await text
    .getByLabel("Extracted PDF text", { exact: true })
    .evaluate((el: HTMLTextAreaElement) => {
      el.focus();
      el.setSelectionRange(0, el.value.length);
    });
  await text
    .getByRole("button", { name: "Add selected passage", exact: true })
    .click();
  await include.check();
  assert.equal(await attest.isChecked(), false);
  await attest.check();
  await text
    .getByRole("button", { name: "Save verified passages", exact: true })
    .click();
  await text
    .getByText("Saved verification · revision 1", { exact: true })
    .waitFor();
  await page.goto(base + "/?study=" + s.id + "&tab=analysis");
  await page
    .getByRole("button", { name: "Create evidence memo", exact: true })
    .click();

  let a = (await call(root + "/analysis")).analysis;
  const e = a.pdfEvidence[0],
    p = e.passages[0];
  const draft = {
    findings: [
      {
        title: "Synthetic document reference",
        description:
          "The selected excerpt identifies a synthetic research page.",
        citations: [
          {
            pdfId: e.pdfId,
            verificationVersion: e.verificationVersion,
            page: p.page,
            start: p.start,
            end: p.end,
            quote: p.quote,
          },
        ],
      },
    ],
    limitations:
      "Selected excerpts lack full context and independent verification.",
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
      args: [JSON.stringify({ ...a, pdfSynthesis: draft }), a.id],
    });
  } finally {
    sql.close();
  }
  await page.reload();
  const controls = page.getByRole("region", {
      name: "PDF synthesis controls",
      exact: true,
    }),
    view = page.getByRole("region", {
      name: "Synthesis of verified PDF passages",
      exact: true,
    });
  await view.getByText("Draft · review required", { exact: true }).waitFor();
  assert.equal(
    await controls
      .getByRole("button", { name: "Regenerate PDF synthesis", exact: true })
      .isDisabled(),
    true,
  );
  const checkbox = controls.getByRole("checkbox", {
    name: "I checked each interpretation against its cited PDF passages and reviewed the limitations.",
    exact: true,
  });
  assert.equal(await checkbox.isChecked(), false);
  await controls
    .getByLabel("PDF synthesis finding 1 interpretation", { exact: true })
    .fill(
      "The excerpt identifies the supplied synthetic PDF page; its wider context is unavailable.",
    );
  await checkbox.check();
  await controls
    .getByRole("button", { name: "Save PDF synthesis review", exact: true })
    .click();
  await view.getByText("Reviewed", { exact: true }).waitFor();
  await view.getByRole("button", { name: "PDF page 2", exact: true }).click();
  await view.getByRole("img", { name: "Page 2", exact: true }).waitFor();
  await page.waitForFunction(() => {
    const c = document.querySelector(
      '[aria-label="Synthesis of verified PDF passages"] canvas',
    ) as HTMLCanvasElement;
    return (
      c?.width > 0 &&
      c
        .getContext("2d")!
        .getImageData(0, 0, c.width, c.height)
        .data.some((v, n) => n % 4 === 0 && v < 200)
    );
  });
  a = (await call(root + "/analysis")).analysis;
  assert.equal(a.pdfSynthesis.reviewed, true);
  assert.equal(a.reviewed, false);
  await view.getByRole("link").click();
  await text
    .getByText("Saved verification · revision 1", { exact: true })
    .waitFor();
  a = (await call(root + "/analysis", "PUT", { ...a, reviewed: true }))
    .analysis;
  const edition = (
    await call(root + "/reporting/editions", "POST", {
      analysisId: a.id,
      title: "Reviewed PDF synthesis report",
    })
  ).edition;
  await page.goto(base + "/?study=" + s.id + "&tab=reporting");
  await view.getByText("Reviewed", { exact: true }).waitFor();
  await view
    .getByText("Synthetic document reference", { exact: true })
    .waitFor();
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth,
    ),
    false,
  );
  await page.goto(base + "/?study=" + s.id + "&tab=analysis");
  page.once("dialog", (d) => d.accept());
  await controls
    .getByRole("button", { name: "Discard PDF synthesis", exact: true })
    .click();
  await view.waitFor({ state: "hidden" });
  assert.equal(
    (await call(root + "/analysis")).analysis.pdfSynthesis,
    undefined,
  );
  assert.equal(
    (
      await context.request.get(
        base + "/api/" + root + "/reporting/editions/" + edition.id,
      )
    ).status(),
    404,
  );
  assert.deepEqual(errors, []);
  console.log(
    "Mobile PDF synthesis draft/review edits, exact citations and cited-page pixels, provenance, source links, report display and discard invalidation passed.",
  );
} finally {
  await browser?.close();
  await stop();
}
