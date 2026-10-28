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
  const context = await browser.newContext({
      viewport: { width: 1440, height: 1000 },
    }),
    page = await context.newPage(),
    errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const call = async (path: string, method = "GET", data?: unknown) => {
    const r = await context.request.fetch(base + "/api/" + path, {
      method,
      data,
    });
    assert.ok(r.ok(), await r.text());
    return r.json();
  };
  await call("auth/signup", "POST", {
    name: "API admin",
    email: "api-browser@example.test",
    password: "api-browser-password",
  });
  let s = (await call("studies", "POST", { title: "API allowed study" })).study;
  s = (
    await call(`studies/${s.id}`, "PUT", {
      version: s.version,
      guide: { ...emotionInterview().guide, title: "API allowed study" },
    })
  ).study;
  await call(`studies/${s.id}/publish`, "POST", { version: s.version });
  await call("studies", "POST", { title: "Another study" });
  await page.goto(base + "/");
  await page
    .getByRole("button", { name: "Team & settings", exact: true })
    .click();
  const modal = page.getByRole("dialog", {
    name: "Team & workspace",
    exact: true,
  });
  await modal
    .getByRole("heading", { name: "Read-only API keys", exact: true })
    .waitFor();
  await modal.getByText("Create scoped API key", { exact: true }).click();
  await modal
    .getByLabel("API key name", { exact: true })
    .fill("Browser reporting integration");
  await modal.getByLabel("API key valid for days", { exact: true }).fill("7");
  await modal
    .getByLabel(`API access to API allowed study (${s.id.slice(0, 8)})`, {
      exact: true,
    })
    .check();
  await modal
    .getByRole("checkbox", {
      name: "Completed included responses and original answers",
      exact: true,
    })
    .check();
  await modal
    .getByRole("checkbox", {
      name: "I reviewed the selected study access and permissions for this integration.",
      exact: true,
    })
    .check();
  await modal
    .getByRole("button", { name: "Create API key", exact: true })
    .click();
  const token = await modal
    .getByLabel("New API key", { exact: true })
    .inputValue();
  assert.match(token, /^elk_[0-9a-f]{64}$/);
  assert.equal(
    await modal.getByLabel("New API key", { exact: true }).getAttribute("type"),
    "password",
  );
  const external = await context.request.get(base + "/api/v1/studies", {
    headers: { Authorization: "Bearer " + token },
  });
  assert.equal(external.status(), 200);
  assert.deepEqual(
    (await external.json()).data.map((v: any) => v.id),
    [s.id],
  );
  await modal.getByText("1 selected studies", { exact: true }).click();
  await modal
    .getByText(`API allowed study · ${s.id.slice(0, 8)}`, { exact: true })
    .waitFor();
  await modal
    .getByRole("button", { name: "I saved the API key", exact: true })
    .click();
  assert.equal(
    await modal.getByLabel("New API key", { exact: true }).count(),
    0,
  );
  await modal
    .getByRole("button", { name: "Refresh API keys", exact: true })
    .click();
  await modal.getByText("Never", { exact: true }).waitFor({ state: "hidden" });
  await modal.getByText("Connect an MCP client", { exact: true }).click();
  assert.equal(
    await modal.getByLabel("MCP server URL", { exact: true }).inputValue(),
    base + "/api/mcp",
  );
  assert.ok((await modal.textContent())?.includes("<YOUR_ECHO_LAB_API_KEY>"));
  assert.ok(!(await modal.textContent())?.includes(token));
  mkdirSync("test-results", { recursive: true });
  await modal
    .getByLabel("MCP server URL", { exact: true })
    .scrollIntoViewIfNeeded();
  await page.screenshot({
    path: "test-results/api-keys-desktop.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await modal
    .getByLabel("MCP server URL", { exact: true })
    .scrollIntoViewIfNeeded();
  await page.screenshot({
    path: "test-results/api-keys-mobile.png",
    fullPage: true,
  });
  assert.ok(await modal.evaluate((el) => el.scrollWidth <= el.clientWidth + 1));
  await modal
    .getByRole("button", { name: "Revoke API key", exact: true })
    .click();
  await modal
    .getByRole("button", { name: "Confirm API key revocation", exact: true })
    .click();
  await modal.getByText("API key revoked.", { exact: true }).waitFor();
  assert.equal(
    (
      await context.request.get(base + "/api/v1/studies", {
        headers: { Authorization: "Bearer " + token },
      })
    ).status(),
    401,
  );
  await modal
    .getByRole("button", { name: "Close dialog", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Team & settings", exact: true })
    .click();
  await modal
    .getByRole("heading", { name: "Read-only API keys", exact: true })
    .waitFor();
  assert.equal(
    await modal.getByLabel("New API key", { exact: true }).count(),
    0,
  );
  assert.deepEqual(errors, []);
  console.log(
    "API key browser passed: study/permission selection, one-time masked secret, bearer reads, last-used metadata, MCP connection guidance, responsive layout and immediate revocation.",
  );
} finally {
  await browser?.close();
  await stop();
}
