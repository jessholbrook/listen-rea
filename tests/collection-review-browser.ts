import { chromium, type Browser } from "playwright";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { start, stop, base } from "./harness";
import { transcriptSetup } from "./library-transcript-answers-fixture";
import { collectionLabels } from "../src/lib/library-collections";
import { dashboardLabels } from "../src/lib/collection-review";
import { libraryAnswerLabels } from "../src/lib/library-answers";
let browser: Browser | undefined;
try {
  await start({ port: 3375 });
  const c = await transcriptSetup(),
    collections: any[] = [];
  for (const language of ["en", "es", "fr"] as const) {
    const collection = (
      await c.owner("library/collections", "POST", {
        requestId: randomUUID(),
        title: "Synthetic review dashboard " + language,
        interviewIds: c.imports.map((i) => i.interviewId),
        briefIds: [],
      })
    ).collection;
    const asked = await c.ask({
      collectionId: collection.id,
      studyIds: [c.imports[0].s.id],
    });
    collections.push({
      collection,
      answerId: asked.result.savedAnswerId,
      language,
    });
  }
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
  assert.ok(
    (
      await context.request.post(base + "/api/auth/login", {
        data: { email: c.email, password: "saved-library-password" },
      })
    ).ok(),
  );
  await page.goto(base);
  await page
    .getByRole("button", { name: "Research library", exact: true })
    .click();
  await page.getByRole("button", { name: "Collections", exact: true }).click();
  let previous = "en" as "en" | "es" | "fr";
  for (const { collection, answerId, language } of collections) {
    const l = dashboardLabels[language as "en"],
      a = libraryAnswerLabels[language as "en"];
    await page
      .getByLabel(collectionLabels[previous].language, { exact: true })
      .selectOption(language);
    previous = language;
    await page
      .locator(`[data-collection-id="${collection.id}"]`)
      .getByRole("button", { name: l.open, exact: true })
      .click();
    const panel = page.getByRole("region", { name: l.title, exact: true });
    await panel.locator(`[data-dashboard-answer="${answerId}"]`).waitFor();
    assert.equal(
      await panel
        .getByRole("button", { name: l.check, exact: true })
        .isDisabled(),
      true,
    );
    assert.ok((await panel.innerText()).includes("0/2"));
    await panel.getByRole("checkbox", { name: l.attest, exact: true }).check();
    await panel.getByRole("button", { name: l.check, exact: true }).click();
    await panel.getByText(l.saved, { exact: true }).waitFor();
    assert.equal(
      await panel
        .getByRole("checkbox", { name: l.attest, exact: true })
        .isChecked(),
      false,
    );
    assert.equal(
      (await c.owner("library/answers/" + answerId)).answer.history.at(-1)
        .reviewed,
      false,
    );
    await panel
      .locator(`[data-dashboard-answer="${answerId}"]`)
      .getByRole("button", { name: l.openAnswer, exact: true })
      .click();
    const modal = page.getByRole("dialog", { name: a.open, exact: true });
    await modal
      .getByRole("checkbox", { name: a.reviewed, exact: true })
      .check();
    await modal.getByRole("checkbox", { name: a.include, exact: true }).check();
    await modal.getByRole("button", { name: a.update, exact: true }).click();
    await page.waitForFunction(
      (label) =>
        Array.from(document.querySelectorAll("button")).some(
          (b) => b.textContent === label && !b.disabled,
        ),
      a.markdown,
    );
    await modal
      .getByRole("button", { name: "Close dialog", exact: true })
      .click();
    await panel
      .locator(`[data-dashboard-answer="${answerId}"]`)
      .getByText(l.approved, { exact: false })
      .waitFor();
    assert.ok((await panel.innerText()).includes("1/2"));
    if (language === "en") {
      // A source changed after the checkbox was selected: stale attestation cannot overwrite the checkpoint.
      await panel
        .getByRole("checkbox", { name: l.attest, exact: true })
        .check();
      const i = await c.local.get<any>(
        "interview",
        c.imports[0].interviewId,
        c.actor.workspaceId,
      );
      await c.local.put("interview", {
        ...i,
        version: i.version + 1,
        turns: i.turns.map((t: any) => ({
          ...t,
          answer: t.answer + " MARKED_SOURCE_CHANGE",
        })),
      });
      await panel.getByRole("button", { name: l.check, exact: true }).click();
      await panel.getByRole("alert").waitFor();
      await panel.getByRole("button", { name: l.refresh, exact: true }).click();
      await panel
        .getByRole("checkbox", { name: l.attest, exact: true })
        .waitFor();
      assert.equal(
        await panel
          .getByRole("checkbox", { name: l.attest, exact: true })
          .isChecked(),
        false,
      );
      const d = (
        await c.owner(`library/collections/${collection.id}/dashboard`)
      ).dashboard;
      assert.equal(d.changes.changed, 1);
      assert.equal(d.answers.length, 0);
      // Other pre-created answers depended on this source; recreate their marked drafts for the next language flows.
      for (const next of collections.filter((x) => x.language !== "en")) {
        const asked = await c.ask({
          collectionId: next.collection.id,
          studyIds: [c.imports[0].s.id],
        });
        next.answerId = asked.result.savedAnswerId;
      }
    }
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth + 1,
      ),
      true,
    );
    await page.screenshot({
      path: `test-results/collection-review-${language}.png`,
      fullPage: true,
    });
    await panel.getByRole("button", { name: l.close, exact: true }).click();
  }
  assert.deepEqual(errors, []);
  console.log(
    "EN/ES/FR mobile dashboard coverage, explicit source checks, direct single-answer review/approval, refreshed counts, stale-attestation rejection, changed-source visibility and layout passed.",
  );
} finally {
  await browser?.close();
  await stop();
}
