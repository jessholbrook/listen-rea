import { chromium, type Browser, type Locator } from "playwright";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { start, stop, base } from "./harness";
import { transcriptSetup } from "./library-transcript-answers-fixture";
import { collectionLabels } from "../src/lib/library-collections";
import { dashboardLabels } from "../src/lib/collection-review";
import { handoffLabels } from "../src/lib/collection-handoff";
import { feedbackLabels } from "../src/lib/handoff-feedback";
async function disabled(locator: Locator) {
  for (let attempt = 0; attempt < 50; attempt++) {
    if (await locator.isDisabled()) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  assert.equal(await locator.isDisabled(), true);
}
let browser: Browser | undefined;
try {
  await start({ port: 3387 });
  const c = await transcriptSetup(),
    groups = [];
  const reviewer = {
    id: randomUUID(),
    email: randomUUID() + "@example.test",
    password: "feedback-browser-password",
    name: "Synthetic team reviewer",
  };
  await c.local.db
    .prepare(
      "INSERT INTO users(id,email,name,password,workspace_id,role) VALUES(?,?,?,?,?,?)",
    )
    .run(
      reviewer.id,
      reviewer.email,
      reviewer.name,
      c.local.passwordHash(reviewer.password),
      c.actor.workspaceId,
      "researcher",
    );
  for (const language of ["en", "es", "fr"] as const) {
    const collection = (
      await c.owner("library/collections", "POST", {
        requestId: randomUUID(),
        title: "Synthetic internal review " + language,
        interviewIds: c.imports.map((i) => i.interviewId),
        briefIds: [],
      })
    ).collection;
    const path = `library/collections/${collection.id}/handoff`;
    assert.equal(
      (
        await c.owner(path, "POST", {
          requestId: randomUUID(),
          title: "Internal review packet " + language,
          summary: "SYNTHETIC_REVIEW_SUMMARY",
          language,
          answerIds: [],
          taskIds: [],
        })
      ).status,
      201,
    );
    groups.push({ collection, path, language });
  }
  browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_PATH || "/usr/bin/chromium",
    args: ["--no-sandbox"],
  });
  const errors: string[] = [];
  const ownerContext = await browser.newContext({
      viewport: { width: 390, height: 844 },
    }),
    reviewerContext = await browser.newContext({
      viewport: { width: 390, height: 844 },
    });
  for (const [context, email, password] of [
    [ownerContext, c.email, "saved-library-password"],
    [reviewerContext, reviewer.email, reviewer.password],
  ] as const)
    assert.ok(
      (
        await context.request.post(base + "/api/auth/login", {
          data: { email, password },
        })
      ).ok(),
    );
  const owner = await ownerContext.newPage(),
    person = await reviewerContext.newPage();
  for (const page of [owner, person]) {
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto(base);
    await page
      .getByRole("button", { name: "Research library", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Collections", exact: true })
      .click();
  }
  let previous = "en" as "en" | "es" | "fr";
  for (const g of groups) {
    const l = handoffLabels[g.language],
      f = feedbackLabels[g.language],
      d = dashboardLabels[g.language];
    for (const page of [owner, person]) {
      await page
        .getByLabel(collectionLabels[previous].language, { exact: true })
        .selectOption(g.language);
      await page
        .locator(`[data-collection-id="${g.collection.id}"]`)
        .getByRole("button", { name: d.open, exact: true })
        .click();
    }
    previous = g.language;
    const panel = owner.getByRole("region", { name: l.title, exact: true }),
      feedback = panel.getByRole("region", { name: f.title, exact: true });
    const otherPanel = person.getByRole("region", {
        name: l.title,
        exact: true,
      }),
      other = otherPanel.getByRole("region", { name: f.title, exact: true });
    await feedback
      .getByRole("checkbox", { name: reviewer.name, exact: true })
      .check();
    await disabled(
      panel.getByRole("checkbox", { name: l.attest, exact: true }),
    );
    await feedback.getByRole("button", { name: f.assign, exact: true }).click();
    await panel.getByText(f.saved, { exact: true }).waitFor();
    await disabled(
      panel.getByRole("checkbox", { name: l.attest, exact: true }),
    );
    await feedback
      .getByLabel(f.comment, { exact: true })
      .fill("PRIVATE_BROWSER_FEEDBACK <script>bad()</script>");
    await disabled(panel.getByLabel(l.summary, { exact: true }));
    await feedback.getByRole("button", { name: f.add, exact: true }).click();
    await feedback
      .getByText("PRIVATE_BROWSER_FEEDBACK <script>bad()</script>", {
        exact: true,
      })
      .waitFor();
    await otherPanel
      .getByRole("button", { name: l.refresh, exact: true })
      .click();
    await other
      .getByText("PRIVATE_BROWSER_FEEDBACK <script>bad()</script>", {
        exact: true,
      })
      .waitFor();
    await disabled(other.getByRole("button", { name: f.approve, exact: true }));
    await feedback
      .getByRole("button", { name: f.resolve, exact: true })
      .click();
    await feedback
      .getByRole("button", { name: f.reopen, exact: true })
      .waitFor();
    await otherPanel
      .getByRole("button", { name: l.refresh, exact: true })
      .click();
    await other.getByRole("button", { name: f.approve, exact: true }).click();
    await other
      .getByRole("button", { name: f.withdraw, exact: true })
      .waitFor();
    await panel.getByRole("button", { name: l.refresh, exact: true }).click();
    await feedback.getByText(f.ready, { exact: true }).waitFor();
    await feedback.screenshot({
      path: `test-results/handoff-feedback-review-${g.language}.png`,
    });
    await disabled(panel.getByRole("button", { name: l.md, exact: true }));
    await panel.getByRole("checkbox", { name: l.attest, exact: true }).check();
    await panel.getByRole("button", { name: l.approve, exact: true }).click();
    await panel.getByText(l.reviewed, { exact: true }).waitFor();
    const download = owner.waitForEvent("download");
    await panel.getByRole("button", { name: l.md, exact: true }).click();
    const file = await download,
      path = await file.path();
    assert.ok(path);
    const text = readFileSync(path!, "utf8");
    assert.ok(text.includes("SYNTHETIC_REVIEW_SUMMARY"));
    assert.equal(text.includes("PRIVATE_BROWSER_FEEDBACK"), false);
    await panel
      .getByLabel(l.summary, { exact: true })
      .fill("SYNTHETIC_REVISED_SUMMARY");
    await disabled(feedback.getByLabel(f.comment, { exact: true }));
    await panel.getByRole("button", { name: l.save, exact: true }).click();
    await panel.getByText(l.saved, { exact: true }).waitFor();
    await disabled(
      panel.getByRole("checkbox", { name: l.attest, exact: true }),
    );
    await otherPanel
      .getByRole("button", { name: l.refresh, exact: true })
      .click();
    await other.getByRole("button", { name: f.approve, exact: true }).click();
    await other
      .getByRole("button", { name: f.withdraw, exact: true })
      .waitFor();
    await panel.getByRole("button", { name: l.refresh, exact: true }).click();
    await feedback.getByRole("button", { name: f.reopen, exact: true }).click();
    await feedback
      .getByRole("button", { name: f.resolve, exact: true })
      .waitFor();
    await disabled(
      panel.getByRole("checkbox", { name: l.attest, exact: true }),
    );
    owner.once("dialog", (dialog) => void dialog.accept());
    await feedback.getByRole("button", { name: f.remove, exact: true }).click();
    await feedback.getByText(f.none, { exact: true }).waitFor();
    assert.equal(
      await owner.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth + 1,
      ),
      true,
    );
    assert.equal(
      await feedback.evaluate(
        (e) => e.getBoundingClientRect().right <= innerWidth + 1,
      ),
      true,
    );
    await owner.screenshot({
      path: `test-results/handoff-feedback-${g.language}.png`,
      fullPage: true,
    });
    for (const page of [owner, person])
      await page
        .getByRole("region", { name: d.title, exact: true })
        .getByRole("button", { name: d.close, exact: true })
        .click();
  }
  assert.deepEqual(errors, []);
  console.log(
    "EN/ES/FR mobile named-reviewer assignment, two-user comments/approval, resolution/reopening/deletion, draft guards, current final approval and private-comment-free actual downloads passed.",
  );
} finally {
  await browser?.close();
  await stop();
}
