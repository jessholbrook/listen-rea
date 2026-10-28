import { chromium, type Browser } from "playwright";
import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { start, stop, base } from "./harness";
import { conceptGuide } from "./concept-fixture";
let browser: Browser | undefined;
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
  page.on("pageerror", (e) => errors.push(e.message));
  await context.request.post(base + "/api/auth/signup", {
    data: {
      name: "Concept Browser",
      email: "concept-browser@example.test",
      password: "concept-browser-password",
    },
  });
  let s = (
    await (
      await context.request.post(base + "/api/studies", {
        data: { title: "Concept browser study" },
      })
    ).json()
  ).study;
  const g = conceptGuide();
  for (const c of g.conceptTest!.concepts) {
    c.imageUrl = "https://assets.example.test/concept-fixture.png";
    c.imageAlt = "Concept diagram";
  }
  s = (
    await (
      await context.request.put(base + "/api/studies/" + s.id, {
        data: { guide: g, version: s.version },
      })
    ).json()
  ).study;
  await page.goto(base + "/?study=" + s.id + "&tab=guide");
  await page.getByLabel("Concept testing", { exact: true }).check();
  await page.getByLabel("Concepts per participant").selectOption("2");
  await page
    .getByLabel("Researcher label", { exact: true })
    .first()
    .fill("Alpha research label");
  await page
    .getByRole("button", { name: /What stands out about this idea/ })
    .click();
  await page.getByLabel("Repeat for each assigned concept").check();
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  await page.getByText("Draft saved", { exact: true }).waitFor();
  s = (await (await context.request.get(base + "/api/studies/" + s.id)).json())
    .study;
  s = (
    await (
      await context.request.post(base + "/api/studies/" + s.id + "/publish", {
        data: { version: s.version },
      })
    ).json()
  ).study;
  const revision = s.revisionId;
  await context.request.post(base + "/api/studies/" + s.id + "/fielding", {
    data: { state: "active" },
  });
  const pc = await browser.newContext({
    viewport: { width: 390, height: 844 },
  });
  await pc.route("https://assets.example.test/**", (route) =>
    route.fulfill({
      status: 200,
      contentType: "image/svg+xml",
      body: '<svg xmlns="http://www.w3.org/2000/svg" width="480" height="140"><rect width="480" height="140" fill="#d9e6ce"/><text x="30" y="75" font-size="24">Concept illustration fixture</text></svg>',
    }),
  );
  const p = await pc.newPage();
  p.on("pageerror", (e) => errors.push(e.message));
  await p.goto(base + "/s/" + s.id);
  await p.getByRole("checkbox").check();
  await p.getByRole("button", { name: "Let’s begin" }).click();
  await p
    .getByRole("textbox", { name: "Your answer" })
    .fill("We use customer research to plan product work.");
  await p.getByRole("button", { name: "Continue", exact: true }).click();
  const seen: string[] = [];
  for (let n = 0; n < 2; n++) {
    const stimulus = p.getByRole("complementary", {
      name: "Concept to evaluate",
    });
    await stimulus.waitFor();
    await p.getByText(`CONCEPT ${n + 1} OF 2`, { exact: true }).waitFor();
    const headline = await stimulus.locator("h2").innerText();
    seen.push(headline);
    await p.reload();
    await p
      .getByRole("complementary", { name: "Concept to evaluate" })
      .waitFor();
    assert.equal(await p.locator(".concept-stimulus h2").innerText(), headline);
    await p.getByRole("img", { name: "Concept diagram" }).waitFor();
    assert.equal(await p.locator(".concept-stimulus").count(), 1);
    await p
      .getByRole("radio", {
        name: headline.includes("Alpha") ? "5" : "1",
        exact: true,
      })
      .check();
    mkdirSync("test-results", { recursive: true });
    if (n === 0)
      await p.screenshot({
        path: "test-results/concept-participant-mobile.png",
        fullPage: true,
      });
    assert.ok(
      await p.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    );
    await p.getByRole("button", { name: "Continue", exact: true }).click();
    await p
      .getByRole("textbox", { name: "Your answer" })
      .fill(
        headline.includes("Alpha")
          ? "Alpha helps us work quickly."
          : "Beta helps us trace exact evidence.",
      );
    await p.getByRole("button", { name: "Continue", exact: true }).click();
    await p.getByRole("checkbox", { name: "Speed", exact: true }).check();
    await p.getByRole("checkbox", { name: "Clarity", exact: true }).check();
    await p.getByRole("button", { name: "Continue", exact: true }).click();
    await p.getByLabel("Add the next item").selectOption("b");
    await p.getByLabel("Add the next item").selectOption("a");
    await p.getByRole("button", { name: "Continue", exact: true }).click();
  }
  assert.equal(new Set(seen).size, 2);
  await p.getByRole("button", { name: "Continue", exact: true }).click();
  await p.getByRole("heading", { name: /Thank/ }).waitFor();
  await page.goto(base + "/?study=" + s.id + "&tab=analysis");
  await page
    .getByRole("heading", { name: "Concept results", exact: true })
    .waitFor();
  const scope = (id: string) =>
    JSON.stringify({ conceptId: id, revisionId: revision });
  await page.getByLabel("Analysis scope").selectOption(scope("alpha"));
  await page
    .getByRole("button", { name: "Create evidence memo", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Research memo", exact: true })
    .waitFor();
  await page.getByLabel("Analysis scope").selectOption(scope("beta"));
  await page
    .getByRole("heading", { name: "Start with the stories." })
    .waitFor();
  assert.equal(
    await page
      .getByRole("button", { name: "Research memo", exact: true })
      .count(),
    0,
  );
  await page
    .getByRole("button", { name: "Create evidence memo", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Research memo", exact: true })
    .waitFor();
  await page.getByLabel("Analysis scope").selectOption(scope("alpha"));
  await page
    .getByRole("button", { name: "Research memo", exact: true })
    .waitFor();
  await page
    .getByRole("heading", { name: "Ratings, rankings & selections" })
    .waitFor();
  await page.screenshot({
    path: "test-results/concept-results-desktop.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  assert.ok(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  );
  assert.deepEqual(errors, []);
  console.log(
    "Concept browser checks passed: configuration, repeated block, text/image stimuli, saved randomized presentation, mobile responses and per-concept analysis switching.",
  );
} catch (e) {
  console.error(e);
  process.exitCode = 1;
} finally {
  await browser?.close();
  await stop();
}
