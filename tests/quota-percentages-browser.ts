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
    name: "Percentage admin",
    email: "percentage-browser@example.test",
    password: "percentage-browser-password",
  });
  let s = (await call("studies", "POST", { title: "Percentage quota browser" }))
    .study;
  s = (
    await call(`studies/${s.id}`, "PUT", {
      version: s.version,
      guide: { ...emotionInterview().guide, limit: 4 },
    })
  ).study;
  s = (await call(`studies/${s.id}/publish`, "POST", { version: s.version }))
    .study;
  const root = `studies/${s.id}`;
  await call(root + "/fielding", "POST", { state: "active" });
  await page.goto(base + `/?study=${s.id}&tab=fielding`);
  const panel = page.locator(".quota-panel");
  for (let n = 1; n <= 2; n++) {
    await panel
      .getByRole("button", { name: "Add quota group", exact: true })
      .click();
    await panel
      .getByLabel(`Group ${n} name`, { exact: true })
      .fill(n === 1 ? "Customers" : "Prospects");
    await panel
      .getByLabel(`Group ${n} quota type`, { exact: true })
      .selectOption(n === 1 ? "minimum" : "exact");
    await panel
      .getByLabel(`Group ${n} quota unit`, { exact: true })
      .selectOption("percent");
    await panel
      .getByLabel(`Group ${n} percentage`, { exact: true })
      .fill(n === 1 ? "50" : "25");
    await panel
      .getByLabel(`Group ${n} tag 1 value`, { exact: true })
      .fill(n === 1 ? "customer" : "prospect");
  }
  await panel
    .getByRole("checkbox", {
      name: "Only admit participants matching an enabled group",
      exact: true,
    })
    .uncheck();
  await panel
    .getByRole("checkbox", { name: "Enable participant quotas", exact: true })
    .check();
  await panel
    .getByRole("button", { name: "Save participant quotas", exact: true })
    .click();
  await panel.getByText("Participant quotas saved.", { exact: true }).waitFor();
  await panel
    .getByText("50% of published limit 4 = 2 participants", { exact: true })
    .waitFor();
  await panel
    .getByText("25% of published limit 4 = 1 participants", { exact: true })
    .waitFor();
  mkdirSync("test-results", { recursive: true });
  await panel.screenshot({
    path: "test-results/quota-percentages-desktop.png",
  });
  await page.setViewportSize({ width: 390, height: 844 });
  assert.ok(await panel.evaluate((el) => el.scrollWidth <= el.clientWidth + 1));
  await panel.screenshot({ path: "test-results/quota-percentages-mobile.png" });
  const ps = [];
  for (const value of ["other", "other", "customer", "prospect", "customer"]) {
    const c = await browser.newContext(),
      p = await c.newPage();
    ps.push(p);
    p.on("pageerror", (e) => errors.push(e.message));
    await p.goto(base + `/s/${s.id}?segment=` + value);
    await p.getByRole("checkbox").check();
    await p.getByRole("button", { name: "Let’s begin", exact: true }).click();
    if (ps.length === 2)
      await p
        .getByText(
          "This study has no available place for your participant group. Contact the research team.",
          { exact: true },
        )
        .waitFor();
    else await p.getByRole("radio", { name: "Happy", exact: true }).waitFor();
  }
  async function limit(n: number, live = true) {
    let state = (await call(root)).study;
    state = (
      await call(root, "PUT", {
        version: state.version,
        guide: { ...state.draft, limit: n },
      })
    ).study;
    if (live) await call(root + "/publish", "POST", { version: state.version });
  }
  await limit(8, false);
  await panel
    .getByRole("button", { name: "Refresh quota progress", exact: true })
    .click();
  await panel
    .getByText("50% of published limit 4 = 2 participants", { exact: true })
    .waitFor();
  await limit(8);
  await panel
    .getByRole("button", { name: "Refresh quota progress", exact: true })
    .click();
  await panel
    .getByText("50% of published limit 8 = 4 participants", { exact: true })
    .waitFor();
  await panel
    .getByText("25% of published limit 8 = 2 participants", { exact: true })
    .waitFor();
  await limit(6);
  await panel
    .getByRole("button", { name: "Refresh quota progress", exact: true })
    .click();
  await panel
    .getByRole("alert")
    .filter({ hasText: "Saved quotas need review" })
    .waitFor();
  await panel
    .getByText("Effective count unavailable until corrected.", { exact: true })
    .waitFor();
  await ps[2].getByRole("radio", { name: "Happy", exact: true }).check();
  await ps[2].getByRole("button", { name: "Continue", exact: true }).click();
  await ps[2]
    .getByRole("heading", {
      name: "Your perspective makes a difference.",
      exact: true,
    })
    .waitFor();
  await panel
    .getByLabel("Group 2 quota unit", { exact: true })
    .selectOption("count");
  await panel
    .getByLabel("Group 2 target participants", { exact: true })
    .fill("2");
  await panel
    .getByRole("button", { name: "Save participant quotas", exact: true })
    .click();
  await panel.getByText("Participant quotas saved.", { exact: true }).waitFor();
  assert.equal(await panel.getByRole("alert").count(), 0);
  const saved = await call(root + "/quotas");
  assert.equal(saved.configurationError, null);
  assert.deepEqual(
    saved.progress.map((p: any) => p.resolvedCount),
    [3, 2],
  );
  assert.equal(saved.settings.rules[1].unit, "count");
  assert.deepEqual(errors, []);
  console.log(
    "Percentage quota browser passed: percent/count controls, effective counts, protected admission, draft/published rescaling, invalid exact review, continued qualified response, mixed-unit repair and mobile layout.",
  );
} finally {
  await browser?.close();
  await stop();
}
