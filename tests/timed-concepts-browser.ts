import { chromium, type Browser } from "playwright";
import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { start, stop, base } from "./harness";
import { timedGuide } from "./timed-concepts-fixture";
import { defaultBranding } from "../src/lib/branding";
import { translatedFields } from "./localization-fixture";
import { copy } from "../src/lib/participant-copy";
let browser: Browser | undefined;
try {
  await start();
  browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_PATH || "/usr/bin/chromium",
    args: ["--no-sandbox"],
  });
  const admin = await browser.newContext({
      viewport: { width: 1440, height: 1100 },
    }),
    page = await admin.newPage(),
    errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const call = async (path: string, method = "GET", data?: unknown) => {
    const r = await admin.request.fetch(base + "/api/" + path, {
      method,
      data,
    });
    assert.ok(r.ok(), path + ": " + r.status());
    return r.json();
  };
  await call("auth/signup", "POST", {
    name: "Timed browser",
    email: "timed-browser@example.test",
    password: "timed-browser-password",
  });
  let s = (await call("studies", "POST", { title: "Timed concepts" })).study;
  const root = "studies/" + s.id,
    g = timedGuide(3);
  g.conceptTest!.concepts[0].exposureSeconds = null;
  s = (await call(root, "PUT", { version: s.version, guide: g })).study;
  await page.goto(base + "/?study=" + s.id + "&tab=guide");
  const first = page.locator(".concept-config").first();
  await first
    .getByLabel("Presentation mode", { exact: true })
    .selectOption("timed");
  await first.getByLabel("Exposure seconds", { exact: true }).fill("5");
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  await page.getByText("Draft saved", { exact: true }).waitFor();
  s = (await call(root)).study;
  for (const language of ["es", "fr"] as const) {
    const meta = await call(root + "/localization");
    s = (
      await call(root + "/localization/guide/" + language, "PUT", {
        version: s.version,
        sourceFingerprint: meta.sourceFingerprint,
        fields: translatedFields(s.draft, language),
        reviewed: true,
      })
    ).study;
  }
  s = (await call(root + "/publish", "POST", { version: s.version })).study;
  await call(root + "/fielding", "POST", { state: "active" });
  await call(root + "/branding", "PUT", {
    ...defaultBranding,
    version: 0,
    enabled: true,
    background: "#101820",
    text: "#ffffff",
  });
  const pc = await browser.newContext({
      viewport: { width: 390, height: 844 },
    }),
    p = await pc.newPage();
  p.on("pageerror", (e) => errors.push(e.message));
  await p.goto(base + "/s/" + s.id);
  await p.getByRole("checkbox").check();
  await p.getByRole("button", { name: "Let’s begin", exact: true }).click();
  await p.getByRole("radio", { name: "Ready", exact: true }).check();
  await p.getByRole("button", { name: "Continue", exact: true }).click();
  await p
    .getByRole("button", { name: "Start timed view", exact: true })
    .waitFor();
  assert.equal(await p.locator(".concept-stimulus").count(), 0);
  assert.equal(await p.getByRole("radio").count(), 0);
  let starts = 0;
  await p.route("**/api/interviews/*/concept-presentation", async (route) => {
    if (route.request().method() === "POST") starts++;
    await route.continue();
  });
  await p
    .getByRole("button", { name: "Start timed view", exact: true })
    .click();
  await p.getByRole("heading", { name: "Alpha idea", exact: true }).waitFor();
  const current = await p.evaluate(() =>
    JSON.parse(
      localStorage.getItem(
        Object.keys(localStorage).find((k) => k.startsWith("study-session:"))!,
      )!,
    ),
  );
  const original = (
    await (
      await pc.request.get(base + "/api/interviews/" + current.id, {
        headers: { "x-interview-token": current.token },
      })
    ).json()
  ).interview.conceptPresentation;
  await p.reload();
  await p.getByRole("heading", { name: "Alpha idea", exact: true }).waitFor();
  assert.equal(starts, 1);
  const after = (
    await (
      await pc.request.get(base + "/api/interviews/" + current.id, {
        headers: { "x-interview-token": current.token },
      })
    ).json()
  ).interview.conceptPresentation;
  assert.equal(after.endsAt, original.endsAt);
  // Background time consumes the same window; a focus refresh cannot restart it.
  const other = await pc.newPage();
  await other.goto("about:blank");
  await other.bringToFront();
  await p.waitForTimeout(Math.max(0, original.endsAt - Date.now() + 50));
  await p.bringToFront();
  await p
    .getByText("The timed view has ended. Answer the questions from memory.", {
      exact: true,
    })
    .waitFor();
  assert.equal(await p.locator(".concept-stimulus").count(), 0);
  await p.getByRole("radio", { name: "4", exact: true }).check();
  await p.getByRole("button", { name: "Continue", exact: true }).click();
  await p
    .getByRole("heading", {
      name: "How confident is your answer?",
      exact: true,
    })
    .waitFor();
  assert.equal(
    await p
      .getByRole("button", { name: "Start timed view", exact: true })
      .count(),
    0,
  );
  await p.getByRole("radio", { name: "4", exact: true }).check();
  await p.getByRole("button", { name: "Continue", exact: true }).click();
  await p
    .getByRole("button", { name: "Start timed view", exact: true })
    .waitFor();
  await p
    .getByRole("button", { name: "Use untimed view", exact: true })
    .click();
  await p.getByRole("heading", { name: "Beta idea", exact: true }).waitFor();
  await p.reload();
  await p
    .getByText("Untimed view enabled. Take the time you need.", { exact: true })
    .waitFor();
  await p.getByRole("heading", { name: "Beta idea", exact: true }).waitFor();
  mkdirSync("test-results", { recursive: true });
  await p.screenshot({
    path: "test-results/timed-concept-mobile.png",
    fullPage: true,
  });
  assert.ok(
    await p.locator("body").evaluate((el) => el.scrollWidth <= innerWidth),
  );
  for (const language of ["es", "fr"] as const) {
    const lc = await browser.newContext(),
      lp = await lc.newPage();
    await lp.goto(base + "/s/" + s.id);
    await lp.locator("select").first().selectOption(language);
    await lp.getByRole("checkbox").check();
    await lp
      .getByRole("button", { name: copy(language, "Let’s begin"), exact: true })
      .click();
    await lp
      .getByRole("radio", {
        name: (language === "es" ? "ES " : "FR ") + "Ready",
        exact: true,
      })
      .check();
    await lp
      .getByRole("button", { name: copy(language, "Continue"), exact: true })
      .click();
    await lp
      .getByRole("button", {
        name:
          language === "es"
            ? "Iniciar vista cronometrada"
            : "Démarrer la présentation",
        exact: true,
      })
      .waitFor();
    await lp
      .getByRole("button", {
        name:
          language === "es"
            ? "Usar vista sin límite"
            : "Utiliser la vue sans limite",
        exact: true,
      })
      .click();
    await lp
      .getByRole("heading", {
        name: (language === "es" ? "ES " : "FR ") + "Alpha idea",
        exact: true,
      })
      .waitFor();
    await lc.close();
  }
  await page.goto(base + "/?study=" + s.id + "&tab=responses");
  await page
    .getByRole("button", { name: /Participant / })
    .first()
    .click();
  await page
    .getByRole("heading", { name: "Concept presentation", exact: true })
    .waitFor();
  await page.getByText(/Participant chose untimed view/).waitFor();
  assert.deepEqual(errors, []);
  console.log(
    "Timed concept browser passed: editor, explicit start, hidden before/after window, reload/background expiry, repeated questions, untimed override/resume, EN/ES/FR, dark/mobile layout and researcher audit.",
  );
} finally {
  await browser?.close();
  await stop();
}
