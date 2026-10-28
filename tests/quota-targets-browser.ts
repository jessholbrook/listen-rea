import { chromium, type Browser } from "playwright";
import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { start, stop, base } from "./harness";
import { emotionInterview } from "./emotion-fixture";
import { screenerGuide, screenerRule } from "./screener-quota-fixture";
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
    name: "Target admin",
    email: "target-browser@example.test",
    password: "target-browser-password",
  });
  async function study(guide: any) {
    let s = (
      await call("studies", "POST", {
        title: "Quota target browser " + randomUUID(),
      })
    ).study;
    s = (
      await call(`studies/${s.id}`, "PUT", {
        version: s.version,
        guide: { ...guide, limit: 3 },
      })
    ).study;
    s = (await call(`studies/${s.id}/publish`, "POST", { version: s.version }))
      .study;
    await call(`studies/${s.id}/fielding`, "POST", { state: "active" });
    return s;
  }
  const s = await study(emotionInterview().guide),
    root = `studies/${s.id}`;
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
      .getByLabel(`Group ${n} target participants`, { exact: true })
      .fill(n === 1 ? "2" : "1");
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
    .getByText("3 places protected for minimum targets · Study limit 3", {
      exact: true,
    })
    .waitFor();
  mkdirSync("test-results", { recursive: true });
  await panel.screenshot({ path: "test-results/quota-targets-desktop.png" });
  await page.setViewportSize({ width: 390, height: 844 });
  assert.ok(await panel.evaluate((el) => el.scrollWidth <= el.clientWidth + 1));
  await panel.screenshot({ path: "test-results/quota-targets-mobile.png" });
  const contexts = await Promise.all(
      [0, 1, 2, 3].map(() => browser!.newContext()),
    ),
    ps = await Promise.all(contexts.map((c) => c.newPage()));
  async function begin(p: any, value: string) {
    p.on("pageerror", (e: any) => errors.push(e.message));
    await p.goto(base + `/s/${s.id}?segment=` + value);
    await p.getByRole("checkbox").check();
    await p.getByRole("button", { name: "Let’s begin", exact: true }).click();
  }
  await begin(ps[0], "prospect");
  await ps[0].getByRole("radio", { name: "Happy", exact: true }).waitFor();
  await begin(ps[1], "other");
  await ps[1]
    .getByText(
      "This study has no available place for your participant group. Contact the research team.",
      { exact: true },
    )
    .waitFor();
  for (const p of [ps[2], ps[3]]) {
    await begin(p, "customer");
    await p.getByRole("radio", { name: "Happy", exact: true }).waitFor();
  }
  await panel
    .getByRole("button", { name: "Refresh quota progress", exact: true })
    .click();
  await panel
    .getByText("0 completed · 2 in progress · 0 more reservations needed", {
      exact: true,
    })
    .waitFor();
  await panel
    .getByText(
      "2 more completed interviews needed for the target. Active reservations may still stop or screen out.",
      { exact: true },
    )
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
    .getByRole("button", { name: "Refresh quota progress", exact: true })
    .click();
  await panel
    .getByText("1 completed · 1 in progress · 0 more reservations needed", {
      exact: true,
    })
    .waitFor();
  await panel
    .getByLabel("Group 1 quota type", { exact: true })
    .selectOption("exact");
  await panel
    .getByLabel("Group 1 target participants", { exact: true })
    .fill("1");
  await panel
    .getByRole("button", { name: "Save participant quotas", exact: true })
    .click();
  await panel
    .getByText(
      "An exact target cannot be lower than its already reserved participant count.",
      { exact: true },
    )
    .waitFor();
  await panel
    .getByRole("button", { name: "Refresh quota progress", exact: true })
    .click();
  await panel.getByText("Quota progress refreshed.", { exact: true }).waitFor();
  assert.equal(
    await panel.getByLabel("Group 1 quota type", { exact: true }).inputValue(),
    "minimum",
  );
  const sc = await study(screenerGuide()),
    scroot = `studies/${sc.id}`;
  await call(scroot + "/quotas", "PUT", {
    version: 0,
    enabled: true,
    requireMatch: false,
    rules: [
      { ...screenerRule("role", "customer", 2), kind: "minimum" },
      { ...screenerRule("role", "prospect", 3), kind: "maximum" },
    ],
  });
  const sp = await Promise.all(
    [0, 1].map(async () => {
      const c = await browser!.newContext();
      return c.newPage();
    }),
  );
  for (const p of sp) {
    await p.goto(base + `/s/${sc.id}`);
    await p.getByRole("checkbox").check();
    await p.getByRole("button", { name: "Let’s begin", exact: true }).click();
    await p.getByRole("radio", { name: "Prospect", exact: true }).check();
    await p.getByRole("button", { name: "Continue", exact: true }).click();
  }
  await sp[1]
    .getByRole("heading", { name: "Thanks for checking in.", exact: true })
    .waitFor();
  await page.goto(base + `/?study=${sc.id}&tab=responses`);
  await page
    .getByText("Places protected for quota targets", { exact: true })
    .waitFor();
  assert.equal((await call(scroot + "/quotas")).progress[0].protected, 1);
  assert.deepEqual(errors, []);
  console.log(
    "Quota targets browser passed: minimum/exact setup, protected outsider rejection, active versus completed targets, invalid exact edits, screening-protection outcome and desktop/mobile layout.",
  );
} finally {
  await browser?.close();
  await stop();
}
