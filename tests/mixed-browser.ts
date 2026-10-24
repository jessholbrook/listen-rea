import { chromium, type Browser } from "playwright";
import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { start, stop, base } from "./harness";
import { mixedGuide } from "./mixed-fixture";
let browser: Browser | undefined;
try {
  await start();
  browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_PATH || "/usr/bin/chromium",
    headless: true,
    args: ["--no-sandbox"],
  });
  const researcher = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
  });
  const page = await researcher.newPage();
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await researcher.request.post(base + "/api/auth/signup", {
    data: {
      name: "Mixed Browser",
      email: "mixed-browser@example.test",
      password: "mixed-browser-password",
    },
  });
  let s = (
    await (
      await researcher.request.post(base + "/api/studies", {
        data: { title: "Mixed browser study" },
      })
    ).json()
  ).study;
  s = (
    await (
      await researcher.request.put(base + "/api/studies/" + s.id, {
        data: { guide: mixedGuide(), version: s.version },
      })
    ).json()
  ).study;
  await page.goto(base + "/?study=" + s.id + "&tab=guide");
  await page.getByLabel("Question type").selectOption("multiple");
  await page.getByLabel("Randomize item order per participant").check();
  await page.getByRole("button", { name: /How useful is the process/ }).click();
  await page.getByLabel("Minimum", { exact: true }).fill("0");
  await page.getByLabel("Maximum", { exact: true }).fill("10");
  await page
    .getByRole("button", { name: /Rank the tools you selected/ })
    .click();
  await page.getByLabel("Carry forward options").selectOption("source");
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  await page.getByText("Draft saved", { exact: true }).waitFor();
  s = (
    await (await researcher.request.get(base + "/api/studies/" + s.id)).json()
  ).study;
  s = (
    await (
      await researcher.request.post(
        base + "/api/studies/" + s.id + "/publish",
        { data: { version: s.version } },
      )
    ).json()
  ).study;
  await researcher.request.post(base + "/api/studies/" + s.id + "/fielding", {
    data: { state: "active" },
  });
  const participant = await browser.newContext({
      viewport: { width: 390, height: 844 },
    }),
    p = await participant.newPage();
  p.on("pageerror", (e) => errors.push(e.message));
  await p.goto(base + "/s/" + s.id);
  await p.getByRole("checkbox").check();
  await p.getByRole("button", { name: "Let’s begin" }).click();
  await p.getByRole("checkbox", { name: "A", exact: true }).check();
  await p.getByRole("checkbox", { name: "B", exact: true }).check();
  await p.getByRole("button", { name: "Continue", exact: true }).click();
  await p.getByRole("radio", { name: "0", exact: true }).check();
  await p.getByRole("button", { name: "Continue", exact: true }).click();
  await p.getByLabel("Add the next item").selectOption("b");
  await p.reload();
  await p.getByLabel("Add the next item").waitFor();
  assert.equal(
    await p.getByLabel("Add the next item").locator("option").count(),
    3,
    "Carry-forward options must survive refresh",
  );
  assert.equal(
    await p.getByRole("button", { name: "Continue", exact: true }).isDisabled(),
    true,
    "Unranked default order must not submit",
  );
  await p.getByLabel("Add the next item").selectOption("b");
  await p.getByLabel("Add the next item").selectOption("a");
  await p.getByRole("button", { name: "Move 2 up" }).click();
  await p.getByRole("button", { name: "Move 1 down" }).click();
  await p.getByRole("button", { name: "Continue", exact: true }).click();
  await p.getByLabel("SPEED", { exact: true }).selectOption("1");
  await p.getByLabel("CLARITY", { exact: true }).selectOption("5");
  mkdirSync("test-results", { recursive: true });
  await p.screenshot({
    path: "test-results/mixed-matrix-mobile.png",
    fullPage: true,
  });
  assert.ok(
    await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
  );
  await p.getByRole("button", { name: "Continue", exact: true }).click();
  await p.getByRole("checkbox", { name: "C", exact: true }).check();
  await p.getByRole("button", { name: "Continue", exact: true }).click();
  await p.getByRole("button", { name: "Continue", exact: true }).click();
  await p.getByRole("heading", { name: /Thank/ }).waitFor();
  await page.goto(base + "/?study=" + s.id + "&tab=analysis");
  await page
    .getByRole("heading", { name: "Ratings, rankings & selections" })
    .waitFor();
  await page.getByText("0 mean rating", { exact: false }).waitFor();
  assert.ok((await page.getByText("B", { exact: true }).count()) > 0);
  await page.screenshot({
    path: "test-results/mixed-results-desktop.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  assert.ok(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  );
  assert.deepEqual(errors, []);
  console.log(
    "Mixed-method browser checks passed: editor controls, multiple select, zero rating, explicit ranking/reorder, resume, matrix, carry-forward, computed results and responsive layouts.",
  );
} catch (e) {
  console.error(e);
  process.exitCode = 1;
} finally {
  await browser?.close();
  await stop();
}
