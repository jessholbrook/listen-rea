import { seed } from "./image-review-fixture";
import { chromium, type Browser } from "playwright";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { start, stop, base } from "./harness";
import { participantPDFGuide, samplePDF } from "./participant-pdfs-fixture";
let browser: Browser | undefined;
try {
  await start({ port: 3202 });
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
  const appendix = page.getByRole("region", {
    name: "Researcher PDF observations",
    exact: true,
  });
  await appendix
    .getByText(
      /Researcher correction: ask about the document without assuming success/,
    )
    .waitFor();
  await appendix.getByText(/Reviewer: PDF appendix reviewer/).waitFor();
  await appendix.getByText(/Question grounding: Unsupported/).waitFor();
  await appendix.getByRole("button", { name: "View PDF", exact: true }).click();
  await appendix.getByRole("img", { name: "Page 2", exact: true }).waitFor();
  await page.waitForFunction(() => {
    const c = document.querySelector(
      '[aria-label="Researcher PDF observations"] canvas',
    ) as HTMLCanvasElement;
    return (
      c?.width > 0 &&
      c
        .getContext("2d")!
        .getImageData(0, 0, c.width, c.height)
        .data.some((v, n) => n % 4 === 0 && v < 200)
    );
  });
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth,
    ),
    false,
  );
  let a = (await call(root + "/analysis")).analysis;
  a = (await call(root + "/analysis", "PUT", { ...a, reviewed: true }))
    .analysis;
  const e = (
    await call(root + "/reporting/editions", "POST", {
      analysisId: a.id,
      title: "Researcher PDF annotation report",
    })
  ).edition;
  await page.goto(base + "/?study=" + s.id + "&tab=reporting");
  await appendix
    .getByText(
      /Researcher correction: ask about the document without assuming success/,
    )
    .waitFor();
  await appendix.getByRole("link").click();
  await review
    .getByText("Saved PDF review · revision 1", { exact: true })
    .waitFor();
  assert.equal(await include.isChecked(), true);
  await include.uncheck();
  await review
    .getByRole("button", { name: "Save PDF review", exact: true })
    .click();
  await review
    .getByText("Saved PDF review · revision 2", { exact: true })
    .waitFor();
  assert.equal((await call(root + "/analysis")).analysis, null);
  assert.equal(
    (
      await context.request.get(
        base + "/api/" + root + "/reporting/editions/" + e.id,
      )
    ).status(),
    404,
  );
  assert.deepEqual(errors, []);
  console.log(
    "Mobile opt-in PDF annotations, saved inclusion reload, separate attributed analysis/report appendices, original question/page, actual private page pixels, source links and withdrawal invalidation passed.",
  );
} finally {
  await browser?.close();
  await stop();
}
