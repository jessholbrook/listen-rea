import { chromium, type Browser } from "playwright";
import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { start, stop, base } from "./harness";
import { emotionInterview } from "./emotion-fixture";
import { copy } from "../src/lib/participant-copy";
import { emotionCopy } from "../src/lib/emotion";
let browser: Browser | undefined;
try {
  await start();
  browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_PATH || "/usr/bin/chromium",
    args: ["--no-sandbox"],
  });
  const context = await browser.newContext({
      viewport: { width: 1440, height: 1000 },
    }),
    page = await context.newPage(),
    errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const call = async (
    path: string,
    method = "GET",
    data?: unknown,
    headers?: Record<string, string>,
  ) => {
    const r = await context.request.fetch(base + "/api/" + path, {
      method,
      data,
      headers,
    });
    assert.ok(r.ok(), await r.text());
    return r.json();
  };
  await call("auth/signup", "POST", {
    name: "Feeling browser",
    email: "feeling-browser@example.test",
    password: "feeling-browser-password",
  });
  let study = (await call("studies", "POST", { title: "Experience feelings" }))
    .study;
  study.draft.questions = [
    { ...emotionInterview().guide.questions[0], type: "open" },
  ];
  study = (
    await call(`studies/${study.id}`, "PUT", {
      guide: study.draft,
      version: study.version,
    })
  ).study;
  await page.goto(base + `/?study=${study.id}&tab=guide`);
  await page
    .getByLabel("Question type", { exact: true })
    .selectOption("emotion");
  await page
    .getByLabel("Question wording")
    .fill("How did this experience make you feel?");
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  await page.getByText("Draft saved", { exact: true }).waitFor();
  await page
    .getByRole("button", { name: "Publish revision", exact: true })
    .click();
  study = (await call(`studies/${study.id}`)).study;
  // A second optional check-in exercises the ordered source view.
  study.draft.questions.push({
    ...study.draft.questions[0],
    id: "after",
    text: "How do you feel about the next step?",
  });
  study = (
    await call(`studies/${study.id}`, "PUT", {
      guide: study.draft,
      version: study.version,
    })
  ).study;
  study = (
    await call(`studies/${study.id}/publish`, "POST", {
      version: study.version,
    })
  ).study;
  await call(`studies/${study.id}/fielding`, "POST", { state: "active" });
  const participant = await browser.newContext({
      viewport: { width: 390, height: 844 },
    }),
    p = await participant.newPage();
  p.on("pageerror", (e) => errors.push(e.message));
  await p.goto(base + `/s/${study.id}?segment=Team`);
  await p.getByRole("checkbox").check();
  await p.getByRole("button", { name: "Let’s begin", exact: true }).click();
  await p.getByRole("radio", { name: "Frustrated", exact: true }).check();
  await p.getByLabel("Intensity (optional)", { exact: true }).selectOption("2");
  await p
    .getByLabel("In your own words (optional)", { exact: true })
    .fill("The wait was longer than I expected.");
  mkdirSync("test-results", { recursive: true });
  await p.screenshot({
    path: "test-results/feeling-participant-mobile.png",
    fullPage: true,
  });
  assert.ok(
    await p.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth + 1,
    ),
  );
  await p.getByRole("button", { name: "Continue", exact: true }).click();
  await p
    .getByRole("heading", {
      name: "How do you feel about the next step?",
      exact: true,
    })
    .waitFor();
  await p.getByRole("radio", { name: "Confident", exact: true }).check();
  await p.getByRole("button", { name: "Continue", exact: true }).click();
  await p
    .getByText("Your perspective makes a difference.", { exact: true })
    .waitFor();
  const saved = await p.evaluate(
    (id) => JSON.parse(localStorage.getItem("study-session:" + id)!),
    study.id,
  );
  const completed = (
    await call(`interviews/${saved.id}`, "GET", undefined, {
      "x-interview-token": saved.token,
    })
  ).interview;
  assert.equal(completed.turns[0].emotion.feeling, "frustrated");
  assert.equal(completed.turns[1].emotion.intensity, null);
  // Declining clears an unsent note and intensity before saving.
  const declinedContext = await browser.newContext({
    viewport: { width: 390, height: 844 },
  });
  const d = await declinedContext.newPage();
  d.on("pageerror", (e) => errors.push(e.message));
  await d.goto(base + `/s/${study.id}`);
  await d.getByRole("checkbox").check();
  await d.getByRole("button", { name: "Let’s begin", exact: true }).click();
  await d.getByRole("radio", { name: "Happy", exact: true }).check();
  await d
    .getByLabel("In your own words (optional)", { exact: true })
    .fill("Discard this draft");
  await d.getByLabel("Intensity (optional)", { exact: true }).selectOption("3");
  await d
    .getByRole("radio", { name: "Prefer not to answer", exact: true })
    .check();
  assert.equal(await d.getByRole("textbox").count(), 0);
  await d.getByRole("button", { name: "Continue", exact: true }).click();
  await d
    .getByRole("heading", {
      name: "How do you feel about the next step?",
      exact: true,
    })
    .waitFor();
  await d
    .getByRole("radio", { name: "Prefer not to answer", exact: true })
    .check();
  await d.getByRole("button", { name: "Continue", exact: true }).click();
  await d
    .getByText("Your perspective makes a difference.", { exact: true })
    .waitFor();
  const joined = await call("public/" + study.id, "POST", {
    consent: true,
    attributes: { segment: "Solo" },
  });
  let second = joined.interview;
  for (const value of [
    ["neutral", "", ""],
    ["curious", "1", ""],
  ])
    second = (
      await call(
        `interviews/${second.id}/answer`,
        "POST",
        { requestId: randomUUID(), version: second.version, answer: "", value },
        { "x-interview-token": joined.token },
      )
    ).interview;
  await page.goto(base + `/?study=${study.id}&tab=emotions`);
  await page
    .getByRole("heading", { name: "Self-reported feelings", exact: true })
    .waitFor();
  await page
    .getByText(/2 reported \/ 3 completed · 1 declined/)
    .first()
    .waitFor();
  assert.equal(
    await page.getByText(/2 reported \/ 3 completed · 1 declined/).count(),
    2,
  );
  await page
    .getByRole("button", { name: "Frustrated", exact: true })
    .first()
    .click();
  await page.getByText("Original check-ins (1)", { exact: true }).click();
  await page
    .getByRole("button", { name: "Inspect feeling source", exact: true })
    .first()
    .click();
  const modal = page.getByRole("dialog");
  await modal.getByText(/The wait was longer than I expected/).waitFor();
  assert.equal(
    await modal.getByText("Method: self-report-v1", { exact: true }).count(),
    2,
  );
  await modal
    .getByRole("button", { name: "Close dialog", exact: true })
    .click();
  await page.getByLabel("Segment attribute", { exact: true }).fill("segment");
  await page.getByLabel("Exact segment value", { exact: true }).fill("Solo");
  await page
    .getByRole("button", { name: "Apply feeling filters", exact: true })
    .click();
  await page
    .getByText(/1 reported \/ 1 completed · 0 declined/)
    .first()
    .waitFor();
  await page.getByLabel("Segment attribute", { exact: true }).fill("");
  await page
    .getByRole("button", { name: "Apply feeling filters", exact: true })
    .click();
  await page
    .getByText(/2 reported \/ 3 completed · 1 declined/)
    .first()
    .waitFor();
  const href = await page
    .getByRole("link", { name: "Export feeling sources", exact: true })
    .getAttribute("href");
  const exported = await context.request.get(base + href);
  assert.ok((await exported.text()).includes(completed.turns[0].id));
  assert.ok(!(await exported.text()).includes("Discard this draft"));
  await page.screenshot({
    path: "test-results/feeling-results-desktop.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({
    path: "test-results/feeling-results-mobile.png",
    fullPage: true,
  });
  assert.ok(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth + 1,
    ),
  );
  for (const language of ["es", "fr"] as const) {
    let localized = (
      await call("studies", "POST", { title: "Localized feelings" })
    ).study;
    localized.draft = emotionInterview().guide;
    localized.draft.localization = {
      sourceLanguage: language,
      reportingLanguage: "en",
      guidance: "",
      translations: [],
    };
    localized.draft.questions[0].text =
      language === "es"
        ? "¿Cómo te sientes con esta experiencia?"
        : "Que ressentez-vous face à cette expérience ?";
    localized = (
      await call(`studies/${localized.id}`, "PUT", {
        guide: localized.draft,
        version: localized.version,
      })
    ).study;
    localized = (
      await call(`studies/${localized.id}/publish`, "POST", {
        version: localized.version,
      })
    ).study;
    await call(`studies/${localized.id}/fielding`, "POST", { state: "active" });
    const lp = await participant.newPage();
    lp.on("pageerror", (e) => errors.push(e.message));
    await lp.goto(base + `/s/${localized.id}?language=${language}`);
    await lp.getByRole("checkbox").check();
    await lp
      .getByRole("button", { name: copy(language, "Let’s begin"), exact: true })
      .click();
    await lp
      .getByRole("radio", {
        name: emotionCopy(language).labels.prefer_not_to_answer,
        exact: true,
      })
      .check();
    await lp
      .getByRole("button", { name: copy(language, "Continue"), exact: true })
      .click();
    await lp
      .getByText(copy(language, "Your perspective makes a difference."), {
        exact: true,
      })
      .waitFor();
    const results = (
      await call(`studies/${localized.id}/emotions?language=${language}`)
    ).results;
    assert.equal(results[0].counts.declined, 1);
    assert.equal(results[0].rows[0].percent, null);
  }
  assert.deepEqual(errors, []);
  console.log(
    "Feeling browser passed: editor, optional selection/intensity/note, decline clears drafts, source chronology, denominators, filters, exports, EN/ES/FR controls and mobile layout.",
  );
} finally {
  await browser?.close();
  await stop();
}
