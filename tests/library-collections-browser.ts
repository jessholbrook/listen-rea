import { chromium, type Browser } from "playwright";
import assert from "node:assert/strict";
import { start, stop, base } from "./harness";
import { transcriptSetup } from "./library-transcript-answers-fixture";
import { collectionLabels } from "../src/lib/library-collections";
import { briefLabels } from "../src/lib/library-briefs";
import { libraryAttachmentLabels } from "../src/lib/library-attachments";
let browser: Browser | undefined;
try {
  await start({ port: 3372 });
  const c = await transcriptSetup(),
    brief = await c.create();
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
  await page.goto(base);
  await page
    .getByRole("button", { name: "Research library", exact: true })
    .click();
  for (const language of ["en", "es", "fr"] as const) {
    const l = collectionLabels[language];
    await page
      .getByRole("button", { name: "Collections", exact: true })
      .click();
    const currentLanguage = await page
      .getByRole("combobox")
      .first()
      .inputValue();
    await page
      .getByLabel(collectionLabels[currentLanguage as "en"].language, {
        exact: true,
      })
      .selectOption(language);
    const region = page.getByRole("region", { name: l.title, exact: true });
    await region
      .getByRole("textbox", { name: l.name, exact: true })
      .fill("Synthetic collection " + language);
    await region
      .getByRole("checkbox", { name: /^Reviewed external transcript 0/ })
      .check();
    await region
      .getByRole("checkbox", { name: brief.title, exact: true })
      .check();
    await region.getByRole("button", { name: l.create, exact: true }).click();
    await region.getByText(l.saved, { exact: true }).waitFor();
    let collection = (await c.owner("library/collections")).collections.find(
      (v: any) => v.title === "Synthetic collection " + language,
    );
    assert.deepEqual(collection.interviewIds, [c.imports[0].interviewId]);
    assert.deepEqual(collection.briefIds, [brief.id]);
    if (language === "en") {
      await region
        .getByRole("button", { name: l.openBrief, exact: true })
        .click();
      await page.getByLabel(briefLabels.en.name, { exact: true }).waitFor();
      assert.equal(
        await page
          .getByLabel(briefLabels.en.name, { exact: true })
          .inputValue(),
        brief.title,
      );
      await page
        .getByRole("button", { name: "Collections", exact: true })
        .click();
      await page
        .locator(`[data-collection-id="${collection.id}"]`)
        .getByRole("button", { name: l.open, exact: true })
        .click();
    }
    await page
      .getByRole("region", { name: l.title, exact: true })
      .getByRole("button", { name: l.search, exact: true })
      .click();
    assert.equal(
      await page
        .getByLabel(collectionLabels.en.scope, { exact: true })
        .inputValue(),
      collection.id,
    );
    let response = page.waitForResponse(
      (r) =>
        r.url().endsWith("/api/library/search") &&
        r.request().method() === "POST",
    );
    await page
      .getByRole("button", { name: "Search library", exact: true })
      .click();
    let found = await (await response).json();
    assert.ok(found.hits.length);
    assert.ok(
      found.hits.every((h: any) => h.interviewId === c.imports[0].interviewId),
    );
    await page
      .getByRole("button", { name: "Attachment evidence", exact: true })
      .click();
    await page
      .getByLabel(collectionLabels.en.scope, { exact: true })
      .selectOption(collection.id);
    const a = libraryAttachmentLabels.en;
    response = page.waitForResponse((r) =>
      r.url().endsWith("/api/library/attachments/search"),
    );
    await page.getByRole("button", { name: a.search, exact: true }).click();
    found = await (await response).json();
    assert.equal(found.hits.length, 0);
    await page
      .getByRole("button", { name: "Collections", exact: true })
      .click();
    await page
      .getByLabel(collectionLabels.en.language, { exact: true })
      .selectOption(language);
    const editRegion = page.getByRole("region", { name: l.title, exact: true });
    await editRegion
      .locator(`[data-collection-id="${collection.id}"]`)
      .getByRole("button", { name: l.open, exact: true })
      .click();
    const membership = editRegion.getByRole("checkbox", {
      name: /^Reviewed external transcript 0/,
    });
    // Opening a collection fetches its membership. An unchecked placeholder
    // can satisfy uncheck() before the saved collection has populated.
    await page.waitForFunction(
      (input) =>
        input instanceof HTMLInputElement &&
        input.checked &&
        !input.matches(":disabled"),
      await membership.elementHandle(),
    );
    await membership.uncheck();
    await editRegion.getByRole("button", { name: l.save, exact: true }).click();
    await editRegion.getByText(l.saved, { exact: true }).waitFor();
    collection = (await c.owner("library/collections/" + collection.id))
      .collection;
    assert.deepEqual(collection.interviewIds, []);
    await editRegion
      .getByRole("button", { name: l.search, exact: true })
      .click();
    response = page.waitForResponse((r) =>
      r.url().endsWith("/api/library/search"),
    );
    await page
      .getByRole("button", { name: "Search library", exact: true })
      .click();
    assert.equal((await (await response).json()).hits.length, 0);
    await page
      .getByRole("button", { name: "Collections", exact: true })
      .click();
    await page
      .getByLabel(collectionLabels.en.language, { exact: true })
      .selectOption(language);
    const last = page.getByRole("region", { name: l.title, exact: true });
    await last
      .locator(`[data-collection-id="${collection.id}"]`)
      .getByRole("button", { name: l.open, exact: true })
      .click();
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth + 1,
      ),
      true,
    );
    await page.screenshot({
      path: `test-results/library-collections-${language}.png`,
      fullPage: true,
    });
    await last.getByRole("button", { name: l.remove, exact: true }).click();
    await page.waitForFunction(
      (id) => !document.querySelector(`[data-collection-id="${id}"]`),
      collection.id,
    );
    await page
      .getByRole("button", { name: "Search & ask", exact: true })
      .click();
    assert.equal(
      await page
        .getByLabel(collectionLabels.en.scope, { exact: true })
        .inputValue(),
      collection.id,
    );
    response = page.waitForResponse((r) =>
      r.url().endsWith("/api/library/search"),
    );
    await page
      .getByRole("button", { name: "Search library", exact: true })
      .click();
    assert.equal((await response).status(), 404);
    assert.equal((await c.owner("library/briefs/" + brief.id)).status, 200);
  }
  assert.deepEqual(errors, []);
  console.log(
    "EN/ES/FR mobile collection creation/editing, interview/brief membership, linked brief opening, scoped/empty transcript and attachment retrieval, deletion and no missing-scope fallback passed.",
  );
} finally {
  await browser?.close();
  await stop();
}
