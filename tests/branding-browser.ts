import { chromium, type Browser } from "playwright";
import assert from "node:assert/strict";
import sharp from "sharp";
import { mkdirSync } from "node:fs";
import { start, stop, base } from "./harness";
import { emotionInterview } from "./emotion-fixture";
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
    name: "Brand admin",
    email: "brand-browser@example.test",
    password: "branding-browser-password",
  });
  let s = (await call("studies", "POST", { title: "Branded browser study" }))
    .study;
  s = (
    await call("studies/" + s.id, "PUT", {
      version: s.version,
      guide: emotionInterview().guide,
    })
  ).study;
  s = (
    await call("studies/" + s.id + "/publish", "POST", { version: s.version })
  ).study;
  await call("studies/" + s.id + "/fielding", "POST", { state: "active" });
  await page.goto(base + "/?study=" + s.id + "&tab=fielding");
  const panel = page.locator(".branding-panel");
  await panel
    .getByLabel("Use custom participant branding", { exact: true })
    .check();
  await panel
    .getByLabel("Study brand name", { exact: true })
    .fill("Acme Research");
  await panel.getByLabel("Study logo", { exact: true }).setInputFiles({
    name: "logo.png",
    mimeType: "image/png",
    buffer: await sharp({
      create: { width: 1000, height: 400, channels: 4, background: "#ffcc00" },
    })
      .png()
      .toBuffer(),
  });
  await panel.getByLabel("Logo description", { exact: true }).fill("Acme mark");
  const color = async (label: string, value: string) =>
    panel
      .getByLabel(label, { exact: true })
      .evaluate((el: HTMLInputElement, value: string) => {
        const set = Object.getOwnPropertyDescriptor(
          HTMLInputElement.prototype,
          "value",
        )!.set!;
        set.call(el, value);
        el.dispatchEvent(new Event("input", { bubbles: true }));
        el.dispatchEvent(new Event("change", { bubbles: true }));
      }, value);
  await color("Button color", "#ffcc00");
  await color("Background color", "#101820");
  await color("Text color", "#ffffff");
  await panel
    .getByRole("button", { name: "Save participant branding", exact: true })
    .click();
  await panel
    .getByText("Participant branding saved.", { exact: true })
    .waitFor();
  const pc = await browser.newContext({
      viewport: { width: 390, height: 844 },
    }),
    p = await pc.newPage();
  p.on("pageerror", (e) => errors.push(e.message));
  await p.goto(base + "/s/" + s.id);
  await p.getByRole("img", { name: "Acme mark", exact: true }).waitFor();
  assert.equal(
    await p
      .locator(".participant-shell")
      .evaluate((el) => getComputedStyle(el).backgroundColor),
    "rgb(16, 24, 32)",
  );
  assert.equal(
    await p.locator(".eyebrow").evaluate((el) => getComputedStyle(el).color),
    "rgb(255, 204, 0)",
  );
  const begin = p.getByRole("button", {
    name: "Let’s begin",
    exact: true,
  });
  assert.equal(
    await begin.evaluate((el) => getComputedStyle(el).color),
    "rgb(0, 0, 0)",
  );
  assert.equal(
    await begin.evaluate((el) => getComputedStyle(el).backgroundColor),
    "rgb(255, 204, 0)",
  );
  assert.ok(
    await p.locator("body").evaluate((el) => el.scrollWidth <= innerWidth),
  );
  mkdirSync("test-results", { recursive: true });
  await p.screenshot({
    path: "test-results/branding-mobile-consent.png",
    fullPage: true,
  });
  await p.getByRole("checkbox").check();
  await begin.click();
  await p.getByRole("radio", { name: "Happy", exact: true }).waitFor();
  await panel.getByRole("button", { name: "Remove logo", exact: true }).click();
  await panel.getByLabel("Study brand name", { exact: true }).fill("New brand");
  await color("Button color", "#385a40");
  await panel
    .getByRole("button", { name: "Save participant branding", exact: true })
    .click();
  await panel
    .getByText("Participant branding saved.", { exact: true })
    .waitFor();
  await p.reload();
  await p.getByRole("radio", { name: "Happy", exact: true }).waitFor();
  await p.getByRole("img", { name: "Acme mark", exact: true }).waitFor();
  await p.getByRole("radio", { name: "Happy", exact: true }).check();
  await p.getByRole("button", { name: "Continue", exact: true }).click();
  await p
    .getByRole("heading", {
      name: "Your perspective makes a difference.",
      exact: true,
    })
    .waitFor();
  await p.getByRole("img", { name: "Acme mark", exact: true }).waitFor();
  await p.screenshot({
    path: "test-results/branding-mobile-completion.png",
    fullPage: true,
  });
  const fresh = await browser.newContext(),
    f = await fresh.newPage();
  await f.goto(base + "/s/" + s.id);
  await f.locator("header").getByText("New brand", { exact: true }).waitFor();
  assert.equal(await f.locator("header img").count(), 0);
  await color("Text color", "#101820");
  await panel
    .getByRole("button", { name: "Save participant branding", exact: true })
    .click();
  await panel
    .getByRole("alert")
    .filter({ hasText: "contrast ratio" })
    .waitFor();
  await panel
    .getByRole("button", { name: "Refresh participant branding", exact: true })
    .click();
  await panel
    .getByText("Participant branding refreshed.", { exact: true })
    .waitFor();
  assert.equal(
    await panel.getByLabel("Text color", { exact: true }).inputValue(),
    "#ffffff",
  );
  await panel.screenshot({
    path: "test-results/branding-desktop-controls.png",
  });
  await page.setViewportSize({ width: 390, height: 844 });
  assert.ok(await panel.evaluate((el) => el.scrollWidth <= el.clientWidth + 1));
  await panel.screenshot({ path: "test-results/branding-mobile-controls.png" });
  await panel
    .getByRole("button", { name: "Reset to Echo Lab defaults", exact: true })
    .click();
  await panel
    .getByRole("button", { name: "Save participant branding", exact: true })
    .click();
  await panel
    .getByText("Participant branding saved.", { exact: true })
    .waitFor();
  const neutral = await browser.newContext(),
    n = await neutral.newPage();
  await n.goto(base + "/s/" + s.id);
  await n.locator("header").getByText("Echo Lab", { exact: false }).waitFor();
  assert.equal(await n.locator(".participant-themed").count(), 0);
  assert.deepEqual(errors, []);
  console.log(
    "Branding browser passed: logo upload/normalization, colors/contrast, mobile consent/completion, frozen resume, new-session updates, removal, reset and desktop/mobile controls.",
  );
} finally {
  await browser?.close();
  await stop();
}
