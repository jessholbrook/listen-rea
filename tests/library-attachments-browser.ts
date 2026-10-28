import { chromium, type Browser } from "playwright";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { start, stop, base } from "./harness";
import { client } from "./image-review-fixture";
import { libraryAttachmentFixture } from "./library-attachments-fixture";
import { libraryAttachmentLabels } from "../src/lib/library-attachments";
let browser: Browser | undefined;
try {
  await start({ port: 3342 });
  const owner = await client(),
    email = randomUUID() + "@example.test",
    password = "library-browser-password";
  await owner("auth/signup", "POST", {
    name: "Library mobile reviewer",
    email,
    password,
  });
  const fixture = await libraryAttachmentFixture(owner, "pptx");
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
  const login = await context.request.post(base + "/api/auth/login", {
    data: { email, password },
  });
  assert.ok(login.ok(), await login.text());
  await page.route("**/api/library", async (route) => {
    const r = await route.fetch();
    await route.fulfill({
      response: r,
      json: { ...(await r.json()), ai: true },
    });
  });
  await page.goto(base);
  await page
    .getByRole("button", { name: "Research library", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Attachment evidence", exact: true })
    .click();
  let lateRelease: (() => void) | undefined;
  await page.route("**/api/library/attachments/qa", async (route) => {
    const input = route.request().postDataJSON();
    const search = await context.request.post(
        base + "/api/library/attachments/search",
        { data: { formats: ["pptx"], kinds: ["passage"], studyIds: [] } },
      ),
      h = (await search.json()).hits[0];
    if (input.question.includes("late"))
      await new Promise<void>((resolve) => {
        lateRelease = resolve;
      });
    try {
      await route.fulfill({
        json: {
          answer: "Synthetic fixture answer about draft review.",
          question: input.question,
          language: input.language,
          citations: [{ evidenceId: h.id, quote: h.text, source: h }],
          searchedStudies: 1,
          evidenceCount: 1,
          generated: true,
          model: "marked-browser-fixture",
          promptVersion: "fixture",
          generatedAt: new Date().toISOString(),
        },
      });
    } catch {}
  });
  for (const language of ["en", "es", "fr"] as const) {
    const l = libraryAttachmentLabels[language];
    await page
      .locator("section[aria-label]")
      .filter({
        has: page.getByRole("heading", {
          name: libraryAttachmentLabels[
            language === "en" ? "en" : language === "es" ? "en" : "es"
          ].title,
          exact: true,
        }),
      })
      .getByRole("combobox").first()
      .selectOption(language);
    await page.getByLabel(l.query, { exact: true }).fill("draft");
    await page.getByRole("button", { name: l.search, exact: true }).click();
    await page.locator("[data-evidence-id]").first().waitFor();
    assert.equal(await page.locator("[data-evidence-id]").count(), 2);
    await page
      .getByRole("button", { name: l.source, exact: true })
      .first()
      .click();
    await page.getByRole("dialog").waitFor();
    assert.match(
      await page.getByRole("dialog").innerText(),
      /Save draft|Draft workflow/,
    );
    await page.getByRole("button", { name: l.close, exact: true }).click();

    await page
      .getByLabel(l.question, { exact: true })
      .fill("What does draft review show?");
    await page.getByRole("button", { name: l.ask, exact: true }).click();
    await page
      .getByText("Synthetic fixture answer about draft review.", {
        exact: true,
      })
      .waitFor();
    await page.getByLabel(l.query, { exact: true }).fill("changed");
    assert.equal(
      await page
        .getByText("Synthetic fixture answer about draft review.", {
          exact: true,
        })
        .count(),
      0,
    );
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth + 1,
      ),
      false,
    );
  }
  const l = libraryAttachmentLabels.fr;
  await page.getByLabel(l.query, { exact: true }).fill("");
  await page
    .getByLabel(l.question, { exact: true })
    .fill("late draft review question");
  await page.getByRole("button", { name: l.ask, exact: true }).click();
  await page.getByText(l.working, { exact: true }).waitFor();
  await page.getByLabel(l.query, { exact: true }).fill("new filter");
  for (let n = 0; !lateRelease && n < 50; n++) await page.waitForTimeout(100);
  assert.ok(lateRelease);
  lateRelease();
  await page.waitForTimeout(300);
  assert.equal(
    await page
      .getByText("Synthetic fixture answer about draft review.", {
        exact: true,
      })
      .count(),
    0,
  );
  await page.getByLabel(l.query, { exact: true }).fill("");
  await page.getByRole("button", { name: l.search, exact: true }).click();
  await page.locator("[data-evidence-id]").first().waitFor();
  await page
    .getByRole("button", { name: l.source, exact: true })
    .first()
    .click();
  await page.getByRole("dialog").waitFor();
  await page.getByRole("button", { name: l.response, exact: true }).click();
  await page
    .getByRole("dialog")
    .getByText("PRIVATE_PARTICIPANT_ANSWER", { exact: true })
    .waitFor();
  await page.getByRole("button", { name: "Close dialog", exact: true }).click();
  assert.equal((await owner(fixture.asset, "DELETE")).status, 200);
  await page
    .getByRole("button", { name: l.source, exact: true })
    .first()
    .click();
  await page
    .getByRole("region", { name: l.title, exact: true })
    .getByRole("alert")
    .waitFor();
  await page.locator("[data-evidence-id]").first().waitFor({ state: "hidden" });
  assert.equal(await page.locator("[data-evidence-id]").count(), 0);
  assert.equal(await page.getByRole("dialog").count(), 0);
  assert.deepEqual(errors, []);
  console.log(
    "EN/ES/FR mobile search, cited fixture Q&A, current-source drilldown, filters, withdrawal and late-response isolation passed.",
  );
} finally {
  await browser?.close();
  await stop();
}
