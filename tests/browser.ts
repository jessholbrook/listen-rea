import { chromium, type Browser } from "playwright";
import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { start, stop, base } from "./harness";
let browser: Browser | undefined;
const errors: string[] = [];
try {
  await start();
  browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_PATH || "/usr/bin/chromium",
    headless: true,
    args: [
      "--no-sandbox",
      "--use-fake-ui-for-media-stream",
      "--use-fake-device-for-media-stream",
    ],
  });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1050 },
  });
  const page = await context.newPage();
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(base);
  await page.getByRole("button", { name: "Create your workspace" }).click();
  await page.getByLabel("Your name").fill("Research Tester");
  await page.getByLabel("Email address").fill("browser@example.test");
  await page
    .getByLabel("Password", { exact: true })
    .fill("browser-test-password");
  await page
    .getByRole("button", { name: "Create workspace", exact: true })
    .click();
  await page.getByRole("button", { name: "Create your first study" }).click();
  await page
    .getByLabel("Study name", { exact: true })
    .fill("From feedback to product decisions");
  await page
    .getByLabel("What do you want to learn?")
    .fill(
      "Understand how researchers turn conflicting customer feedback into decisions.",
    );
  await page.getByRole("button", { name: "Create study", exact: true }).click();
  await page
    .getByRole("heading", { name: "Shape your conversation" })
    .waitFor();
  const id = new URL(page.url()).searchParams.get("study")!;
  let data = await (await page.request.get(base + "/api/studies/" + id)).json();
  let g = data.study.draft;
  g.questions = g.questions.slice(0, 3);
  g.questions.forEach((q: any) => (q.followUps = 0));
  assert.equal(
    (
      await page.request.put(base + "/api/studies/" + id, {
        data: { guide: g, version: data.study.version },
      })
    ).status(),
    200,
  );
  await page.reload();
  await page.getByRole("button", { name: "Publish revision" }).click();
  await page.getByText("Draft saved", { exact: true }).waitFor();
  const popupPromise = page.waitForEvent("popup");
  await page.getByRole("button", { name: "Preview draft" }).click();
  const preview = await popupPromise;
  await preview.getByText("DRAFT PREVIEW", { exact: false }).waitFor();
  await preview.close();
  await page.getByRole("button", { name: "Fielding", exact: true }).click();
  await page.getByRole("button", { name: "Open fielding" }).click();
  await page.getByText("In the field", { exact: true }).waitFor();
  const pc = await browser.newContext({
    viewport: { width: 390, height: 844 },
    permissions: ["microphone"],
  });
  const participant = await pc.newPage();
  participant.on("pageerror", (e) => errors.push(e.message));
  await participant.goto(base + "/s/" + id);
  await participant.getByRole("checkbox").check();
  await participant.getByRole("button", { name: "Let’s begin" }).click();
  await participant.getByRole("radio", { name: "Yes", exact: true }).check();
  await participant
    .getByRole("button", { name: "Continue", exact: true })
    .click();
  await participant.getByRole("checkbox").check();
  await participant.getByRole("button", { name: "Record an answer" }).click();
  await participant.getByRole("button", { name: /Stop recording/ }).waitFor();
  await participant.waitForTimeout(1400);
  await participant.getByRole("button", { name: /Stop recording/ }).click();
  await participant.getByText("Recording saved", { exact: false }).waitFor();
  // Resume preserves the answer recording and interview version.
  await participant.reload();
  await participant
    .getByText("Recovered your saved recording", { exact: false })
    .waitFor();
  mkdirSync("test-results", { recursive: true });
  await participant.screenshot({
    path: "test-results/participant-mobile.png",
    fullPage: true,
  });
  assert.equal(
    await participant.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
    true,
  );
  await participant
    .getByLabel("Your answer", { exact: true })
    .fill(
      "We compared several customer interviews but had to move between three separate tools to find the evidence.",
    );
  await participant
    .getByRole("button", { name: "Continue", exact: true })
    .click();
  await participant
    .getByRole("heading", {
      name: "How did you gather the feedback for that decision?",
    })
    .waitFor();
  await participant
    .getByLabel("Your answer", { exact: true })
    .fill(
      "We invited recent customers to individual interviews and brought their answers together in a shared document.",
    );
  await participant
    .getByRole("button", { name: "Continue", exact: true })
    .click();
  await participant
    .getByRole("heading", { name: "Your perspective makes a difference." })
    .waitFor();
  await page.getByRole("button", { name: "Responses", exact: false }).click();
  await page.getByRole("button", { name: "Refresh", exact: true }).click();
  await page.getByRole("button", { name: "View transcript" }).click();
  await page
    .getByText(
      "We compared several customer interviews but had to move between three separate tools to find the evidence.",
      { exact: true },
    )
    .waitFor();
  assert.equal(await page.locator("audio").count(), 1);
  await page.getByRole("button", { name: "Close dialog" }).click();
  await page.getByRole("button", { name: "Analysis & report" }).click();
  await page.getByRole("button", { name: "Create evidence memo" }).click();
  await page.getByRole("button", { name: "Add theme" }).click();
  await page.getByLabel("Theme name").fill("Evidence is scattered");
  await page
    .getByLabel("What does the evidence suggest?")
    .fill("The participant had to combine evidence from several tools.");
  await page.getByLabel("Choose a source answer").selectOption({ index: 1 });
  await page.getByRole("button", { name: "Add this quote" }).click();
  await page.getByRole("button", { name: "Save theme" }).click();
  await page.getByRole("heading", { name: "Evidence is scattered" }).waitFor();
  await page.getByRole("button", { name: /View source/ }).click();
  await page.getByText("Complete answer", { exact: true }).waitFor();
  assert.equal(await page.locator("audio").count(), 1);
  await page.getByRole("button", { name: "Close dialog" }).click();
  await page
    .getByRole("button", { name: "Research memo", exact: true })
    .click();
  await page.getByRole("checkbox").check();
  await page.getByRole("button", { name: "Save memo", exact: true }).click();
  await page.getByText("Reviewed", { exact: true }).waitFor();
  await page.getByRole("button", { name: "Create view-only link" }).click();
  const report = await page
    .getByLabel("View-only report · expires in 7 days")
    .inputValue();
  const sharePage = await pc.newPage();
  await sharePage.goto(report);
  await sharePage.getByText("REVIEWED BY THE STUDY TEAM").waitFor();
  assert.ok(
    (await sharePage.locator(".memo").innerText()).includes(
      "Evidence is scattered",
    ),
  );
  await page.screenshot({
    path: "test-results/research-memo.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: "All studies", exact: true }).click();
  await page
    .getByRole("heading", { name: "A little curiosity goes a long way." })
    .waitFor();
  await page.screenshot({
    path: "test-results/workspace-desktop.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
    true,
  );
  await page.screenshot({
    path: "test-results/workspace-mobile.png",
    fullPage: true,
  });
  assert.deepEqual(errors, []);
  console.log(
    "Browser checks passed: signup, guide publication, preview isolation, fielding, mobile recording/resume, full interview, transcript/audio, manual coding, source drill-down, reviewed sharing, responsive layouts.",
  );
  console.log(
    "Screenshots saved in test-results/. Browser microphone used a synthetic test device; this does not validate human audio or provider quality.",
  );
} catch (e) {
  console.error(e);
  process.exitCode = 1;
} finally {
  await browser?.close();
  await stop();
}
