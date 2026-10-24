import { chromium, type Browser } from "playwright";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { start, stop, base } from "./harness";
import { transcriptSetup } from "./library-transcript-answers-fixture";
import { libraryAnswerLabels } from "../src/lib/library-answers";
import { transcriptAnswerLabels } from "../src/lib/library-transcript-answers";
import { briefLabels } from "../src/lib/library-briefs";
let browser: Browser | undefined;
try {
  await start({ port: 3357 });
  const c = await transcriptSetup();
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
  page.on("dialog", (d) => d.accept());
  assert.ok(
    (
      await context.request.post(base + "/api/auth/login", {
        data: { email: c.email, password: "saved-library-password" },
      })
    ).ok(),
  );
  await page.route("**/api/library", async (route) => {
    const r = await route.fetch();
    await route.fulfill({
      response: r,
      json: { ...(await r.json()), ai: true },
    });
  });
  await page.route("**/api/library/qa", async (route) => {
    const asked = await c.ask(route.request().postDataJSON());
    await route.fulfill({ json: asked.result });
  });
  await page.goto(base);
  await page
    .getByRole("button", { name: "Research library", exact: true })
    .click();
  for (const i of c.imports)
    await page.getByRole("checkbox", { name: i.s.title, exact: true }).check();
  for (const language of ["en", "es", "fr"] as const) {
    const l = libraryAnswerLabels[language],
      t = transcriptAnswerLabels[language];
    await page
      .getByLabel("Answer language", { exact: true })
      .selectOption(language);
    await page
      .getByLabel("Research question", { exact: true })
      .fill("What do draft review and invoices describe? " + language);
    await page.getByRole("button", { name: l.save, exact: true }).click();
    await page.getByText(l.saved, { exact: true }).waitFor();
    const saved = page.getByRole("region", { name: t.title, exact: true });
    const row = saved.locator("[data-saved-answer-id]").filter({
      hasText: "What do draft review and invoices describe? " + language,
    });
    await row.getByRole("button", { name: l.open, exact: true }).click();
    let modal = page.getByRole("dialog");
    await modal.waitFor();
    assert.ok((await modal.innerText()).includes("Participant:"));
    assert.ok((await modal.innerText()).includes(t.turn));
    assert.equal(
      await modal
        .getByRole("button", { name: l.markdown, exact: true })
        .isDisabled(),
      true,
    );
    await modal
      .getByLabel(l.answer, { exact: true })
      .fill("=REVIEWED_TRANSCRIPT_" + language);
    await modal
      .getByRole("checkbox", { name: l.reviewed, exact: true })
      .check();
    await modal.getByRole("checkbox", { name: l.include, exact: true }).check();
    await modal.getByRole("button", { name: l.update, exact: true }).click();
    for (const format of ["md", "csv"] as const) {
      const waiting = page.waitForEvent("download");
      await modal
        .getByRole("button", {
          name: format === "md" ? l.markdown : l.csv,
          exact: true,
        })
        .click();
      const d = await waiting,
        text = await readFile((await d.path())!, "utf8");
      assert.ok(text.includes("REVIEWED_TRANSCRIPT_" + language));
      assert.ok(text.includes(t.warning));
      assert.ok(text.includes("Participant:"));
      assert.ok(text.includes("?study="));
      assert.equal(text.includes("MARKED_TRANSCRIPT_ORIGINAL"), false);
    }
    const sourceButton = modal.getByRole("button", {
      name:
        language === "en"
          ? "Open current evidence"
          : language === "es"
            ? "Abrir evidencia actual"
            : "Ouvrir la source actuelle",
      exact: true,
    });
    // Use the existing localized attachment-source action label shared by the review component.
    const labels = (await import("../src/lib/library-attachments"))
      .libraryAttachmentLabels[language];
    await modal
      .getByRole("button", { name: labels.source, exact: true })
      .first()
      .click();
    await modal
      .getByRole("button", { name: labels.response, exact: true })
      .click();
    await page
      .getByRole("dialog")
      .getByText(c.imports[0].transcript, { exact: true })
      .or(
        page
          .getByRole("dialog")
          .getByText(c.imports[1].transcript, { exact: true }),
      )
      .first()
      .waitFor();
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Close dialog", exact: true })
      .click();
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth + 1,
      ),
      false,
    );
  }
  await page
    .getByRole("button", { name: "Research briefs", exact: true })
    .click();
  const b = briefLabels.en,
    region = page.getByRole("region", { name: b.title, exact: true });
  await region.getByRole("button", { name: b.create, exact: true }).click();
  await region
    .getByLabel(b.name, { exact: true })
    .fill("Mixed transcript and document brief");
  await region
    .getByRole("checkbox", {
      name: new RegExp("What do draft review and invoices describe\\? fr · v"),
    })
    .check();
  await region
    .getByRole("checkbox", {
      name: new RegExp("What does draft review show\\? 0 · v"),
    })
    .check();
  await region.getByRole("button", { name: b.save, exact: true }).click();
  await region.getByText(b.saved, { exact: true }).waitFor();
  assert.ok((await region.innerText()).includes("REVIEWED_TRANSCRIPT_fr"));
  assert.ok((await region.innerText()).includes("APPROVED_FINDING_0"));
  await region.getByRole("checkbox", { name: b.reviewed, exact: true }).check();
  await region.getByRole("checkbox", { name: b.approve, exact: true }).check();
  await region.getByRole("button", { name: b.save, exact: true }).click();
  await region.getByText(b.saved, { exact: true }).waitFor();
  const wait = page.waitForEvent("download");
  await region.getByRole("button", { name: b.csv, exact: true }).click();
  const d = await wait,
    text = await readFile((await d.path())!, "utf8");
  assert.ok(
    text.includes("REVIEWED_TRANSCRIPT_fr") &&
      text.includes("APPROVED_FINDING_0"),
  );
  assert.equal(text.includes("MARKED_TRANSCRIPT_ORIGINAL"), false);
  const transcriptSection = region
    .locator("[data-brief-answer-id]")
    .filter({ hasText: "REVIEWED_TRANSCRIPT_fr" });
  await transcriptSection
    .getByRole("button", { name: b.source, exact: true })
    .first()
    .click();
  await page.getByRole("dialog").waitFor();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Close dialog", exact: true })
    .click();
  const uncited = c.imports[1];
  await c.owner(
    "studies/" + uncited.s.id + "/responses/" + uncited.interviewId,
    "DELETE",
  );
  assert.equal(
    (await c.local.list<any>("libraryAnswer", c.actor.workspaceId)).filter(
      (s) => s.scope === "transcripts",
    ).length,
    0,
  );
  assert.equal(
    (await c.local.list("libraryBrief", c.actor.workspaceId)).length,
    0,
  );
  await region.getByRole("button", { name: b.refresh, exact: true }).click();
  await region.getByRole("alert").waitFor();
  assert.equal(await page.locator("[data-brief-answer-id]").count(), 0);
  assert.deepEqual(errors, []);
  console.log(
    "EN/ES/FR mobile transcript draft save, exact speaker/turn citations, immutable reviews, approved text/CSV downloads, current/full source drilldown, mixed briefs and uncited-source erasure passed (marked generators).",
  );
} finally {
  await browser?.close();
  await stop();
}
