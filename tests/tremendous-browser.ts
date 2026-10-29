import { chromium, type Browser } from "playwright";
import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { start, stop, base } from "./harness";
import { tremendousSetup } from "./tremendous-fixture";
let browser: Browser | undefined;
try {
  await start({ port: 3447 });
  const c = await tremendousSetup(),
    { dispatchTremendous } = await import("../src/lib/tremendous-server");
  browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_PATH || "/usr/bin/chromium",
    headless: true,
    args: ["--no-sandbox"],
  });
  const context = await browser.newContext({
      viewport: { width: 1440, height: 1050 },
    }),
    errors: string[] = [];
  await context.request.post(base + "/api/auth/login", {
    data: { email: c.email, password: "saved-library-password" },
  });
  const page = await context.newPage();
  page.on("pageerror", (e) => errors.push(e.message));
  await context.route(
    /\/api\/(studies\/[^/]+\/tremendous|interviews\/[^/]+\/sandbox-reward)(\/.*)?$/,
    async (route) => {
      const r = route.request();
      try {
        const response = await dispatchTremendous(
          new Request(r.url(), {
            method: r.method(),
            headers: r.headers(),
            ...(r.postData() ? { body: r.postData() } : {}),
          }),
          new URL(r.url()).pathname.split("/").slice(2),
          c.provider,
          c.actor,
        );
        await route.fulfill({
          status: response!.status,
          headers: Object.fromEntries(response!.headers),
          body: Buffer.from(await response!.arrayBuffer()),
        });
      } catch (e) {
        await route.fulfill({
          status: (e as any).status || 400,
          contentType: "application/json",
          body: JSON.stringify({ error: (e as Error).message }),
        });
      }
    },
  );
  await page.goto(base + `/?study=${c.study.id}&tab=fielding`);
  const panel = page.getByRole("region", {
    name: "Tremendous sandbox rewards",
  });
  await panel
    .getByRole("heading", { name: "Tremendous reward links" })
    .waitFor();
  assert.equal(
    await panel
      .getByRole("button", { name: "Create sandbox reward", exact: true })
      .isDisabled(),
    true,
  );
  await panel.getByRole("checkbox").check();
  await panel
    .getByRole("button", { name: "Create sandbox reward", exact: true })
    .click();
  await panel
    .getByText("Sandbox order receipt saved. Review its status below.", {
      exact: true,
    })
    .waitFor();
  await panel.getByText("EXECUTED / SUCCEEDED", { exact: true }).waitFor();
  const downloadPromise = page.waitForEvent("download");
  await panel
    .getByRole("link", { name: "Export sandbox reconciliation" })
    .click();
  const download = await downloadPromise;
  assert.equal(download.suggestedFilename(), "sandbox-rewards.csv");
  assert.ok(!(await panel.innerHTML()).includes("initial-secret"));
  mkdirSync("test-results", { recursive: true });
  await panel.screenshot({ path: "test-results/tremendous-desktop.png" });
  await page.setViewportSize({ width: 390, height: 844 });
  const bounds = await panel.boundingBox();
  assert.ok(bounds && bounds.x >= 0 && bounds.x + bounds.width <= 391);
  await panel.screenshot({ path: "test-results/tremendous-mobile.png" });
  await context.addInitScript(
    ({ studyId, source, token }) => {
      localStorage.setItem(
        "study-session:" + studyId,
        JSON.stringify({ id: source, token }),
      );
    },
    { studyId: c.study.id, source: c.source, token: c.token },
  );
  const participantPage = await context.newPage();
  participantPage.on("pageerror", (e) => {
    errors.push(e.message);
    console.error("Participant page error:", e.message);
  });
  await participantPage.goto(base + "/s/" + c.study.id);
  await participantPage
    .getByRole("heading", {
      name: "Your perspective makes a difference.",
      exact: true,
    })
    .waitFor();
  // The participant widget is a labelled div; use its explicit accessible label.
  const widget = participantPage.locator('[aria-label="Sandbox reward"]');
  await participantPage.screenshot({
    path: "test-results/tremendous-participant-before.png",
  });

  await widget
    .getByRole("button", { name: "Check sandbox reward", exact: true })
    .click();
  await widget.getByRole("checkbox").check();
  await widget
    .getByRole("button", { name: "Prepare sandbox reward link" })
    .click();
  const link = widget.getByRole("link", {
    name: "Open sandbox reward",
    exact: true,
  });
  await link.waitFor();
  assert.equal(
    await link.getAttribute("href"),
    "https://testflight.tremendous.com/rewards/payout/marked-claim-secret",
  );
  assert.equal(await link.getAttribute("rel"), "noopener noreferrer");
  assert.ok(
    !(
      await participantPage.evaluate(() => JSON.stringify(localStorage))
    ).includes("marked-claim-secret"),
  );
  await participantPage.reload();
  await widget
    .getByRole("button", { name: "Check sandbox reward", exact: true })
    .waitFor();
  assert.equal(await widget.getByRole("link").count(), 0);
  assert.equal(
    c.calls.filter((v) => v.path === "orders" && v.method === "POST").length,
    1,
  );
  assert.deepEqual(errors, []);
  console.log(
    "Tremendous sandbox desktop/mobile review, private CSV, token-authorized link and reload privacy passed (marked provider only).",
  );
} finally {
  await browser?.close();
  await stop();
}
