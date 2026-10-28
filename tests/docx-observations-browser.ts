import { seed } from "./image-review-fixture";
import { chromium, type Browser } from "playwright";
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { dataDirectory } from "./harness";
import { docxMime } from "../src/lib/participant-docx";
import { start, stop, base } from "./harness";
import { participantDOCXGuide, sampleDOCX } from "./participant-docx-fixture";
let browser: Browser | undefined;
try {
  await start({ port: 3249 });
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
    name: "DOCX appendix reviewer",
    email: randomUUID() + "@example.test",
    password: "docx-appendix-test-password",
  });
  let s = (
    await call("studies", "POST", { title: "Verified document feedback" })
  ).study;
  const root = "studies/" + s.id;
  s = (
    await call(root, "PUT", {
      version: s.version,
      guide: participantDOCXGuide(),
    })
  ).study;
  s = (await call(root + "/publish", "POST", { version: s.version })).study;
  await call(root + "/fielding", "POST", { state: "active" });
  const r = await call("public/" + s.id, "POST", { consent: true }),
    ip = "interviews/" + r.interview.id,
    headers = { "x-interview-token": r.token };
  const saved = await call(
    ip + "/participant-docx",
    "POST",
    await sampleDOCX(),
    {
      ...headers,
      "content-type": docxMime,
      "x-upload-id": randomUUID(),
      "x-interview-version": "0",
      "x-docx-description": "Synthetic two-paragraph evidence DOCX",
      "x-docx-consent": "yes",
    },
  );
  await call(
    ip + "/answer",
    "POST",
    {
      version: 0,
      requestId: randomUUID(),
      answer: "The document illustrates the workflow.",
      participantDOCXId: saved.docx.id,
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
  const snapshotSha256 = createHash("sha256")
    .update(await readFile(path.join(dataDirectory(), "media", saved.docx.id)))
    .digest("hex");
  await seed(r, (i) => {
    i.turns[0].docxProbe = {
      docxId: saved.docx.id,
      status: "asked",
      probe: "How does Save draft before review. help?",
      paragraph: 2,
      quote: "Save draft before review.",
      model: "synthetic-fixture",
      snapshotSha256,
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
      name: "Researcher DOCX review",
      exact: true,
    }),
    include = review.getByRole("checkbox", {
      name: "Include DOCX notes and corrections in analysis and report appendices",
      exact: true,
    });
  await review.getByText("DOCX not reviewed", { exact: true }).waitFor();
  assert.equal(await include.isChecked(), false);
  await review
    .getByLabel("DOCX quality", { exact: true })
    .selectOption("usable");
  await review
    .getByLabel("DOCX review notes", { exact: true })
    .fill("Researcher observation: the second paragraph is readable.");
  await review
    .getByLabel("DOCX question grounding", { exact: true })
    .selectOption("unsupported");
  await review
    .getByLabel("Researcher correction", { exact: true })
    .fill(
      "Researcher correction: ask about the document without assuming success.",
    );
  await include.check();
  await review
    .getByRole("button", { name: "Save DOCX review", exact: true })
    .click();
  await review
    .getByText("Saved DOCX review · revision 1", { exact: true })
    .waitFor();
  await page.reload();
  await page
    .getByRole("button", { name: "Participant 1", exact: true })
    .click();
  await review
    .getByText("Saved DOCX review · revision 1", { exact: true })
    .waitFor();
  assert.equal(await include.isChecked(), true);
  await page.goto(base + "/?study=" + s.id + "&tab=analysis");
  await page
    .getByRole("button", { name: "Create evidence memo", exact: true })
    .click();
  const appendix = page.getByRole("region", {
    name: "Researcher DOCX observations",
    exact: true,
  });
  await appendix
    .getByText(
      /Researcher correction: ask about the document without assuming success/,
    )
    .waitFor();
  await appendix.getByText(/Reviewer: DOCX appendix reviewer/).waitFor();
  await appendix.getByText(/Question grounding: Unsupported/).waitFor();
  await appendix
    .getByRole("button", { name: "View DOCX text", exact: true })
    .click();
  await appendix
    .locator("mark")
    .getByText("Save draft before review.", { exact: true })
    .waitFor();
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
      title: "Researcher DOCX annotation report",
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
    .getByText("Saved DOCX review · revision 1", { exact: true })
    .waitFor();
  assert.equal(await include.isChecked(), true);
  await include.uncheck();
  await review
    .getByRole("button", { name: "Save DOCX review", exact: true })
    .click();
  await review
    .getByText("Saved DOCX review · revision 2", { exact: true })
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
    "Mobile opt-in DOCX annotations, saved inclusion reload, separate attributed analysis/report appendices, original question/paragraph, private highlighted source text, source links and withdrawal invalidation passed.",
  );
} finally {
  await browser?.close();
  await stop();
}
