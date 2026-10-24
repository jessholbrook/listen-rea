import { chromium, type Browser } from "playwright";
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { mkdirSync, readFileSync } from "node:fs";
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
    assert.ok(r.ok(), "Failed synthetic request: " + path);
    return r.json();
  };
  await call("auth/signup", "POST", {
    name: "Handoff admin",
    email: "handoff-browser@example.test",
    password: "handoff-browser-password",
  });
  let s = (await call("studies", "POST", { title: "Qualtrics browser study" }))
    .study;
  s = (
    await call(`studies/${s.id}`, "PUT", {
      guide: { ...emotionInterview().guide, title: "Qualtrics browser study" },
      version: s.version,
    })
  ).study;
  s = (await call(`studies/${s.id}/publish`, "POST", { version: s.version }))
    .study;
  await call(`studies/${s.id}/fielding`, "POST", { state: "active" });
  const root = `studies/${s.id}`,
    responseId = "R_browser_001";
  await page.goto(base + `/?study=${s.id}&tab=fielding`);
  const panel = page.locator(".handoff-panel");
  await panel
    .getByRole("heading", { name: "Qualtrics survey handoff", exact: true })
    .waitFor();
  await panel
    .getByRole("checkbox", { name: "Enable Qualtrics handoff", exact: true })
    .check();
  const routes = {
    complete: "https://brand.qualtrics.com/jfe/form/SV_next?Q_JFE=qdg",
    screened_out: "",
    withdrawn: "https://brand.qualtrics.com/jfe/form/SV_stopped",
  };
  await panel
    .getByLabel("Completed interview destination", { exact: true })
    .fill(routes.complete);
  await panel
    .getByLabel("Stopped interview destination", { exact: true })
    .fill(routes.withdrawn);
  assert.equal(
    await panel
      .getByRole("button", { name: "Save survey handoff", exact: true })
      .isEnabled(),
    false,
  );
  await panel
    .getByRole("checkbox", {
      name: "I reviewed the survey destinations and the ResponseID sharing.",
      exact: true,
    })
    .check();
  await panel
    .getByRole("button", { name: "Save survey handoff", exact: true })
    .click();
  await panel.getByText("Survey handoff saved.", { exact: true }).waitFor();
  assert.equal(
    await panel
      .getByLabel("Qualtrics redirect template", { exact: true })
      .inputValue(),
    base + `/s/${s.id}?ResponseID=` + "${e://Field/ResponseID}",
  );
  mkdirSync("test-results", { recursive: true });
  await panel.screenshot({ path: "test-results/handoff-settings-desktop.png" });
  await page.setViewportSize({ width: 390, height: 844 });
  assert.ok(await panel.evaluate((el) => el.scrollWidth <= el.clientWidth + 1));
  await panel.screenshot({ path: "test-results/handoff-settings-mobile.png" });
  const participant = await browser.newContext({
      viewport: { width: 390, height: 844 },
    }),
    p = await participant.newPage();
  p.on("pageerror", (e) => errors.push(e.message));
  let externalNavigations = 0;
  await participant.route("https://brand.qualtrics.com/**", (route) => {
    externalNavigations++;
    return route.fulfill({
      contentType: "text/html",
      body: "<h1>Synthetic survey destination</h1>",
    });
  });
  await p.goto(base + `/s/${s.id}?ResponseID=not%40an-id`);
  await p
    .getByText(
      "This survey link has an invalid ResponseID. Contact the research team.",
      { exact: true },
    )
    .waitFor();
  const incoming =
    base +
    `/s/${s.id}?ResponseID=${responseId}&return_url=https%3A%2F%2Fevil.example&echo_status=withdrawn`;
  const navigation = await p.goto(incoming);
  assert.equal(navigation?.headers()["referrer-policy"], "no-referrer");
  await p.getByRole("checkbox").check();
  let lost = false;
  let lostResponse!: () => void;
  const loss = new Promise<void>((resolve) => {
    lostResponse = resolve;
  });
  await participant.route(base + "/api/public/" + s.id, async (route) => {
    if (route.request().method() === "POST" && !lost) {
      lost = true;
      const response = await route.fetch();
      assert.equal(response.status(), 201);
      await route.abort("failed");
      lostResponse();
    } else await route.continue();
  });
  await p.getByRole("button", { name: "Let’s begin", exact: true }).click();
  await loss;
  await p.reload();
  await p.getByRole("radio", { name: "Happy", exact: true }).check();
  await p
    .getByLabel("In your own words (optional)", { exact: true })
    .fill("A synthetic survey interview.");
  await p.getByRole("button", { name: "Continue", exact: true }).click();
  await p
    .getByRole("button", { name: "Continue to survey", exact: true })
    .waitFor();
  assert.equal(externalNavigations, 0);
  await p.screenshot({
    path: "test-results/handoff-completion-mobile.png",
    fullPage: true,
  });
  await p.reload();
  await p
    .getByRole("button", { name: "Continue to survey", exact: true })
    .waitFor();
  assert.equal((await call(root + "/survey-handoff")).rows.length, 1);
  await p.goto(base + `/s/${s.id}?ResponseID=R_browser_002`);
  await p.getByRole("button", { name: "Let’s begin", exact: true }).waitFor();
  assert.equal(
    await p
      .getByRole("button", { name: "Continue to survey", exact: true })
      .count(),
    0,
  );
  await p.goto(incoming);
  await p
    .getByRole("button", { name: "Continue to survey", exact: true })
    .waitFor();
  await call(root + "/survey-handoff", "PUT", {
    version: 1,
    enabled: false,
    routes,
    reviewed: false,
  });
  await p
    .getByRole("button", { name: "Continue to survey", exact: true })
    .click();
  await p
    .getByText(
      "This survey connection is unavailable. Contact the research team.",
      { exact: true },
    )
    .waitFor();
  assert.equal(externalNavigations, 0);
  await call(root + "/survey-handoff", "PUT", {
    version: 2,
    enabled: true,
    routes,
    reviewed: true,
  });
  await p.reload();
  await p
    .getByRole("button", { name: "Continue to survey", exact: true })
    .click();
  await p.waitForURL("https://brand.qualtrics.com/**");
  const result = new URL(p.url());
  assert.equal(result.searchParams.get("ResponseID"), responseId);
  assert.equal(result.searchParams.get("echo_status"), "complete");
  assert.equal(result.searchParams.get("Q_JFE"), "qdg");
  assert.equal(result.searchParams.get("return_url"), null);
  assert.equal(externalNavigations, 1);
  await panel
    .getByRole("button", { name: "Refresh handoff status", exact: true })
    .click();
  await panel.getByRole("cell", { name: responseId, exact: true }).waitFor();
  const download = page.waitForEvent("download");
  await panel
    .getByRole("link", { name: "Export handoff CSV", exact: true })
    .click();
  const file = await download;
  await file.saveAs("test-results/handoff-browser.csv");
  const exported = readFileSync("test-results/handoff-browser.csv", "utf8");
  assert.ok(exported.includes(responseId));
  assert.ok(exported.includes('"complete"'));
  const rows = (await call(root + "/survey-handoff")).rows;
  await call(root + "/responses/" + rows[0].interviewId, "DELETE");
  await panel
    .getByRole("button", { name: "Refresh handoff status", exact: true })
    .click();
  await panel.getByRole("cell", { name: "Removed", exact: true }).waitFor();
  assert.equal(
    await panel.getByRole("cell", { name: responseId, exact: true }).count(),
    0,
  );
  await call(root + "/recruitment", "PUT", {
    version: 0,
    mode: "invitation_only",
  });
  const issued = await call(root + "/invitations", "POST", {
    requestId: randomUUID(),
    secret: randomBytes(32).toString("hex"),
    expiresAt: new Date(Date.now() + 86400000).toISOString(),
    recipients: [{ reference: "Invited survey recovery" }],
  });
  const privateFragment = issued.links[0].path.split("#")[1];
  const invitedContext = await browser.newContext(),
    invitedPage = await invitedContext.newPage();
  invitedPage.on("pageerror", (e) => errors.push(e.message));
  let invitedLost = false,
    inviteLossResolve!: () => void;
  const inviteLoss = new Promise<void>((resolve) => {
    inviteLossResolve = resolve;
  });
  await invitedContext.route(base + "/api/public/" + s.id, async (route) => {
    if (route.request().method() === "POST" && !invitedLost) {
      invitedLost = true;
      const response = await route.fetch();
      assert.equal(response.status(), 201);
      await route.abort("failed");
      inviteLossResolve();
    } else await route.continue();
  });
  await invitedPage.goto(
    base + `/s/${s.id}?ResponseID=R_invited_recovery#` + privateFragment,
  );
  await invitedPage.getByRole("checkbox").check();
  await invitedPage
    .getByRole("button", { name: "Let’s begin", exact: true })
    .click();
  await inviteLoss;
  await call(root + "/fielding", "POST", { state: "paused" });
  await invitedPage.reload();
  await invitedPage
    .getByRole("radio", { name: "Happy", exact: true })
    .waitFor();
  const finalRows = (await call(root + "/survey-handoff")).rows;
  assert.equal(
    finalRows.filter((r: any) => r.responseId === "R_invited_recovery").length,
    1,
  );
  assert.deepEqual(errors, []);
  console.log(
    "Qualtrics browser passed: reviewed setup/template, invalid ID, consent, lost-admission recovery, per-ID resume, explicit return, disable recheck, matching CSV, desktop/mobile layout and source deletion.",
  );
} finally {
  await browser?.close();
  await stop();
}
