import { chromium, type Browser } from "playwright";
import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { start, stop, base } from "./harness";
import { screenerGuide } from "./screener-quota-fixture";
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
    name: "Screening admin",
    email: "screen-quota-browser@example.test",
    password: "screen-quota-password",
  });
  let s = (await call("studies", "POST", { title: "Screening quota browser" }))
    .study;
  s = (
    await call(`studies/${s.id}`, "PUT", {
      version: s.version,
      guide: screenerGuide(),
    })
  ).study;
  s = (await call(`studies/${s.id}/publish`, "POST", { version: s.version }))
    .study;
  const root = `studies/${s.id}`;
  await call(root + "/fielding", "POST", { state: "active" });
  await page.goto(base + `/?study=${s.id}&tab=fielding`);
  const panel = page.locator(".quota-panel");
  await panel
    .getByRole("button", { name: "Add quota group", exact: true })
    .click();
  await panel
    .getByLabel("Group 1 name", { exact: true })
    .fill("Customers using the app");
  await panel
    .getByLabel("Group 1 match using", { exact: true })
    .selectOption("screener");
  await panel
    .getByLabel("Group 1 maximum participants", { exact: true })
    .fill("1");
  await panel
    .getByLabel("Group 1 screening question 1", { exact: true })
    .selectOption("role");
  await panel
    .getByLabel("Group 1 qualifying answer 1", { exact: true })
    .selectOption("customer");
  await panel
    .getByRole("button", { name: "Add screening condition", exact: true })
    .click();
  await panel
    .getByLabel("Group 1 screening question 2", { exact: true })
    .selectOption("tools");
  await panel
    .getByLabel("Group 1 qualifying answer 2", { exact: true })
    .selectOption("app");
  await panel
    .getByRole("checkbox", { name: "Enable participant quotas", exact: true })
    .check();
  await panel
    .getByRole("button", { name: "Save participant quotas", exact: true })
    .click();
  await panel.getByText("Participant quotas saved.", { exact: true }).waitFor();
  mkdirSync("test-results", { recursive: true });
  await panel.screenshot({ path: "test-results/screener-quotas-desktop.png" });
  await page.setViewportSize({ width: 390, height: 844 });
  assert.ok(await panel.evaluate((el) => el.scrollWidth <= el.clientWidth + 1));
  await panel.screenshot({ path: "test-results/screener-quotas-mobile.png" });
  const contexts = await Promise.all([
      browser.newContext(),
      browser.newContext(),
    ]),
    ps = await Promise.all(contexts.map((c) => c.newPage()));
  for (const p of ps) {
    p.on("pageerror", (e) => errors.push(e.message));
    await p.goto(base + `/s/${s.id}`);
    await p.getByRole("checkbox").check();
    await p.getByRole("button", { name: "Let’s begin", exact: true }).click();
    await p.getByRole("radio", { name: "Customer", exact: true }).check();
    await p.getByRole("button", { name: "Continue", exact: true }).click();
    await p.getByRole("checkbox", { name: "Mobile app", exact: true }).check();
  }
  await panel
    .getByRole("button", { name: "Refresh quota progress", exact: true })
    .click();
  await panel
    .getByText("2 people screening · 0 quota screen-outs", { exact: true })
    .waitFor();
  assert.equal(
    await panel
      .getByLabel("Group 1 screening question 1", { exact: true })
      .isDisabled(),
    true,
  );
  assert.equal((await call(root + "/quotas")).progress[0].reserved, 0);
  await ps[0].getByRole("button", { name: "Continue", exact: true }).click();
  await ps[0].getByRole("radio", { name: "Happy", exact: true }).waitFor();
  await ps[1].getByRole("button", { name: "Continue", exact: true }).click();
  await ps[1]
    .getByRole("heading", { name: "Thanks for checking in.", exact: true })
    .waitFor();
  assert.equal(
    await ps[1].getByRole("radio", { name: "Happy", exact: true }).count(),
    0,
  );
  await ps[1].reload();
  await ps[1]
    .getByRole("heading", { name: "Thanks for checking in.", exact: true })
    .waitFor();
  await panel
    .getByRole("button", { name: "Refresh quota progress", exact: true })
    .click();
  await panel
    .getByText("0 people screening · 1 quota screen-outs", { exact: true })
    .waitFor();
  await panel
    .getByText("0 completed · 1 in progress · 0 places left · Full", {
      exact: true,
    })
    .waitFor();
  await ps[0].getByRole("radio", { name: "Happy", exact: true }).check();
  await ps[0].getByRole("button", { name: "Continue", exact: true }).click();
  await ps[0]
    .getByRole("heading", {
      name: "Your perspective makes a difference.",
      exact: true,
    })
    .waitFor();
  await page.goto(base + `/?study=${s.id}&tab=responses`);
  await page.getByText("Quota group full", { exact: true }).waitFor();
  assert.equal((await call(root + "/quotas")).progress[0].complete, 1);
  assert.deepEqual(errors, []);
  console.log(
    "Screener quotas browser passed: published choice/multiple selection, conjunction, deferred reservations, full-group screen-out, refresh recovery, main-interview progression, researcher reason and desktop/mobile layout.",
  );
} finally {
  await browser?.close();
  await stop();
}
