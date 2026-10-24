import { chromium, type Browser } from "playwright";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { start, stop, base } from "./harness";
import { savedLibrarySetup } from "./library-answers-fixture";
import { libraryAnswerLabels } from "../src/lib/library-answers";
import { libraryAttachmentLabels } from "../src/lib/library-attachments";
let browser: Browser | undefined;
try {
  await start({ port: 3348 });
  const c = await savedLibrarySetup();
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
  const login = await context.request.post(base + "/api/auth/login", {
    data: { email: c.email, password: "saved-library-password" },
  });
  assert.ok(login.ok());
  await page.route("**/api/library", async (route) => {
    const r = await route.fetch();
    await route.fulfill({
      response: r,
      json: { ...(await r.json()), ai: true },
    });
  });
  await page.route("**/api/library/attachments/qa", async (route) => {
    const r = await c.ask(route.request().postDataJSON());
    await route.fulfill({ json: r.result });
  });
  await page.goto(base);
  await page
    .getByRole("button", { name: "Research library", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Attachment evidence", exact: true })
    .click();
  let previous = "en" as "en" | "es" | "fr";
  const waitEnabled = async (button: ReturnType<typeof page.getByRole>) => {
    for (let n = 0; n < 100 && (await button.isDisabled()); n++)
      await page.waitForTimeout(100);
    assert.equal(await button.isDisabled(), false);
  };
  for (const language of ["en", "es", "fr"] as const) {
    const l = libraryAnswerLabels[language],
      e = libraryAttachmentLabels[language];
    await page
      .getByRole("region", {
        name: libraryAttachmentLabels[previous].title,
        exact: true,
      })
      .getByLabel(libraryAttachmentLabels[previous].language, { exact: true })
      .selectOption(language);
    previous = language;
    await page
      .getByLabel(e.question, { exact: true })
      .fill("What does draft review show? " + language);
    await page.getByRole("button", { name: l.save, exact: true }).click();
    await page.getByText(l.saved, { exact: true }).waitFor();
    const section = page.getByRole("region", { name: l.title, exact: true });
    await section
      .getByText("What does draft review show? " + language, { exact: true })
      .waitFor();
    await section
      .getByRole("button", { name: l.open, exact: true })
      .first()
      .click();
    let modal = page.getByRole("dialog");
    await modal.waitFor();
    assert.equal(
      await modal
        .getByRole("button", { name: l.markdown, exact: true })
        .isDisabled(),
      true,
    );
    await modal
      .getByLabel(l.answer, { exact: true })
      .fill("=REVIEWED_LIBRARY_FINDING_" + language);
    await modal.getByLabel(l.reviewed, { exact: true }).check();
    await modal.getByLabel(l.include, { exact: true }).check();
    await modal.getByRole("button", { name: l.update, exact: true }).click();
    await waitEnabled(
      modal.getByRole("button", { name: l.markdown, exact: true }),
    );
    for (const format of ["md", "csv"] as const) {
      const [download] = await Promise.all([
        page.waitForEvent("download"),
        modal
          .getByRole("button", {
            name: format === "md" ? l.markdown : l.csv,
            exact: true,
          })
          .click(),
      ]);
      const text = await readFile((await download.path())!, "utf8");
      assert.match(text, new RegExp("REVIEWED_LIBRARY_FINDING_" + language));
      assert.ok(text.includes(l.warning));
      assert.equal(text.includes("SYNTHETIC_ORIGINAL_INTERPRETATION"), false);
      assert.equal(text.includes("PRIVATE_PARTICIPANT_ANSWER"), false);
      if (format === "csv")
        assert.ok(text.includes("'=REVIEWED_LIBRARY_FINDING_" + language));
    }
    await modal
      .getByRole("button", { name: e.source, exact: true })
      .first()
      .click();
    await modal
      .getByRole("region", { name: e.original, exact: true })
      .waitFor();
    if (language === "en") {
      await modal
        .getByRole("button", { name: e.response, exact: true })
        .click();
      await page
        .getByRole("dialog")
        .getByText("PRIVATE_PARTICIPANT_ANSWER", { exact: true })
        .waitFor();
      await page
        .getByRole("button", { name: "Close dialog", exact: true })
        .click();
      await section
        .getByRole("button", { name: l.open, exact: true })
        .first()
        .click();
      modal = page.getByRole("dialog");
      await modal.waitFor();
    }
    await modal.locator("details").first().locator("summary").click();
    assert.ok(
      (await modal.locator("details").first().innerText()).includes(
        "SYNTHETIC_ORIGINAL_INTERPRETATION",
      ),
    );
    await modal.locator("details").nth(1).locator("summary").click();
    assert.ok(
      (await modal.locator("details").nth(1).innerText()).includes(
        "REVIEWED_LIBRARY_FINDING_" + language,
      ),
    );
    await modal.getByRole("button", { name: l.withdraw, exact: true }).click();
    await waitEnabled(
      modal.getByRole("button", { name: l.update, exact: true }),
    );
    for (
      let n = 0;
      n < 100 &&
      !(await modal
        .getByRole("button", { name: l.markdown, exact: true })
        .isDisabled());
      n++
    )
      await page.waitForTimeout(50);
    assert.equal(
      await modal
        .getByRole("button", { name: l.markdown, exact: true })
        .isDisabled(),
      true,
    );
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth + 1,
      ),
      false,
    );
    await modal.getByRole("button", { name: l.close, exact: true }).click();
  }
  const l = libraryAnswerLabels.fr,
    section = page.getByRole("region", { name: l.title, exact: true });
  await section
    .getByRole("button", { name: l.open, exact: true })
    .first()
    .click();
  await page.getByRole("dialog").waitFor();
  await page.getByRole("button", { name: l.remove, exact: true }).click();
  for (
    let n = 0;
    n < 100 && (await section.locator("[data-saved-answer-id]").count()) !== 2;
    n++
  )
    await page.waitForTimeout(50);
  assert.equal(await section.locator("[data-saved-answer-id]").count(), 2);
  let release: (() => void) | undefined;
  await page.route(
    /\/api\/library\/attachments\/answers\/[a-f0-9-]+$/,
    async (route) => {
      const r = await route.fetch();
      await new Promise<void>((resolve) => {
        release = resolve;
      });
      try {
        await route.fulfill({ response: r });
      } catch {}
    },
  );
  await section
    .getByRole("button", { name: l.open, exact: true })
    .first()
    .click();
  for (let n = 0; n < 100 && !release; n++) await page.waitForTimeout(50);
  assert.ok(release);
  await page.getByRole("button", { name: "Search & ask", exact: true }).click();
  release();
  await page.waitForTimeout(100);
  await page.unroute(/\/api\/library\/attachments\/answers\/[a-f0-9-]+$/);
  await page
    .getByRole("button", { name: "Attachment evidence", exact: true })
    .click();
  const current = page.getByRole("region", {
    name: libraryAnswerLabels.en.title,
    exact: true,
  });
  await current.locator("[data-saved-answer-id]").first().waitFor();
  assert.equal(await page.getByRole("dialog").count(), 0);
  const f = c.fixtures[0];
  assert.equal(
    (
      await c.owner(f.asset + "/review", "PUT", {
        ...f.review,
        version: 1,
        includeInReports: false,
      })
    ).status,
    200,
  );
  assert.equal(
    (await c.local.list("libraryAnswer", c.actor.workspaceId)).length,
    0,
  );
  await current
    .getByRole("button", { name: libraryAnswerLabels.en.open, exact: true })
    .first()
    .click();
  await current.getByRole("alert").waitFor();
  assert.equal(await page.getByRole("dialog").count(), 0);
  assert.equal(await current.locator("[data-saved-answer-id]").count(), 0);
  assert.deepEqual(errors, []);
  console.log(
    "EN/ES/FR mobile saved drafts, originals/history, review approval, current-source drilldown, text/CSV exports, withdrawal, deletion, late navigation and source erasure passed (marked provider fixture).",
  );
} finally {
  await browser?.close();
  await stop();
}
