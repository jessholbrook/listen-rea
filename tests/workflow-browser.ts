import { chromium, type Browser } from "playwright";
import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { start, stop, base } from "./harness";
let browser: Browser | undefined;
let debugPage: import("playwright").Page | undefined;
try {
  await start();
  browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_PATH || "/usr/bin/chromium",
    headless: true,
    args: ["--no-sandbox"],
  });
  const context = await browser.newContext({
      viewport: { width: 1440, height: 1050 },
    }),
    page = await context.newPage(),
    errors: string[] = [];
  debugPage = page;
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("dialog", (d) => d.accept());
  await context.request.post(base + "/api/auth/signup", {
    data: {
      name: "Workflow Browser",
      email: "workflow-browser@example.test",
      password: "workflow-browser-password",
    },
  });
  await page.goto(base);
  await page
    .getByRole("button", { name: "Study resources", exact: true })
    .click();
  const modal = page.getByRole("dialog", { name: "Study resources" });
  await modal.getByLabel("New folder", { exact: true }).fill("Learning team");
  await modal
    .getByRole("button", { name: "Create folder", exact: true })
    .click();
  await modal.getByText("Folder created.", { exact: true }).waitFor();
  await modal
    .getByLabel("Default audience", { exact: true })
    .fill("Internal product research teams");
  await modal
    .getByLabel("Default participant introduction", { exact: true })
    .fill(
      "We want to understand your recent research experience. You can stop at any time.",
    );
  await modal
    .getByLabel("Default participant limit", { exact: true })
    .fill("8");
  await modal
    .getByLabel("Research guidelines", { exact: true })
    .fill("Use plain language and recent examples.");
  await modal
    .getByRole("button", { name: "Save defaults", exact: true })
    .click();
  await modal
    .getByText("Defaults saved for future studies.", { exact: true })
    .waitFor();
  await modal
    .getByRole("button", { name: "Close dialog", exact: true })
    .click();
  await page.getByRole("button", { name: "New study", exact: true }).click();
  await page
    .getByRole("dialog")
    .getByLabel("Study name", { exact: true })
    .fill("Workflow browser study");
  await page.getByRole("button", { name: "Create study", exact: true }).click();
  await page.getByText("Draft saved", { exact: true }).waitFor();
  const studyId = new URL(page.url()).searchParams.get("study")!;
  let s = (
    await (await context.request.get(base + "/api/studies/" + studyId)).json()
  ).study;
  assert.equal(s.draft.limit, 8);
  assert.equal(s.draft.audience, "Internal product research teams");
  assert.equal(s.researchGuidelines, "Use plain language and recent examples.");
  await page.getByRole("button", { name: "Workflow", exact: true }).click();
  await page
    .getByLabel("Study folder", { exact: true })
    .selectOption({ label: "Learning team" });
  await page.getByText("Study moved.", { exact: true }).waitFor();
  await page
    .getByLabel("Audience name", { exact: true })
    .fill("Recent feedback participants");
  await page
    .getByRole("button", { name: "Save audience", exact: true })
    .click();
  await page
    .getByText("Audience saved to the workspace library.", { exact: true })
    .waitFor();
  await page
    .getByRole("button", { name: "Review audience", exact: true })
    .click();
  await page
    .getByRole("dialog", { name: "Review audience addition" })
    .getByRole("button", { name: "Add audience to draft", exact: true })
    .click();
  await page
    .getByText(
      "Audience added to the draft. Review screeners before publishing.",
      { exact: true },
    )
    .waitFor();
  s = (
    await (await context.request.get(base + "/api/studies/" + studyId)).json()
  ).study;
  assert.equal(s.draft.questions.length, 9);
  s = (
    await (
      await context.request.post(base + `/api/studies/${studyId}/publish`, {
        data: { version: s.version },
      })
    ).json()
  ).study;
  const published = s.revisionId;
  await page.reload();
  const original = page
    .locator(".workflow-row")
    .filter({ hasText: "Draft v1 · created" });
  await original
    .getByRole("button", { name: "Review snapshot", exact: true })
    .click();
  const review = page.getByRole("dialog", { name: "Review guide restore" });
  await review
    .getByText("Routing and stimulus details", { exact: true })
    .click();
  await review
    .getByRole("button", { name: "Restore as new draft", exact: true })
    .click();
  await page
    .getByText("Snapshot restored as a new draft. Published guide unchanged.", {
      exact: true,
    })
    .waitFor();
  s = (
    await (await context.request.get(base + "/api/studies/" + studyId)).json()
  ).study;
  assert.equal(s.draft.questions.length, 8);
  assert.equal(s.revisionId, published);
  await page.getByRole("button", { name: "Study design", exact: true }).click();
  await page
    .getByRole("button", { name: /Tell me about the last product decision/ })
    .click();
  await page
    .getByLabel("Question wording")
    .fill("Don't you agree this is useful? And why?");
  await page
    .getByRole("region", { name: "Study advisor" })
    .getByText(/may suggest a preferred answer/)
    .waitFor();
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  await page.getByText("Draft saved", { exact: true }).waitFor();
  await page.getByRole("button", { name: "Workflow", exact: true }).click();
  mkdirSync("test-results", { recursive: true });
  await page.screenshot({
    path: "test-results/workflow-desktop.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({
    path: "test-results/workflow-mobile.png",
    fullPage: true,
  });
  assert.ok(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  );
  await page.getByRole("button", { name: "All studies", exact: true }).click();
  await page
    .getByLabel("Filter by folder", { exact: true })
    .selectOption({ label: "Learning team" });
  await page.getByRole("button", { name: /Workflow browser study/ }).waitFor();
  assert.deepEqual(errors, []);
  console.log(
    "Workflow browser passed: folder organization, defaults, study creation, audience review, history restore, advisor and mobile layout.",
  );
} catch (e) {
  mkdirSync("test-results", { recursive: true });
  await debugPage?.screenshot({
    path: "test-results/workflow-failure.png",
    fullPage: true,
  });
  console.error((await debugPage?.locator("body").innerText())?.slice(-6500));
  console.error(e);
  process.exitCode = 1;
} finally {
  await browser?.close();
  await stop();
}
