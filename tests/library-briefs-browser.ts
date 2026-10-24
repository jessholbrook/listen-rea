import { chromium, type Browser } from "playwright";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { start, stop, base } from "./harness";
import {
  briefSetup,
  briefRoot,
  answerRoot,
  answerEdit,
} from "./library-briefs-fixture";
import { briefLabels } from "../src/lib/library-briefs";
let browser: Browser | undefined;
try {
  await start({ port: 3354 });
  const c = await briefSetup();
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
  await page
    .getByRole("button", { name: "Research briefs", exact: true })
    .click();
  let previous = "en" as "en" | "es" | "fr";
  for (const language of ["en", "es", "fr"] as const) {
    const l = briefLabels[language];
    await page
      .getByLabel(briefLabels[previous].language, { exact: true })
      .selectOption(language);
    previous = language;
    const region = page.getByRole("region", { name: l.title, exact: true });
    await region.getByRole("button", { name: l.create, exact: true }).click();
    await region
      .getByLabel(l.name, { exact: true })
      .fill("Workflow brief " + language);
    await region
      .getByLabel(l.summary, { exact: true })
      .fill("=RESEARCHER_SUMMARY_" + language);
    for (const a of c.answers)
      await region
        .getByRole("checkbox", {
          name: new RegExp(a.original.question.replace(/[?]/g, "\\?") + " · v"),
        })
        .check();
    await region
      .getByLabel(l.heading + " 1", { exact: true })
      .fill("Draft workflow evidence");
    await region
      .getByLabel(l.commentary + " 1", { exact: true })
      .fill("RESEARCHER_COMMENTARY_" + language);
    await region
      .getByRole("button", { name: l.up, exact: true })
      .nth(1)
      .click();
    await region.getByRole("button", { name: l.save, exact: true }).click();
    await region.getByText(l.saved, { exact: true }).waitFor();
    assert.equal(
      await region
        .getByRole("button", { name: l.md, exact: true })
        .isDisabled(),
      true,
    );
    assert.equal(await region.locator("[data-brief-answer-id]").count(), 2);
    assert.match(
      await region.locator("[data-brief-answer-id]").first().innerText(),
      /APPROVED_FINDING_1/,
    );
    assert.equal(
      (await region.innerText()).includes("SYNTHETIC_ORIGINAL_INTERPRETATION"),
      false,
    );
    await region
      .getByRole("checkbox", { name: l.reviewed, exact: true })
      .check();
    await region
      .getByRole("checkbox", { name: l.approve, exact: true })
      .check();
    await region.getByRole("button", { name: l.save, exact: true }).click();
    await region.getByText(l.saved, { exact: true }).waitFor();
    for (const format of ["md", "csv"] as const) {
      const waiting = page.waitForEvent("download");
      await region
        .getByRole("button", {
          name: format === "md" ? l.md : l.csv,
          exact: true,
        })
        .click();
      const downloaded = await waiting,
        text = await readFile((await downloaded.path())!, "utf8");
      assert.ok(text.includes("Workflow brief " + language));
      assert.ok(
        text.includes("APPROVED_FINDING_0") &&
          text.includes("APPROVED_FINDING_1"),
      );
      assert.ok(text.includes("RESEARCHER_COMMENTARY_" + language));
      assert.ok(text.includes("?study="));
      assert.equal(text.includes("SYNTHETIC_ORIGINAL_INTERPRETATION"), false);
    }
    await region
      .getByRole("button", { name: l.source, exact: true })
      .first()
      .click();
    await page.getByRole("dialog").waitFor();
    await page
      .getByRole("dialog")
      .getByRole("button", { name: l.response, exact: true })
      .click();
    await page
      .getByRole("dialog")
      .getByText("PRIVATE_PARTICIPANT_ANSWER", { exact: true })
      .waitFor();
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Close dialog", exact: true })
      .click();
    await region.getByRole("button", { name: l.withdraw, exact: true }).click();
    await region.getByText(l.saved, { exact: true }).waitFor();
    assert.equal(
      await region
        .getByRole("button", { name: l.md, exact: true })
        .isDisabled(),
      true,
    );
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth + 1,
      ),
      false,
    );
    await region.getByRole("button", { name: l.close, exact: true }).click();
  }
  const l = briefLabels.fr,
    region = page.getByRole("region", { name: l.title, exact: true });
  await region
    .getByRole("button", { name: l.open, exact: true })
    .first()
    .click();
  let a = c.answers[0];
  a = (
    await c.owner(
      answerRoot + "/" + a.id,
      "PUT",
      answerEdit(a, { answer: "UPDATED_APPROVED_FINDING" }),
    )
  ).answer;
  await region.getByRole("button", { name: l.refresh, exact: true }).click();
  await region.getByText(l.stale, { exact: true }).last().waitFor();
  assert.equal(
    await region.getByRole("button", { name: l.md, exact: true }).isDisabled(),
    true,
  );
  assert.equal(
    await region
      .getByRole("checkbox", { name: l.reviewed, exact: true })
      .isDisabled(),
    true,
  );
  await region
    .getByRole("button", { name: l.refreshVersions, exact: true })
    .click();
  await region.getByRole("button", { name: l.save, exact: true }).click();
  await region.getByText("UPDATED_APPROVED_FINDING", { exact: true }).waitFor();
  await region.getByRole("button", { name: l.remove, exact: true }).click();
  await region.getByRole("button", { name: l.create, exact: true }).waitFor();
  assert.equal((await c.owner(briefRoot)).briefs.length, 2);
  const remaining = (await c.owner(briefRoot)).briefs[0];
  let release: (() => void) | undefined;
  await page.route("**/api/library/briefs/" + remaining.id, async (route) => {
    const response = await route.fetch();
    await new Promise<void>((resolve) => {
      release = resolve;
    });
    await route.fulfill({ response });
  });
  await region
    .getByRole("button", { name: l.open, exact: true })
    .first()
    .click();
  for (let i = 0; i < 100 && !release; i++) await page.waitForTimeout(30);
  assert.ok(release);
  await page.getByRole("button", { name: "Search & ask", exact: true }).click();
  release();
  await page.waitForTimeout(150);
  assert.equal(await page.locator("[data-brief-answer-id]").count(), 0);
  const f = c.fixtures[0];
  await c.owner(f.asset, "DELETE");
  assert.equal(
    (await c.local.list("libraryBrief", c.actor.workspaceId)).length,
    0,
  );
  assert.deepEqual(errors, []);
  console.log(
    "EN/ES/FR mobile cross-study briefs: compose/reorder/edit, pinned reviewed evidence, source/full response drilldown, review/export/revoke, stale revision refresh, deletion, late-reply isolation and source erasure passed (marked saved-answer fixtures).",
  );
} finally {
  await browser?.close();
  await stop();
}
