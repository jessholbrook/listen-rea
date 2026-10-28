import { createClient } from "@libsql/client";
import path from "node:path";
import { dataDirectory } from "./harness";
import { seed } from "./image-review-fixture";
import { chromium, type Browser } from "playwright";
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { pptxMime } from "../src/lib/participant-pptx";
import { start, stop, base } from "./harness";
import { participantPPTXGuide, samplePPTX } from "./participant-pptx-fixture";
import { pptxObservationQALabels } from "../src/lib/pptx-observation-qa";
import { pptxObservationSynthesisLabels } from "../src/lib/pptx-observation-synthesis";
import { pptxObservationAnswerLabels } from "../src/lib/pptx-observation-answers";
const language = (process.env.RESEARCH_TEST_LANGUAGE || "en") as
  "en" | "es" | "fr";
const qaLabels = pptxObservationQALabels[language],
  synthesisLabels = pptxObservationSynthesisLabels[language],
  answerLabels = pptxObservationAnswerLabels[language];
let browser: Browser | undefined;
try {
  await start({ port: 3336 });
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
    name: "PPTX appendix reviewer",
    email: randomUUID() + "@example.test",
    password: "pptx-appendix-test-password",
  });
  let s = (
    await call("studies", "POST", { title: "Verified document feedback" })
  ).study;
  const root = "studies/" + s.id;
  s = (
    await call(root, "PUT", {
      version: s.version,
      guide: (() => {
        const g: any = participantPPTXGuide();
        g.localization = {
          sourceLanguage: "en",
          reportingLanguage: language,
          guidance: "",
          translations: [],
        };
        return g;
      })(),
    })
  ).study;
  s = (await call(root + "/publish", "POST", { version: s.version })).study;
  await call(root + "/fielding", "POST", { state: "active" });
  const r = await call("public/" + s.id, "POST", { consent: true }),
    ip = "interviews/" + r.interview.id,
    headers = { "x-interview-token": r.token };
  const saved = await call(
    ip + "/participant-pptx",
    "POST",
    await samplePPTX(),
    {
      ...headers,
      "content-type": pptxMime,
      "x-upload-id": randomUUID(),
      "x-interview-version": "0",
      "x-pptx-description": "Synthetic two-slide evidence PPTX",
      "x-pptx-consent": "yes",
    },
  );
  await call(
    ip + "/answer",
    "POST",
    {
      version: 0,
      requestId: randomUUID(),
      answer: "The document illustrates the workflow.",
      participantPPTXId: saved.pptx.id,
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
    .update(await readFile(path.join(dataDirectory(), "media", saved.pptx.id)))
    .digest("hex");
  await seed(r, (i) => {
    i.turns[0].pptxProbe = {
      pptxId: saved.pptx.id,
      status: "asked",
      probe: "How does Save draft before review. help?",
      slide: 2,
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
      name: "Researcher PPTX review",
      exact: true,
    }),
    include = review.getByRole("checkbox", {
      name: "Include PPTX notes and corrections in analysis and report appendices",
      exact: true,
    });
  await review.getByText("PPTX not reviewed", { exact: true }).waitFor();
  assert.equal(await include.isChecked(), false);
  await review
    .getByLabel("PPTX quality", { exact: true })
    .selectOption("usable");
  await review
    .getByLabel("PPTX review notes", { exact: true })
    .fill("Researcher observation: the second page is readable.");
  await review
    .getByLabel("PPTX question grounding", { exact: true })
    .selectOption("unsupported");
  await review
    .getByLabel("Researcher correction", { exact: true })
    .fill(
      "Researcher correction: ask about the document without assuming success.",
    );
  await include.check();
  await review
    .getByRole("button", { name: "Save PPTX review", exact: true })
    .click();
  await review
    .getByText("Saved PPTX review · revision 1", { exact: true })
    .waitFor();
  await page.reload();
  await page
    .getByRole("button", { name: "Participant 1", exact: true })
    .click();
  await review
    .getByText("Saved PPTX review · revision 1", { exact: true })
    .waitFor();
  assert.equal(await include.isChecked(), true);
  await page.goto(base + "/?study=" + s.id + "&tab=analysis");
  await page
    .getByRole("button", { name: "Create evidence memo", exact: true })
    .click();
  const panel = page.getByRole("region", {
    name: qaLabels.title,
    exact: true,
  });
  await panel.waitFor();
  let a = (await call(root + "/analysis")).analysis;
  const e = a.pptxObservations[0];
  const synthesisDraft = {
    findings: [
      {
        title: "Neutral wording needs review",
        description:
          "A researcher recommends removing assumptions about success.",
        citations: [
          {
            pptxId: e.pptxId,
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
    "**/api/studies/*/pptx-observation-synthesis",
    async (route) => {
      if (route.request().method() !== "POST") return route.continue();
      const input = route.request().postDataJSON();
      assert.equal(input.id, a.id);
      assert.equal(input.version, a.version);
      a = {
        ...a,
        version: a.version + 1,
        reviewed: false,
        pptxObservationSynthesis: synthesisDraft,
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
    name: "PPTX observation synthesis controls",
    exact: true,
  });
  await synthesisControls
    .getByRole("button", {
      name: "Synthesize PPTX observations with AI",
      exact: true,
    })
    .click();
  const synthesisView = page.getByRole("region", {
    name: synthesisLabels.title,
    exact: true,
  });
  await synthesisView
    .getByText("Draft · review required", { exact: true })
    .waitFor();
  await synthesisControls
    .getByLabel("PPTX observation synthesis finding 1 interpretation", {
      exact: true,
    })
    .fill(
      "The reviewer recommends neutral wording; participant experiences require separate evidence.",
    );
  await synthesisControls.getByRole("checkbox").check();
  await synthesisControls
    .getByRole("button", {
      name: "Save PPTX observation synthesis review",
      exact: true,
    })
    .click();
  await synthesisView.getByText("Reviewed", { exact: true }).waitFor();
  a = (await call(root + "/analysis")).analysis;
  assert.equal(a.pptxObservationSynthesis.reviewed, true);
  const original = {
    question: "What wording change was recommended?",
    answer: "Private original generated answer sentinel",
    citations: [
      {
        pptxId: e.pptxId,
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
  await page.route("**/api/studies/*/pptx-observation-qa", async (route) => {
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
    a = { ...a, version: a.version + 1, pptxObservationAnswers: [saved] };
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
    .getByLabel(qaLabels.question, { exact: true })
    .fill(original.question);
  await panel.getByRole("button", { name: qaLabels.ask, exact: true }).click();
  const ephemeral = page.getByRole("region", {
    name: qaLabels.answer,
    exact: true,
  });
  await ephemeral
    .getByText("Ephemeral neutral wording recommendation.", { exact: true })
    .waitFor();
  assert.equal(
    (await call(root + "/analysis")).analysis.pptxObservationAnswers,
    undefined,
  );
  await ephemeral
    .getByRole("button", { name: qaLabels.clear, exact: true })
    .click();
  await ephemeral.waitFor({ state: "hidden" });
  await panel
    .getByRole("button", {
      name: "Ask and save PPTX answer draft",
      exact: true,
    })
    .click();
  const answerPanel = page.getByRole("region", {
    name: "Saved PPTX observation answers",
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
      name: "Include this reviewed PPTX answer in report appendices",
      exact: true,
    });
  assert.equal(await answerReview.isChecked(), false);
  assert.equal(await answerInclude.isChecked(), false);
  assert.equal(await answerInclude.isDisabled(), true);
  await answerPanel
    .getByLabel("Saved PPTX answer", { exact: true })
    .fill("Reviewed neutral wording recommendation for the synthetic study.");
  await answerReview.check();
  await answerInclude.check();
  await answerPanel
    .getByRole("button", { name: "Save PPTX answer review", exact: true })
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
      title: "Reviewed PPTX Q&A report",
    })
  ).edition;
  await page.goto(base + "/?study=" + s.id + "&tab=reporting");
  const appendix = page.getByRole("region", {
    name: answerLabels.title,
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
    .getByRole("button", { name: "Save PPTX answer review", exact: true })
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
    .getByRole("button", { name: "Delete saved PPTX answer", exact: true })
    .click();
  await answerPanel.waitFor({ state: "hidden" });
  page.once("dialog", (d) => d.accept());
  await synthesisControls
    .getByRole("button", {
      name: "Discard PPTX observation synthesis",
      exact: true,
    })
    .click();
  await synthesisView.waitFor({ state: "hidden" });
  assert.equal(
    (await call(root + "/analysis")).analysis.pptxObservationSynthesis,
    undefined,
  );
  a = (await call(root + "/analysis")).analysis;
  holdAnswer = true;
  const waiting = new Promise<void>((resolve) => {
    requestStarted = resolve;
  });
  await panel
    .getByLabel(qaLabels.question, { exact: true })
    .fill(original.question);
  await panel.getByRole("button", { name: qaLabels.ask, exact: true }).click();
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
      answer: "Stale PPTX annotation answer must not appear.",
    },
  });
  await page.waitForLoadState("networkidle");
  assert.equal(
    await page
      .getByText("Stale PPTX annotation answer must not appear.", {
        exact: true,
      })
      .count(),
    0,
  );
  assert.deepEqual(errors, []);
  console.log(
    "Mobile " +
      language +
      " combined PPTX synthesis generation/review, ephemeral Q&A, explicit saved draft, reload, separate review/inclusion, immutable original/history, attributed report projection, source links, withdrawal and deletion passed.",
  );
} finally {
  await browser?.close();
  await stop();
}
