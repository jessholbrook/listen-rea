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
      viewport: { width: 1440, height: 1000 },
    }),
    page = await team.newPage(),
    errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const call = async (path: string, method = "GET", data?: unknown) => {
    const r = await team.request.fetch(base + "/api/" + path, { method, data });
    assert.ok(r.ok(), await r.text());
    return r.json();
  };
  await call("auth/signup", "POST", {
    name: "Invitation researcher",
    email: "invite-browser@example.test",
    password: "invitation-browser-password",
  });
  let s = (await call("studies", "POST", { title: "Invited feelings" })).study;
  s = (
    await call(`studies/${s.id}`, "PUT", {
      guide: emotionInterview().guide,
      version: s.version,
    })
  ).study;
  s = (await call(`studies/${s.id}/publish`, "POST", { version: s.version }))
    .study;
  await call(`studies/${s.id}/fielding`, "POST", { state: "active" });
  await page.goto(base + `/?study=${s.id}&tab=fielding`);
  await page
    .getByRole("heading", { name: "Participant invitations", exact: true })
    .waitFor();
  await page
    .getByLabel("Participant admission", { exact: true })
    .selectOption("invitation_only");
  await page.getByText("Create invitation links", { exact: true }).click();
  await page
    .getByLabel("Participant references, one per line", { exact: true })
    .fill("P001\nP002\nP003");
  await page
    .getByLabel("Participant tag (optional)", { exact: true })
    .fill("segment");
  await page.getByLabel("Tag value", { exact: true }).fill("Trusted");
  await page
    .getByRole("button", { name: "Generate invitation links", exact: true })
    .click();
  const modal = page.getByRole("dialog");
  const links = await Promise.all(
    ["P001", "P002", "P003"].map((ref) =>
      modal
        .getByLabel("Invitation link for " + ref, { exact: true })
        .inputValue(),
    ),
  );
  assert.ok(links.every((l) => l.includes("#invite=")));
  const downloaded = page.waitForEvent("download");
  await modal
    .getByRole("button", {
      name: "Download private invitation links",
      exact: true,
    })
    .click();
  assert.equal(
    (await downloaded).suggestedFilename(),
    "private-invitation-links.csv",
  );
  await modal
    .getByRole("button", { name: "Close dialog", exact: true })
    .click();
  const row = (ref: string) =>
    page
      .getByRole("row")
      .filter({ has: page.getByRole("cell", { name: new RegExp("^" + ref) }) });
  await row("P001")
    .getByRole("button", { name: "Mark shared", exact: true })
    .click();
  await row("P001").getByText("Marked shared", { exact: true }).waitFor();
  const participant = await browser.newContext({
      viewport: { width: 390, height: 844 },
    }),
    p = await participant.newPage();
  p.on("pageerror", (e) => errors.push(e.message));
  const requestUrls: string[] = [];
  p.on("request", (r) => {
    if (r.url().includes("/api/")) requestUrls.push(r.url());
  });
  await p.goto(links[0].replace("#", "?segment=Forged#"));
  await p.getByRole("checkbox").check();
  await p.getByRole("button", { name: "Let’s begin", exact: true }).click();
  await p.getByRole("radio", { name: "Happy", exact: true }).check();
  await p.getByRole("button", { name: "Continue", exact: true }).click();
  await p
    .getByText("Your perspective makes a difference.", { exact: true })
    .waitFor();
  await p.goto(links[1]);
  await p.getByRole("checkbox").waitFor();
  await p.getByRole("checkbox").check();
  await p.getByRole("button", { name: "Let’s begin", exact: true }).click();
  await p.getByRole("radio", { name: "Happy", exact: true }).waitFor();
  await p.goto(links[0]);
  await p
    .getByText("Your perspective makes a difference.", { exact: true })
    .waitFor();
  assert.ok(
    requestUrls.every(
      (u) =>
        !u.includes("invite=") && !u.includes(links[0].split("#invite=")[1]),
    ),
  );
  assert.equal(
    await p.evaluate(
      (id) =>
        Object.keys(localStorage).filter((k) =>
          k.startsWith("study-session:" + id),
        ).length,
      s.id,
    ),
    2,
  );
  const outsider = await browser.newContext(),
    o = await outsider.newPage();
  await o.goto(links[0]);
  await o.getByText(/This invitation has already been used/).waitFor();
  await page
    .getByRole("button", { name: "Refresh invitations", exact: true })
    .click();
  await row("P001").getByText("Complete", { exact: true }).waitFor();
  await row("P003")
    .getByRole("button", { name: "Revoke link", exact: true })
    .click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Revoke invitation", exact: true })
    .click();
  await row("P003").getByText("Revoked", { exact: true }).waitFor();
  await row("P003")
    .getByRole("button", { name: "Replace link", exact: true })
    .click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Replace and show new link", exact: true })
    .click();
  const replaced = await page
    .getByRole("dialog")
    .getByLabel("Invitation link for P003", { exact: true })
    .inputValue();
  assert.notEqual(replaced, links[2]);
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Close dialog", exact: true })
    .click();
  await o.goto(links[2]);
  await o.getByText(/This invitation has expired or been revoked/).waitFor();
  mkdirSync("test-results", { recursive: true });
  await page.screenshot({
    path: "test-results/invitations-desktop.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({
    path: "test-results/invitations-mobile.png",
    fullPage: true,
  });
  assert.ok(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth + 1,
    ),
  );
  assert.deepEqual(errors, []);
  console.log(
    "Invitations browser passed: fielding controls, private link download, sharing, mobile admission, scoped resume, used/revoked links, replacement and responsive layout.",
  );
} finally {
  await browser?.close();
  await stop();
}
