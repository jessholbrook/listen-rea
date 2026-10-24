import { chromium, type Browser } from "playwright";
import assert from "node:assert/strict";
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
  const team = await browser.newContext({
      viewport: { width: 1440, height: 1100 },
    }),
    page = await team.newPage(),
    errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const call = async (path: string, method = "GET", data?: unknown) => {
    const r = await team.request.fetch(base + "/api/" + path, { method, data });
    assert.ok(r.ok(), path + ": " + r.status());
    return r.json();
  };
  await call("auth/signup", "POST", {
    name: "Quota admin",
    email: "quota-browser@example.test",
    password: "quota-browser-password",
  });
  let s = (await call("studies", "POST", { title: "Quota browser study" }))
    .study;
  s = (
    await call(`studies/${s.id}`, "PUT", {
      version: s.version,
      guide: {
        ...emotionInterview().guide,
        title: "Quota browser study",
        limit: 20,
      },
    })
  ).study;
  s = (await call(`studies/${s.id}/publish`, "POST", { version: s.version }))
    .study;
  const root = `studies/${s.id}`;
  await call(root + "/fielding", "POST", { state: "active" });
  await page.goto(base + `/?study=${s.id}&tab=fielding`);
  const panel = page.locator(".quota-panel");
  await panel
    .getByRole("checkbox", { name: "Enable participant quotas", exact: true })
    .waitFor();
  await panel
    .getByRole("button", { name: "Add quota group", exact: true })
    .click();
  await panel.getByLabel("Group 1 name", { exact: true }).fill("Customers");
  await panel
    .getByLabel("Group 1 maximum participants", { exact: true })
    .fill("1");
  await panel
    .getByLabel("Group 1 tag 1 value", { exact: true })
    .fill("customer");
  await panel
    .getByRole("checkbox", { name: "Enable participant quotas", exact: true })
    .check();
  await panel
    .getByRole("button", { name: "Save participant quotas", exact: true })
    .click();
  await panel.getByText("Participant quotas saved.", { exact: true }).waitFor();
  const saved = (await call(root + "/quotas")).settings;
  assert.equal(saved.enabled, true);
  assert.equal(saved.requireMatch, true);
  assert.equal(saved.rules[0].limit, 1);
  mkdirSync("test-results", { recursive: true });
  await panel.screenshot({ path: "test-results/quotas-settings-desktop.png" });
  await page.setViewportSize({ width: 390, height: 844 });
  assert.ok(await panel.evaluate((el) => el.scrollWidth <= el.clientWidth + 1));
  await panel.screenshot({ path: "test-results/quotas-settings-mobile.png" });
  const context = await browser.newContext({
      viewport: { width: 390, height: 844 },
    }),
    p = await context.newPage();
  p.on("pageerror", (e) => errors.push(e.message));
  await p.goto(base + `/s/${s.id}?segment=customer`);
  await p.getByRole("checkbox").check();
  await p.getByRole("button", { name: "Let’s begin", exact: true }).click();
  await p.getByRole("radio", { name: "Happy", exact: true }).check();
  await panel
    .getByRole("button", { name: "Refresh quota progress", exact: true })
    .click();
  await panel
    .getByText("0 completed · 1 in progress · 0 places left · Full", {
      exact: true,
    })
    .waitFor();
  assert.equal(
    await panel.getByLabel("Group 1 tag 1 value", { exact: true }).isDisabled(),
    true,
  );
  const other = await browser.newContext(),
    o = await other.newPage();
  o.on("pageerror", (e) => errors.push(e.message));
  await o.goto(base + `/s/${s.id}?segment=customer`);
  await o.getByRole("checkbox").check();
  await o.getByRole("button", { name: "Let’s begin", exact: true }).click();
  await o
    .getByText(
      "This study has no available place for your participant group. Contact the research team.",
      { exact: true },
    )
    .waitFor();
  await p.getByRole("button", { name: "Continue", exact: true }).click();
  await p
    .getByRole("heading", { name: "Your perspective makes a difference.", exact: true })
    .waitFor();
  await panel
    .getByRole("button", { name: "Refresh quota progress", exact: true })
    .click();
  await panel
    .getByText("1 completed · 0 in progress · 0 places left · Full", {
      exact: true,
    })
    .waitFor();
  await panel.screenshot({ path: "test-results/quotas-progress-mobile.png" });
  await panel
    .getByLabel("Group 1 maximum participants", { exact: true })
    .fill("2");
  await panel
    .getByRole("button", { name: "Save participant quotas", exact: true })
    .click();
  await panel.getByText("Participant quotas saved.", { exact: true }).waitFor();
  await o.getByRole("button", { name: "Let’s begin", exact: true }).click();
  await o.getByRole("radio", { name: "Happy", exact: true }).waitFor();
  await panel
    .getByRole("button", { name: "Refresh quota progress", exact: true })
    .click();
  await panel
    .getByText("1 completed · 1 in progress · 0 places left · Full", {
      exact: true,
    })
    .waitFor();
  const latest = (await call(root + "/quotas")).settings;
  await call(root + "/quotas", "PUT", {
    version: latest.version,
    enabled: latest.enabled,
    requireMatch: latest.requireMatch,
    rules: latest.rules.map((r: any) => ({ ...r, limit: 3 })),
  });
  await panel
    .getByRole("button", { name: "Save participant quotas", exact: true })
    .click();
  await panel
    .getByText("Quotas changed. Refresh before saving.", { exact: true })
    .waitFor();
  await panel
    .getByRole("button", { name: "Refresh quota progress", exact: true })
    .click();
  await panel
    .getByText("1 completed · 1 in progress · 1 places left", { exact: true })
    .waitFor();
  await panel
    .getByRole("checkbox", { name: "Enable participant quotas", exact: true })
    .uncheck();
  await panel
    .getByRole("button", { name: "Save participant quotas", exact: true })
    .click();
  await panel.getByText("Participant quotas saved.", { exact: true }).waitFor();
  const plain = await browser.newContext(),
    plainPage = await plain.newPage();
  await plainPage.goto(base + `/s/${s.id}`);
  await plainPage.getByRole("checkbox").check();
  await plainPage
    .getByRole("button", { name: "Let’s begin", exact: true })
    .click();
  await plainPage.getByRole("radio", { name: "Happy", exact: true }).waitFor();
  assert.equal((await call(root + "/quotas")).progress[0].reserved, 2);
  assert.deepEqual(errors, []);
  console.log(
    "Quota browser passed: group setup, cap/progress, overlapping-session rejection, frozen matching fields, cap increase, stale edit rejection, disabled admission and desktop/mobile layout.",
  );
} finally {
  await browser?.close();
  await stop();
}
