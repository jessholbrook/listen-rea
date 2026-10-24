import { chromium, type Browser } from "playwright";
import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { copy } from "../src/lib/participant-copy";
import { start, stop, base } from "./harness";
import {
  prototypeGuide,
  alphaPrototype,
  betaPrototype,
} from "./prototypes-fixture";
import { translatedFields } from "./localization-fixture";
import { defaultBranding } from "../src/lib/branding";
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
    name: "Prototype browser",
    email: "prototype-browser@example.test",
    password: "prototype-browser-password",
  });
  let s = (await call("studies", "POST", { title: "Prototype tasks" })).study;
  const root = "studies/" + s.id;
  const guide = prototypeGuide();
  guide.conceptTest!.concepts[0].prototypeUrl = null;
  guide.conceptTest!.concepts[0].taskInstructions = "";
  s = (await call(root, "PUT", { version: s.version, guide })).study;
  await page.goto(base + "/?study=" + s.id + "&tab=guide");
  const first = page.locator(".concept-config").first();
  await first
    .getByLabel("Prototype URL (optional)", { exact: true })
    .fill(alphaPrototype);
  await first
    .getByLabel("Task instructions", { exact: true })
    .fill(
      "Create a summary from the example notes.\nReturn here to rate the idea.",
    );
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  await page.getByText("Draft saved", { exact: true }).waitFor();
  s = (await call(root)).study;
  // Reviewed locale fixtures translate instructions; prototype addresses remain static.
  for (const language of ["es", "fr"] as const) {
    const meta = await call(root + "/localization");
    await call(root + "/localization/guide/" + language, "PUT", {
      version: s.version,
      sourceFingerprint: meta.sourceFingerprint,
      fields: translatedFields(s.draft, language),
      reviewed: true,
    });
    s = (await call(root)).study;
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
  await page.reload();
  const pc = await browser.newContext({
      viewport: { width: 390, height: 844 },
    }),
    p = await pc.newPage();
  p.on("pageerror", (e) => errors.push(e.message));
  let requests = 0;
  let referrer = "unset";
  await pc.route("https://prototype.example.test/**", async (route) => {
    requests++;
    referrer = route.request().headers().referer || "";
    await route.fulfill({
      contentType: "text/html",
      body: "<h1>Synthetic prototype</h1>",
    });
  });
  await p.goto(base + "/s/" + s.id);
  await p.getByRole("checkbox").check();
  await p.getByRole("button", { name: "Let’s begin", exact: true }).click();
  await p.getByRole("radio", { name: "Ready", exact: true }).check();
  await p.getByRole("button", { name: "Continue", exact: true }).click();
  const link = p.getByRole("link", { name: "Open prototype", exact: false });
  await link.waitFor();
  await link.hover();
  assert.equal(
    await link.evaluate((el) => getComputedStyle(el).backgroundColor),
    "rgb(56, 90, 64)",
  );
  assert.equal(
    await link.evaluate((el) => getComputedStyle(el).color),
    "rgb(255, 255, 255)",
  );
  assert.equal(requests, 0);
  assert.equal(await link.getAttribute("href"), alphaPrototype);
  assert.equal(await link.getAttribute("target"), "_blank");
  assert.match((await link.getAttribute("rel"))!, /noopener/);
  assert.equal(await link.getAttribute("referrerpolicy"), "no-referrer");
  await p
    .getByRole("region", { name: "Your task", exact: true })
    .getByText("Create a summary from the example notes.", { exact: false })
    .waitFor();
  const popupPromise = p.waitForEvent("popup");
  await link.click();
  const popup = await popupPromise;
  await popup.getByRole("heading", { name: "Synthetic prototype" }).waitFor();
  assert.equal(popup.url(), alphaPrototype);
  assert.equal(await popup.evaluate(() => window.opener), null);
  assert.equal(referrer, "");
  await popup.close();
  assert.equal(requests, 1);
  mkdirSync("test-results", { recursive: true });
  await p.screenshot({
    path: "test-results/prototype-mobile.png",
    fullPage: true,
  });
  assert.ok(
    await p.locator("body").evaluate((el) => el.scrollWidth <= innerWidth),
  );

  for (const language of ["es", "fr"] as const) {
    const lc = await browser.newContext({
        viewport: { width: 390, height: 844 },
      }),
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
    const localLink = lp.getByRole("link", {
      name: language === "es" ? "Abrir prototipo" : "Ouvrir le prototype",
      exact: false,
    });
    await localLink.waitFor();
    assert.equal(await localLink.getAttribute("href"), alphaPrototype);
    await lp
      .getByRole("region", {
        name: language === "es" ? "Tu tarea" : "Votre tâche",
        exact: true,
      })
      .getByText(
        (language === "es" ? "ES " : "FR ") +
          "Create a summary from the example notes.",
        { exact: false },
      )
      .waitFor();
    await lc.close();
  }
  await first
    .getByLabel("Prototype URL (optional)", { exact: true })
    .fill("https://changed.example.test/new");
  await first
    .getByLabel("Task instructions", { exact: true })
    .fill("Changed task.");
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  await page.getByText("Draft saved", { exact: true }).waitFor();
  s = (await call(root)).study;
  await call(root + "/publish", "POST", { version: s.version });
  await p.reload();
  await link.waitFor();
  assert.equal(await link.getAttribute("href"), alphaPrototype);
  await p.getByRole("radio", { name: "4", exact: true }).check();
  await p.getByRole("button", { name: "Continue", exact: true }).click();
  await p.getByRole("heading", { name: "Beta idea", exact: true }).waitFor();
  assert.equal(await link.getAttribute("href"), betaPrototype);
  await page.reload();
  await page
    .locator(".concept-editor")
    .screenshot({ path: "test-results/prototype-desktop-controls.png" });
  assert.deepEqual(errors, []);
  console.log(
    "Prototype browser passed: editor controls, static destination/new tab, no prefetch/referrer/opener, dark/mobile layout, frozen resume and concept progression.",
  );
} finally {
  await browser?.close();
  await stop();
}
