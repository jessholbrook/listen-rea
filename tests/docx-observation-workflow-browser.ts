import { createClient } from "@libsql/client";
import path from "node:path";
import { dataDirectory } from "./harness";
import { seed } from "./image-review-fixture";
import { chromium, type Browser } from "playwright";
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { docxMime } from "../src/lib/participant-docx";
import { start, stop, base } from "./harness";
import { participantDOCXGuide, sampleDOCX } from "./participant-docx-fixture";
let browser: Browser | undefined;
try {
  await start({ port: 3256 });
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
  await page.route("**/api/me", async (route) => {
    const response = await route.fetch();
    await route.fulfill({
      response,
      json: { ...(await response.json()), ai: true },
    });
  });
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
    .fill("Researcher observation: the second page is readable.");
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
  const panel = page.getByRole("region", {
    name: "Ask about researcher DOCX observations",
    exact: true,
  });
  await panel.waitFor();
  let a = (await call(root + "/analysis")).analysis;
  const e = a.docxObservations[0];
  const synthesisDraft = {
    findings: [
      {
        title: "Neutral wording needs review",
        description:
          "A researcher recommends removing assumptions about success.",
        citations: [
          {
            docxId: e.docxId,
            reviewVersion: e.reviewVersion,
            field: "correction",
            quote: "ask about the document without assuming success",
          },
        ],
      },
    ],
    limitations:
      "Selected researcher observations do not verify participant experiences or document facts.",
    model: "synthetic-browser-fixture",
    promptVersion: "synthetic-browser-fixture",
    generatedAt: new Date().toISOString(),
    reviewed: false,
  };
  await page.route(
    "**/api/studies/*/docx-observation-synthesis",
    async (route) => {
      if (route.request().method() !== "POST") return route.continue();
      const input = route.request().postDataJSON();
      assert.equal(input.id, a.id);
      assert.equal(input.version, a.version);
      a = {
        ...a,
        version: a.version + 1,
        reviewed: false,
        docxObservationSynthesis: synthesisDraft,
      };
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
      await route.fulfill({ status: 200, json: { analysis: a, stale: false } });
    },
  );
  const synthesisControls = page.getByRole("region", {
    name: "DOCX observation synthesis controls",
    exact: true,
  });
  await synthesisControls
    .getByRole("button", {
      name: "Synthesize DOCX observations with AI",
      exact: true,
    })
    .click();
  const synthesisView = page.getByRole("region", {
    name: "Synthesis of researcher DOCX observations",
    exact: true,
  });
  await synthesisView
    .getByText("Draft · review required", { exact: true })
    .waitFor();
  await synthesisControls
    .getByLabel("DOCX observation synthesis finding 1 interpretation", {
      exact: true,
    })
    .fill(
      "The reviewer recommends neutral wording; participant experiences require separate evidence.",
    );
  await synthesisControls.getByRole("checkbox").check();
  await synthesisControls
    .getByRole("button", {
      name: "Save DOCX observation synthesis review",
      exact: true,
    })
    .click();
  await synthesisView.getByText("Reviewed", { exact: true }).waitFor();
  a = (await call(root + "/analysis")).analysis;
  assert.equal(a.docxObservationSynthesis.reviewed, true);
  const original = {
    question: "What wording change was recommended?",
    answer: "Private original generated answer sentinel",
    citations: [
      {
        docxId: e.docxId,
        reviewVersion: e.reviewVersion,
        field: "correction",
        quote: "ask about the document without assuming success",
      },
    ],
    model: "synthetic-browser-fixture",
    promptVersion: "synthetic-browser-fixture",
    generatedAt: new Date().toISOString(),
  };
  let holdAnswer = false,
    pendingAnswer: any,
    requestStarted!: () => void;
  await page.route("**/api/studies/*/docx-observation-qa", async (route) => {
    const input = route.request().postDataJSON();
    assert.equal(input.id, a.id);
    assert.equal(input.version, a.version);
    if (holdAnswer) {
      pendingAnswer = route;
      requestStarted();
      return;
    }
    if (!input.saveDraft) {
      await route.fulfill({
        status: 200,
        json: {
          ...original,
          answer: "Ephemeral neutral wording recommendation.",
        },
      });
      return;
    }
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
    a = { ...a, version: a.version + 1, docxObservationAnswers: [saved] };
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
    .getByLabel("Your DOCX observation question", { exact: true })
    .fill(original.question);
  await panel
    .getByRole("button", { name: "Ask about DOCX observations", exact: true })
    .click();
  const ephemeral = page.getByRole("region", {
    name: "AI answer about researcher annotations",
    exact: true,
  });
  await ephemeral
    .getByText("Ephemeral neutral wording recommendation.", { exact: true })
    .waitFor();
  assert.equal(
    (await call(root + "/analysis")).analysis.docxObservationAnswers,
    undefined,
  );
  await ephemeral
    .getByRole("button", { name: "Clear DOCX observation answer", exact: true })
    .click();
  await ephemeral.waitFor({ state: "hidden" });
  await panel
    .getByRole("button", {
      name: "Ask and save DOCX answer draft",
      exact: true,
    })
    .click();
  const answerPanel = page.getByRole("region", {
    name: "Saved DOCX observation answers",
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
      name: "Include this reviewed DOCX answer in report appendices",
      exact: true,
    });
  assert.equal(await answerReview.isChecked(), false);
  assert.equal(await answerInclude.isChecked(), false);
  assert.equal(await answerInclude.isDisabled(), true);
  await answerPanel
    .getByLabel("Saved DOCX answer", { exact: true })
    .fill("Reviewed neutral wording recommendation for the synthetic study.");
  await answerReview.check();
  await answerInclude.check();
  await answerPanel
    .getByRole("button", { name: "Save DOCX answer review", exact: true })
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
      title: "Reviewed DOCX Q&A report",
    })
  ).edition;
  await page.goto(base + "/?study=" + s.id + "&tab=reporting");
  const appendix = page.getByRole("region", {
    name: "Reviewed DOCX observation Q&A",
    exact: true,
  });
  await appendix.getByText(/Reviewed neutral wording recommendation/).waitFor();
  await synthesisView.getByText("Reviewed", { exact: true }).waitFor();
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
    .getByRole("button", { name: "Save DOCX answer review", exact: true })
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
    .getByRole("button", { name: "Delete saved DOCX answer", exact: true })
    .click();
  await answerPanel.waitFor({ state: "hidden" });
  page.once("dialog", (d) => d.accept());
  await synthesisControls
    .getByRole("button", {
      name: "Discard DOCX observation synthesis",
      exact: true,
    })
    .click();
  await synthesisView.waitFor({ state: "hidden" });
  assert.equal(
    (await call(root + "/analysis")).analysis.docxObservationSynthesis,
    undefined,
  );
  a = (await call(root + "/analysis")).analysis;
  holdAnswer = true;
  const waiting = new Promise<void>((resolve) => {
    requestStarted = resolve;
  });
  await panel
    .getByLabel("Your DOCX observation question", { exact: true })
    .fill(original.question);
  await panel
    .getByRole("button", { name: "Ask about DOCX observations", exact: true })
    .click();
  await waiting;
  await page.getByRole("button", { name: /^Responses/ }).click();
  a = (await call(root + "/analysis", "PUT", { ...a, reviewed: false }))
    .analysis;
  await page
    .getByRole("button", { name: "Analysis & report", exact: true })
    .click();
  await panel.waitFor();
  await pendingAnswer.fulfill({
    status: 200,
    json: {
      ...original,
      answer: "Stale DOCX annotation answer must not appear.",
    },
  });
  await page.waitForLoadState("networkidle");
  assert.equal(
    await page
      .getByText("Stale DOCX annotation answer must not appear.", {
        exact: true,
      })
      .count(),
    0,
  );
  assert.deepEqual(errors, []);
  console.log(
    "Mobile combined DOCX synthesis generation/review, ephemeral Q&A, explicit saved draft, reload, separate review/inclusion, immutable original/history, attributed report projection, source links, withdrawal and deletion passed.",
  );
} finally {
  await browser?.close();
  await stop();
}
