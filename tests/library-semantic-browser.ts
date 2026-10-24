import { chromium, type Browser } from "playwright";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { start, stop, base } from "./harness";
import { savedLibrarySetup } from "./library-answers-fixture";
import { fixtureEmbedding } from "./library-semantic-fixture";
import { semanticLabels, semanticVersion } from "../src/lib/library-semantic";
import {
  libraryAttachmentLabels,
  libraryAttachmentFilter,
} from "../src/lib/library-attachments";
import { libraryAnswerLabels } from "../src/lib/library-answers";
let browser: Browser | undefined;
try {
  await start({ port: 3351 });
  const c = await savedLibrarySetup(),
    service = await import("../src/lib/library-semantic-server"),
    attachments = await import("../src/lib/library-attachments-server");
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
  await page.route(
    /\/api\/library\/semantic\/(status|index)$/,
    async (route) => {
      const p = route.request().url().split("/").at(-1)!,
        r = await service.dispatchLibrarySemantic(
          new Request(route.request().url(), {
            method: route.request().method(),
            body: route.request().postData(),
          }),
          ["library", "semantic", p],
          c.actor,
          fixtureEmbedding,
        );
      await route.fulfill({ status: r!.status, json: await r!.json() });
    },
  );
  let release: (() => void) | undefined;
  await page.route("**/api/library/attachments/search", async (route) => {
    const input = route.request().postDataJSON();
    const r = await attachments.dispatchLibraryAttachments(
      new Request(route.request().url(), {
        method: "POST",
        body: JSON.stringify(input),
      }),
      ["library", "attachments", "search"],
      c.actor,
      undefined,
      fixtureEmbedding,
    );
    const data = await r!.json();
    if (input.query.includes("late"))
      await new Promise<void>((resolve) => {
        release = resolve;
      });
    try {
      await route.fulfill({ status: r!.status, json: data });
    } catch {}
  });
  await page.route("**/api/library/attachments/qa", async (route) => {
    const r = await attachments.dispatchLibraryAttachments(
      new Request(route.request().url(), {
        method: "POST",
        body: route.request().postData(),
      }),
      ["library", "attachments", "qa"],
      c.actor,
      async (evidence) => ({
        answer: "Marked semantic browser interpretation.",
        citations: [{ evidenceId: evidence[0].id, quote: evidence[0].text }],
        model: "marked-fixture",
        promptVersion: "marked-fixture",
        generatedAt: new Date().toISOString(),
      }),
      fixtureEmbedding,
    );
    await route.fulfill({ status: r!.status, json: await r!.json() });
  });
  await page.route("**/api/library/search", async (route) => {
    const input = route.request().postDataJSON();
    if (input.retrieval !== "semantic") {
      await route.continue();
      return;
    }
    const found = await service.retrieveLibrarySemantic(
      c.actor,
      "transcripts",
      libraryAttachmentFilter.parse({
        studyIds: input.studyIds,
        query: input.query,
        attribute: input.attribute,
      }),
      input.query,
      50,
      fixtureEmbedding,
    );
    await route.fulfill({
      json: {
        hits: found.items.map((h) => h.hit),
        total: found.items.length,
        limited: false,
        retrieval: found.retrieval,
      },
    });
  });
  await page.goto(base);
  await page
    .getByRole("button", { name: "Research library", exact: true })
    .click();
  let tools = page.getByRole("region", {
    name: semanticLabels.en.title,
    exact: true,
  });
  await tools
    .getByRole("button", { name: semanticLabels.en.build, exact: true })
    .click();
  await tools.getByText(/4\/4/).waitFor();
  await tools
    .getByLabel(semanticLabels.en.method, { exact: true })
    .selectOption("semantic");
  await page
    .getByLabel("Search evidence", { exact: true })
    .fill("unfinished progress");
  await page
    .getByRole("button", { name: "Search library", exact: true })
    .click();
  await page.getByLabel("Library search results").waitFor();
  assert.ok(
    (await page.getByLabel("Library search results").innerText()).includes(
      semanticVersion,
    ),
  );
  await page
    .getByRole("button", { name: "Attachment evidence", exact: true })
    .click();
  let previous = "en" as "en" | "es" | "fr";
  for (const language of ["en", "es", "fr"] as const) {
    const l = semanticLabels[language],
      e = libraryAttachmentLabels[language],
      a = libraryAnswerLabels[language];
    await page
      .getByLabel(libraryAttachmentLabels[previous].language, { exact: true })
      .selectOption(language);
    previous = language;
    tools = page.getByRole("region", { name: l.title, exact: true });
    await tools.getByRole("button", { name: l.build, exact: true }).click();
    await tools.getByText(/4\/4/).waitFor();
    await tools.getByLabel(l.method, { exact: true }).selectOption("semantic");
    await page.getByLabel(e.query, { exact: true }).fill("unfinished progress");
    await page.getByRole("button", { name: e.search, exact: true }).click();
    await page.locator("[data-evidence-id]").first().waitFor();
    assert.match(
      await page.locator("[data-evidence-id]").first().innerText(),
      /Save draft/,
    );
    assert.ok(await page.getByLabel(l.results, { exact: true }).count());
    await page
      .getByLabel(e.question, { exact: true })
      .fill("How is unfinished progress protected? " + language);
    await page.getByRole("button", { name: a.save, exact: true }).click();
    await page.getByText(a.saved, { exact: true }).waitFor();
    const saved = page.getByRole("region", { name: a.title, exact: true });
    await saved
      .getByText("How is unfinished progress protected? " + language, {
        exact: true,
      })
      .waitFor();
    await saved
      .getByRole("button", { name: a.open, exact: true })
      .first()
      .click();
    await page.getByRole("dialog").waitFor();
    assert.ok(
      (
        await page
          .getByRole("dialog")
          .getByLabel(l.results, { exact: true })
          .innerText()
      ).includes(semanticVersion),
    );
    await page.getByRole("button", { name: a.close, exact: true }).click();
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth + 1,
      ),
      false,
    );
  }
  const l = semanticLabels.fr,
    e = libraryAttachmentLabels.fr;
  await page
    .getByLabel(e.query, { exact: true })
    .fill("late unfinished progress");
  await page.getByRole("button", { name: e.search, exact: true }).click();
  for (let n = 0; n < 100 && !release; n++) await page.waitForTimeout(50);
  assert.ok(release);
  await page.getByLabel(e.query, { exact: true }).fill("changed filter");
  release();
  await page.waitForTimeout(200);
  assert.equal(await page.locator("[data-evidence-id]").count(), 0);
  const f = c.fixtures[0];
  await c.owner(f.asset + "/review", "PUT", {
    ...f.review,
    version: 1,
    includeInReports: false,
  });
  assert.equal(
    (await c.local.list<any>("libraryEmbedding", c.actor.workspaceId)).filter(
      (r) => r.scope === "attachments",
    ).length,
    3,
  );
  assert.equal(
    (await c.local.list("libraryAnswer", c.actor.workspaceId)).length,
    0,
  );
  tools = page.getByRole("region", { name: l.title, exact: true });
  await tools.getByRole("button", { name: l.clear, exact: true }).click();
  await tools.getByText(l.cleared, { exact: true }).waitFor();
  assert.equal(
    (await c.local.list<any>("libraryEmbedding", c.actor.workspaceId)).filter(
      (r) => r.scope === "attachments",
    ).length,
    0,
  );
  assert.deepEqual(errors, []);
  console.log(
    "Mobile transcript semantic retrieval and EN/ES/FR attachment index coverage, hybrid search, saved exact citations/provenance, late-reply isolation, source erasure and workspace index clearing passed (marked embedding/generator fixtures).",
  );
} finally {
  await browser?.close();
  await stop();
}
