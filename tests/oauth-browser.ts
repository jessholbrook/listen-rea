import { chromium, type Browser } from "playwright";
import assert from "node:assert/strict";
import { randomBytes, createHash, randomUUID } from "node:crypto";
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
  const setup = await browser.newContext(),
    email = "oauth-browser@example.test",
    password = "oauth-browser-password";
  const call = async (path: string, method = "GET", data?: unknown) => {
    const r = await setup.request.fetch(base + "/api/" + path, {
      method,
      data,
    });
    assert.ok(r.ok(), "Setup request failed: " + path);
    return r.json();
  };
  await call("auth/signup", "POST", { name: "OAuth admin", email, password });
  let study = (await call("studies", "POST", { title: "OAuth browser study" }))
    .study;
  study = (
    await call("studies/" + study.id, "PUT", {
      version: study.version,
      guide: { ...emotionInterview().guide, title: "OAuth browser study" },
    })
  ).study;
  await call("studies/" + study.id + "/publish", "POST", {
    version: study.version,
  });
  const callback = "https://client.example.test/callback",
    verifier = randomBytes(48).toString("base64url"),
    state = randomUUID();
  const registered = await call("oauth/register", "POST", {
    client_name: "Research assistant browser",
    redirect_uris: [callback],
  });
  const parameters = new URLSearchParams({
    client_id: registered.client_id,
    redirect_uri: callback,
    response_type: "code",
    code_challenge: createHash("sha256").update(verifier).digest("base64url"),
    code_challenge_method: "S256",
    resource: base + "/api/mcp",
    scope: "studies:read responses:read",
    state,
  });
  const context = await browser.newContext({
      viewport: { width: 1440, height: 1000 },
    }),
    page = await context.newPage(),
    errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await context.route(callback + "**", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: "<h1>Client callback received</h1>",
    }),
  );
  const navigation = await page.goto(base + "/oauth/authorize?" + parameters);
  assert.equal(navigation?.headers()["x-frame-options"], "DENY");
  assert.equal(navigation?.headers()["referrer-policy"], "no-referrer");
  assert.ok(
    navigation
      ?.headers()
      ["content-security-policy"]?.includes("frame-ancestors 'none'"),
  );
  await page.getByLabel("Email", { exact: true }).fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page
    .getByRole("button", { name: "Sign in to review", exact: true })
    .click();
  await page
    .getByRole("heading", { name: "Research assistant browser", exact: true })
    .waitFor();
  assert.ok((await page.locator("main").textContent())?.includes(callback));
  const choice = page.getByLabel(
    `Allow OAuth browser study (${study.id.slice(0, 8)})`,
    { exact: true },
  );
  assert.equal(await choice.isChecked(), false);
  assert.equal(
    await page
      .getByRole("button", { name: "Approve connection", exact: true })
      .isEnabled(),
    false,
  );
  await choice.check();
  await page
    .getByRole("checkbox", {
      name: "Completed included responses and original answers",
      exact: true,
    })
    .uncheck();
  await page.getByLabel("Connection valid for days", { exact: true }).fill("7");
  await page
    .getByRole("checkbox", {
      name: "I reviewed this tool’s return address, studies and read permissions.",
      exact: true,
    })
    .check();
  mkdirSync("test-results", { recursive: true });
  await page.screenshot({
    path: "test-results/oauth-consent-desktop.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  assert.ok(
    await page
      .locator("main")
      .evaluate((el) => el.scrollWidth <= el.clientWidth + 1),
  );
  await page.screenshot({
    path: "test-results/oauth-consent-mobile.png",
    fullPage: true,
  });
  await page
    .getByRole("button", { name: "Approve connection", exact: true })
    .click();
  await page.waitForURL(callback + "**");
  const redirect = new URL(page.url());
  assert.equal(redirect.searchParams.get("state"), state);
  assert.equal(redirect.searchParams.get("iss"), base);
  const exchange = await context.request.post(base + "/api/oauth/token", {
    form: {
      client_id: registered.client_id,
      grant_type: "authorization_code",
      code: redirect.searchParams.get("code")!,
      code_verifier: verifier,
      redirect_uri: callback,
      resource: base + "/api/mcp",
    },
  });
  assert.equal(exchange.status(), 200);
  const tokens = await exchange.json();
  assert.equal(tokens.scope, "studies:read");
  const mcp = () =>
    context.request.post(base + "/api/mcp", {
      headers: {
        Authorization: "Bearer " + tokens.access_token,
        Accept: "application/json, text/event-stream",
        "MCP-Protocol-Version": "2025-11-25",
      },
      data: { jsonrpc: "2.0", id: 1, method: "tools/list" },
    });
  assert.equal((await mcp()).status(), 200);
  await page.goto(base);
  await page
    .getByRole("button", { name: "Team & settings", exact: true })
    .click();
  const modal = page.getByRole("dialog", {
    name: "Team & workspace",
    exact: true,
  });
  await modal
    .getByRole("heading", { name: "MCP connections", exact: true })
    .scrollIntoViewIfNeeded();
  await modal
    .getByText("Research assistant browser", { exact: true })
    .waitFor();
  assert.ok(!(await modal.textContent())?.includes(tokens.access_token));
  await modal.getByText("1 allowed studies", { exact: true }).click();
  await modal
    .getByText(`OAuth browser study · ${study.id.slice(0, 8)}`, { exact: true })
    .waitFor();
  await modal
    .getByRole("button", { name: "Revoke connection", exact: true })
    .scrollIntoViewIfNeeded();
  await page.screenshot({
    path: "test-results/oauth-connections-mobile.png",
    fullPage: true,
  });
  await modal
    .getByRole("button", { name: "Revoke connection", exact: true })
    .click();
  await modal
    .getByRole("button", { name: "Confirm connection revocation", exact: true })
    .click();
  await modal.getByText("MCP connection revoked.", { exact: true }).waitFor();
  assert.equal((await mcp()).status(), 401);
  await page.goto(base + "/oauth/authorize?" + parameters);
  await page
    .getByRole("button", { name: "Decline connection", exact: true })
    .click();
  await page.waitForURL(callback + "**");
  assert.equal(new URL(page.url()).searchParams.get("error"), "access_denied");
  assert.equal(new URL(page.url()).searchParams.get("code"), null);
  assert.deepEqual(errors, []);
  console.log(
    "OAuth browser passed: sign-in, visible callback, explicit study consent, narrower scopes, desktop/mobile layout, token exchange, connection review/revocation and denial.",
  );
} finally {
  await browser?.close();
  await stop();
}
