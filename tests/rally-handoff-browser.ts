import { chromium, type Browser } from "playwright";
import assert from "node:assert/strict";
import { mkdirSync, readFileSync } from "node:fs";
import { randomUUID, randomBytes } from "node:crypto";
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
      viewport: { width: 1440, height: 1000 },
    }),
    page = await team.newPage(),
    errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const call = async (path: string, method = "GET", data?: unknown) => {
    const r = await team.request.fetch(base + "/api/" + path, { method, data });
    assert.ok(r.ok(), "Synthetic setup failed: " + path);
    return r.json();
  };
  await call("auth/signup", "POST", {
    name: "Rally admin",
    email: "rally-browser@example.test",
    password: "rally-browser-password",
  });
  let s = (await call("studies", "POST", { title: "Rally browser study" }))
    .study;
  s = (
    await call(`studies/${s.id}`, "PUT", {
      guide: { ...emotionInterview().guide, title: "Rally browser study" },
      version: s.version,
    })
  ).study;
  s = (await call(`studies/${s.id}/publish`, "POST", { version: s.version }))
    .study;
  await call(`studies/${s.id}/fielding`, "POST", { state: "active" });
  const root = `studies/${s.id}`,
    pid = "person_browser_123",
    studyID = "rally_study_A";
  await page.goto(base + `/?study=${s.id}&tab=fielding`);
  const panel = page.locator(".rally-handoff-panel");
  await panel
    .getByRole("heading", { name: "Rally study handoff", exact: true })
    .waitFor();
  await panel
    .getByRole("checkbox", { name: "Enable Rally handoff", exact: true })
    .check();
  await panel
    .getByLabel("Expected Rally studyID", { exact: true })
    .fill(studyID);
  const routes = {
    complete:
      "https://app.rallyuxr.com/research/{studyID}/complete?participant={pid}&keep=yes",
    screened_out: "",
    withdrawn: "https://app.rallyuxr.com/research/{studyID}/stopped?pid={pid}",
  };
  await panel
    .getByLabel("Completed interview destination", { exact: true })
    .fill(routes.complete);
  await panel
    .getByLabel("Stopped interview destination", { exact: true })
    .fill(routes.withdrawn);
  // Wait for React's form update before reading the review-gated disabled state.
  await panel
    .getByRole("checkbox", {
      name: "I reviewed the Rally return links and identifier sharing.",
      exact: true,
    })
    .waitFor();
  await panel
    .getByRole("button", {
      name: "Save Rally handoff",
      exact: true,
      disabled: true,
    })
    .waitFor();
  assert.equal(
    await panel
      .getByRole("button", { name: "Save Rally handoff", exact: true })
      .isEnabled(),
    false,
  );
  await panel
    .getByRole("checkbox", {
      name: "I reviewed the Rally return links and identifier sharing.",
      exact: true,
    })
    .check();
  await panel
    .getByRole("button", { name: "Save Rally handoff", exact: true })
    .click();
  await panel.getByText("Rally handoff saved.", { exact: true }).waitFor();
  assert.equal(
    await panel.getByLabel("Rally test URL", { exact: true }).inputValue(),
    base + `/s/${s.id}?handoff=rally`,
  );
  assert.equal((await call(root + "/survey-handoff")).settings.enabled, false);
  mkdirSync("test-results", { recursive: true });
  await panel.screenshot({ path: "test-results/rally-settings-desktop.png" });
  await page.setViewportSize({ width: 390, height: 844 });
  assert.ok(await panel.evaluate((el) => el.scrollWidth <= el.clientWidth + 1));
  await panel.screenshot({ path: "test-results/rally-settings-mobile.png" });
  const context = await browser.newContext({
      viewport: { width: 390, height: 844 },
    }),
    p = await context.newPage();
  p.on("pageerror", (e) => errors.push(e.message));
  let navigations = 0;
  await context.route("https://app.rallyuxr.com/**", (route) => {
    navigations++;
    return route.fulfill({
      contentType: "text/html",
      body: "<h1>Synthetic Rally return</h1>",
    });
  });
  for (const query of [
    "handoff=rally",
    "pid=person_only",
    "pid=a&studyID=b&ResponseID=c",
    "pid=a&pid=b&studyID=c",
  ]) {
    await p.goto(base + `/s/${s.id}?` + query);
    await p
      .getByText(
        "This Rally link has invalid or mixed participant identifiers. Contact the research team.",
        { exact: true },
      )
      .waitFor();
  }
  const incoming =
    base +
    `/s/${s.id}?handoff=rally&pid=${pid}&studyID=${studyID}&redirect=https%3A%2F%2Fattacker.example`;
  await p.goto(
    base + `/s/${s.id}?handoff=rally&pid=${pid}&studyID=wrong_study`,
  );
  await p.getByRole("checkbox").check();
  await p.getByRole("button", { name: "Let’s begin", exact: true }).click();
  await p
    .getByText(
      "This Rally link does not match the configured studyID. Contact the research team.",
      { exact: true },
    )
    .waitFor();
  assert.equal((await call(root + "/rally-handoff")).rows.length, 0);
  let lost = false,
    resolveLoss!: () => void;
  const loss = new Promise<void>((resolve) => {
    resolveLoss = resolve;
  });
  await context.route(base + "/api/public/" + s.id, async (route) => {
    if (route.request().method() === "POST" && !lost) {
      lost = true;
      const response = await route.fetch();
      assert.equal(response.status(), 201);
      await route.abort("failed");
      resolveLoss();
    } else await route.continue();
  });
  const navigation = await p.goto(incoming);
  assert.equal(navigation?.headers()["referrer-policy"], "no-referrer");
  await p.getByRole("checkbox").check();
  await p.getByRole("button", { name: "Let’s begin", exact: true }).click();
  await loss;
  await p.reload();
  await p.getByRole("radio", { name: "Happy", exact: true }).check();
  await p
    .getByLabel("In your own words (optional)", { exact: true })
    .fill("Synthetic Rally source.");
  await p.getByRole("button", { name: "Continue", exact: true }).click();
  await p
    .getByRole("button", { name: "Continue to Rally", exact: true })
    .waitFor();
  assert.equal(navigations, 0);
  await p.screenshot({
    path: "test-results/rally-completion-mobile.png",
    fullPage: true,
  });
  await p.reload();
  await p
    .getByRole("button", { name: "Continue to Rally", exact: true })
    .waitFor();
  assert.equal((await call(root + "/rally-handoff")).rows.length, 1);
  await call(root + "/rally-handoff", "PUT", {
    version: 1,
    enabled: false,
    externalStudyId: studyID,
    routes,
    reviewed: false,
  });
  await p
    .getByRole("button", { name: "Continue to Rally", exact: true })
    .click();
  await p
    .getByText(
      "This survey connection is unavailable. Contact the research team.",
      { exact: true },
    )
    .waitFor();
  assert.equal(navigations, 0);
  await call(root + "/rally-handoff", "PUT", {
    version: 2,
    enabled: true,
    externalStudyId: studyID,
    routes,
    reviewed: true,
  });
  await p.reload();
  await p
    .getByRole("button", { name: "Continue to Rally", exact: true })
    .click();
  await p.waitForURL("https://app.rallyuxr.com/**");
  const returned = new URL(p.url());
  assert.equal(returned.pathname, "/research/rally_study_A/complete");
  assert.equal(returned.searchParams.get("participant"), pid);
  assert.equal(returned.searchParams.get("keep"), "yes");
  for (const key of ["pid", "studyID", "ResponseID", "echo_status", "redirect"])
    assert.equal(returned.searchParams.has(key), false);
  assert.equal(navigations, 1);
  await call(root + "/rally-handoff", "PUT", {
    version: 3,
    enabled: true,
    externalStudyId: "rally_study_B",
    routes,
    reviewed: true,
  });
  await p.goto(
    base + `/s/${s.id}?handoff=rally&pid=${pid}&studyID=rally_study_B`,
  );
  await p.getByRole("button", { name: "Let’s begin", exact: true }).waitFor();
  assert.equal(
    await p
      .getByRole("button", { name: "Continue to Rally", exact: true })
      .count(),
    0,
  );
  await panel
    .getByRole("button", { name: "Refresh Rally handoff status", exact: true })
    .click();
  await panel.getByRole("cell", { name: pid, exact: true }).waitFor();
  await panel.getByRole("cell", { name: studyID, exact: true }).waitFor();
  const downloaded = page.waitForEvent("download");
  await panel
    .getByRole("link", { name: "Export Rally handoff CSV", exact: true })
    .click();
  const file = await downloaded;
  await file.saveAs("test-results/rally-browser.csv");
  const csv = readFileSync("test-results/rally-browser.csv", "utf8");
  assert.ok(csv.includes('"pid","studyID"'));
  assert.ok(csv.includes(pid));
  assert.ok(csv.includes(studyID));
  const row = (await call(root + "/rally-handoff")).rows[0];
  await call(root + "/responses/" + row.interviewId, "DELETE");
  await panel
    .getByRole("button", { name: "Refresh Rally handoff status", exact: true })
    .click();
  await panel
    .getByRole("cell", { name: "response_deleted", exact: true })
    .waitFor();
  assert.equal(
    await panel.getByRole("cell", { name: pid, exact: true }).count(),
    0,
  );
  assert.equal(
    await panel.getByRole("cell", { name: studyID, exact: true }).count(),
    0,
  );
  // A lost admission with a one-use invitation must recover before the claimed invitation is checked again.
  await call(root + "/recruitment", "PUT", {
    version: 0,
    mode: "invitation_only",
  });
  const issued = await call(root + "/invitations", "POST", {
    requestId: randomUUID(),
    secret: randomBytes(32).toString("hex"),
    expiresAt: new Date(Date.now() + 86400000).toISOString(),
    recipients: [{ reference: "Invited Rally participant" }],
  });
  const fragment = issued.links[0].path.split("#")[1];
  const invited = await browser.newContext(),
    ip = await invited.newPage();
  ip.on("pageerror", (e) => errors.push(e.message));
  let lostInvite = false,
    resolveInvite!: () => void;
  const inviteLoss = new Promise<void>((resolve) => {
    resolveInvite = resolve;
  });
  await invited.route(base + "/api/public/" + s.id, async (route) => {
    if (route.request().method() === "POST" && !lostInvite) {
      lostInvite = true;
      const response = await route.fetch();
      assert.equal(response.status(), 201);
      await route.abort("failed");
      resolveInvite();
    } else await route.continue();
  });
  await ip.goto(
    base +
      `/s/${s.id}?handoff=rally&pid=invited_person&studyID=rally_study_B#` +
      fragment,
  );
  await ip.getByRole("checkbox").check();
  await ip.getByRole("button", { name: "Let’s begin", exact: true }).click();
  await inviteLoss;
  await call(root + "/fielding", "POST", { state: "paused" });
  await ip.reload();
  await ip.getByRole("radio", { name: "Happy", exact: true }).waitFor();
  assert.equal(
    (await call(root + "/rally-handoff")).rows.filter(
      (r: any) => r.responseId === "invited_person",
    ).length,
    1,
  );
  assert.deepEqual(errors, []);
  console.log(
    "Rally browser passed: reviewed custom-test setup, missing/mixed/mismatched IDs, lost-response and invitation recovery, pair-scoped resume, explicit return template, disable recheck, matching CSV, mobile layout and deletion.",
  );
} finally {
  await browser?.close();
  await stop();
}
