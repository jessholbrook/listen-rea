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
      name: "MaxDiff Browser",
      email: "maxdiff-browser@example.test",
      password: "maxdiff-browser-password",
    },
  });
  let study = (
    await (
      await context.request.post(base + "/api/studies", {
        data: { title: "Research priorities" },
      })
    ).json()
  ).study;
  study.draft.questions = [
    { ...study.draft.questions[1], id: "maxdiff", followUps: 0 },
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
    .selectOption("maxdiff");
  await page
    .getByLabel("Question wording")
    .fill("Which research features are most important?");
  await page.getByLabel("MaxDiff item 1", { exact: true }).fill("Fast setup");
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
  await p.getByRole("radio").first().waitFor();
  const saved = await p.evaluate(
      (id) => JSON.parse(localStorage.getItem("study-session:" + id)!),
      study.id,
    ),
    headers = { "x-interview-token": saved.token };
  for (let n = 0; n < 6; n++) {
    const i = (
      await (
        await participant.request.get(base + "/api/interviews/" + saved.id, {
          headers,
        })
      ).json()
    ).interview;
    if (i.status === "complete") break;
    const items = [...i.maxdiffPrompt.items].sort((a: any, b: any) =>
      a.text.localeCompare(b.text),
    );
    await p
      .getByRole("radio", {
        name: "Most important: " + items[0].text,
        exact: true,
      })
      .check();
    await p
      .getByRole("radio", {
        name: "Least important: " + items[0].text,
        exact: true,
      })
      .check();
    assert.equal(
      await p
        .getByRole("button", { name: "Continue", exact: true })
        .isEnabled(),
      false,
    );
    await p
      .getByRole("radio", {
        name: "Most important: " + items[0].text,
        exact: true,
      })
      .check();
    await p
      .getByRole("radio", {
        name: "Least important: " + items.at(-1).text,
        exact: true,
      })
      .check();
    const response = p.waitForResponse(
      (r) => r.url().endsWith("/answer") && r.request().method() === "POST",
    );
    await p.getByRole("button", { name: "Continue", exact: true }).click();
    assert.equal((await response).status(), 200);
    if (n === 0) {
      await p.reload();
      await p.getByRole("radio").first().waitFor();
    }
  }
  await p
    .getByText("Your perspective makes a difference.", { exact: true })
    .waitFor();
  assert.ok(
    await p.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth + 1,
    ),
  );
  const second = await (
    await context.request.post(base + `/api/public/${study.id}`, {
      data: { consent: true },
    })
  ).json();
  let i = second.interview;
  for (let n = 0; n < 6 && i.status === "active"; n++) {
    const ids = i.maxdiffPrompt.items.map((x: any) => x.id).sort();
    i = (
      await (
        await context.request.post(base + `/api/interviews/${i.id}/answer`, {
          headers: { "x-interview-token": second.token },
          data: {
            requestId: randomUUID(),
            version: i.version,
            answer: "",
            value: { best: ids[0], worst: ids.at(-1) },
          },
        })
      ).json()
    ).interview;
  }
  await page.goto(base + `/?study=${study.id}&tab=maxdiff`);
  await page
    .getByRole("heading", { name: "MaxDiff preferences", exact: true })
    .waitFor();
  await page
    .getByText(
      "2 included respondents · 8 completed tasks · 0 incomplete · 0 not asked · 0 invalid",
      { exact: true },
    )
    .waitFor();
  await page
    .getByRole("button", { name: "Fit pooled model", exact: true })
    .click();
  await page
    .getByRole("heading", { name: "Pooled best–worst logit", exact: true })
    .waitFor();
  assert.equal(await page.getByRole("progressbar").count(), 4);
  const download = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "Fit & export model CSV", exact: true })
    .click();
  assert.equal(
    (await download).suggestedFilename(),
    "maxdiff-pooled-model.csv",
  );
  await page.getByText("Inspect 2 response outcomes", { exact: true }).click();
  await page
    .getByRole("button", { name: "Inspect MaxDiff source", exact: true })
    .first()
    .click();
  const modal = page.getByRole("dialog", {
    name: "MaxDiff source",
    exact: true,
  });
  await modal.waitFor();
  assert.equal(await modal.locator("blockquote").count(), 4);
  await modal
    .getByText(/Most important:/)
    .first()
    .waitFor();
  await page.getByRole("button", { name: "Close dialog", exact: true }).click();
  mkdirSync("test-results", { recursive: true });
  await page.screenshot({
    path: "test-results/maxdiff-desktop.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({
    path: "test-results/maxdiff-mobile.png",
    fullPage: true,
  });
  assert.ok(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth + 1,
    ),
  );
  await page
    .getByLabel("MaxDiff segment attribute", { exact: true })
    .fill("segment");
  await page
    .getByLabel("MaxDiff exact segment value", { exact: true })
    .fill("Missing");
  await page
    .getByRole("button", { name: "Apply MaxDiff segment", exact: true })
    .click();
  await page.getByText(/No MaxDiff responses match this view/).waitFor();
  assert.deepEqual(errors, []);
  console.log(
    "MaxDiff browser passed: setup, mobile best/worst exclusivity, saved resume, pooled fitting/CSV, private task sources, exact segment and responsive layout.",
  );
} catch (e) {
  mkdirSync("test-results", { recursive: true });
  await page
    ?.screenshot({ path: "test-results/maxdiff-failure.png", fullPage: true })
    .catch(() => {});
  throw e;
} finally {
  await browser?.close();
  await stop();
}
