import { chromium, type Browser, type Page } from "playwright";
import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { start, stop, base } from "./harness";
let browser: Browser | undefined, page: Page | undefined;
try {
  await start();
  browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_PATH || "/usr/bin/chromium",
    args: ["--no-sandbox"],
  });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
  });
  page = await context.newPage();
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await context.request.post(base + "/api/auth/signup", {
    data: {
      name: "Card Sort Browser",
      email: "cardsort-browser@example.test",
      password: "cardsort-browser-password",
    },
  });
  let study = (
    await (
      await context.request.post(base + "/api/studies", {
        data: { title: "Research navigation" },
      })
    ).json()
  ).study;
  study.draft.questions = [
    { ...study.draft.questions[1], id: "sort", followUps: 0 },
  ];
  study = (
    await (
      await context.request.put(base + `/api/studies/${study.id}`, {
        data: { guide: study.draft, version: study.version },
      })
    ).json()
  ).study;
  await page.goto(base + `/?study=${study.id}&tab=guide`);
  await page
    .getByLabel("Question type", { exact: true })
    .selectOption("cardsort");
  await page
    .getByLabel("Question wording")
    .fill("Group the research activities.");
  await page
    .getByLabel("Card sort card 1", { exact: true })
    .fill("Invite a teammate");
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  await page.getByText("Draft saved", { exact: true }).waitFor();
  await page
    .getByRole("button", { name: "Publish revision", exact: true })
    .click();
  await context.request.post(base + `/api/studies/${study.id}/fielding`, {
    data: { state: "active" },
  });
  const participant = await browser.newContext({
      viewport: { width: 390, height: 844 },
    }),
    p = await participant.newPage();
  p.on("pageerror", (e) => errors.push(e.message));
  await p.goto(base + "/s/" + study.id);
  await p.getByRole("checkbox").check();
  await p.getByRole("button", { name: "Let’s begin", exact: true }).click();
  await p
    .getByRole("button", { name: "Save sort draft", exact: true })
    .waitFor();
  const saved = await p.evaluate(
      (id) => JSON.parse(localStorage.getItem("study-session:" + id)!),
      study.id,
    ),
    headers = { "x-interview-token": saved.token };
  let i = (
    await (
      await participant.request.get(base + "/api/interviews/" + saved.id, {
        headers,
      })
    ).json()
  ).interview;
  const prompt = i.cardsortPrompt;
  await p
    .getByLabel(prompt.cards[0].text, { exact: true })
    .selectOption("group:" + prompt.groups[0].id);
  assert.equal(
    await p.getByRole("button", { name: "Continue", exact: true }).isEnabled(),
    false,
  );
  await p.getByRole("button", { name: "Save sort draft", exact: true }).click();
  await p
    .getByRole("status")
    .filter({ hasText: "Draft saved. You can resume these placements later." })
    .waitFor();
  await p.reload();
  await p
    .getByRole("button", { name: "Save sort draft", exact: true })
    .waitFor();
  assert.equal(
    await p.getByLabel(prompt.cards[0].text, { exact: true }).inputValue(),
    "group:" + prompt.groups[0].id,
  );
  // Revise the saved placement before confirming, and explicitly leave one card uncertain.
  await p
    .getByLabel(prompt.cards[0].text, { exact: true })
    .selectOption("group:" + prompt.groups[1].id);
  await p
    .getByLabel(prompt.cards[1].text, { exact: true })
    .selectOption("group:" + prompt.groups[0].id);
  await p
    .getByLabel(prompt.cards[2].text, { exact: true })
    .selectOption("unsure");
  await p.getByRole("button", { name: "Continue", exact: true }).click();
  await p
    .getByLabel("Your answer", { exact: true })
    .fill("I grouped activities by how my team works.");
  await p.getByRole("button", { name: "Continue", exact: true }).click();
  await p
    .getByText("Your perspective makes a difference.", { exact: true })
    .waitFor();
  assert.ok(
    await p.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth + 1,
    ),
  );
  i = (
    await (
      await participant.request.get(base + "/api/interviews/" + saved.id, {
        headers,
      })
    ).json()
  ).interview;
  assert.equal(i.turns.length, 2);
  assert.equal(
    i.turns[0].cardsort.assignments.find(
      (a: any) => a.cardId === prompt.cards[0].id,
    ).groupId,
    prompt.groups[1].id,
  );
  const next = await (
    await context.request.post(base + `/api/public/${study.id}`, {
      data: { consent: true },
    })
  ).json();
  let second = next.interview;
  second = (
    await (
      await context.request.post(base + `/api/interviews/${second.id}/answer`, {
        headers: { "x-interview-token": next.token },
        data: {
          requestId: randomUUID(),
          version: second.version,
          answer: "",
          value: second.cardsortPrompt.cards.map((card: any) => ({
            cardId: card.id,
            groupId: prompt.groups[0].id,
          })),
        },
      })
    ).json()
  ).interview;
  await context.request.post(base + `/api/interviews/${second.id}/answer`, {
    headers: { "x-interview-token": next.token },
    data: {
      requestId: randomUUID(),
      version: second.version,
      answer: "All activities belong together for me.",
    },
  });
  await page.goto(base + `/?study=${study.id}&tab=cardsort`);
  await page
    .getByRole("heading", { name: "Card-sort results", exact: true })
    .waitFor();
  await page
    .getByText("2 included · 0 incomplete · 0 not asked · 0 invalid", {
      exact: true,
    })
    .waitFor();
  await page
    .getByRole("button", {
      name: prompt.cards[2].text + " in Uncertain",
      exact: true,
    })
    .click();
  await page
    .getByText("Inspect 1 card-sort outcomes · selected cell", { exact: true })
    .waitFor();
  await page
    .getByRole("button", { name: "Inspect card-sort source", exact: true })
    .click();
  const modal = page.getByRole("dialog", {
    name: "Card-sort source",
    exact: true,
  });
  await modal.waitFor();
  assert.equal(await modal.locator("blockquote").count(), 2);
  await modal
    .getByText("I grouped activities by how my team works.", { exact: true })
    .waitFor();
  await page.getByRole("button", { name: "Close dialog", exact: true }).click();
  await page
    .getByRole("button", { name: "Show all card-sort outcomes", exact: true })
    .click();
  await page.getByText("Co-sorting matrix", { exact: true }).click();
  await page
    .getByRole("table")
    .filter({
      has: page.getByText("Same real group / both assigned", { exact: true }),
    })
    .waitFor();
  const csv = await context.request.get(
    base + `/api/studies/${study.id}/cardsort/export?kind=assignments`,
  );
  assert.ok(
    (await csv.text()).includes("I grouped activities by how my team works."),
  );
  mkdirSync("test-results", { recursive: true });
  await page.screenshot({
    path: "test-results/cardsort-desktop.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({
    path: "test-results/cardsort-mobile.png",
    fullPage: true,
  });
  assert.ok(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth + 1,
    ),
  );
  await page
    .getByLabel("Card-sort segment attribute", { exact: true })
    .fill("segment");
  await page
    .getByLabel("Card-sort exact segment value", { exact: true })
    .fill("Missing");
  await page
    .getByRole("button", { name: "Apply card-sort segment", exact: true })
    .click();
  await page.getByText(/No card-sort responses match this view/).waitFor();
  assert.deepEqual(errors, []);
  console.log(
    "Card-sort browser passed: configuration, mobile draft/save/reload/revision, explicit uncertainty, confirmation/reason, interactive assignment/co-sort tables, source quotes, CSV, segments and responsive layout.",
  );
} catch (e) {
  mkdirSync("test-results", { recursive: true });
  await page
    ?.screenshot({ path: "test-results/cardsort-failure.png", fullPage: true })
    .catch(() => {});
  throw e;
} finally {
  await browser?.close();
  await stop();
}
