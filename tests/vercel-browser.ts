import { chromium, type Browser } from "playwright";
import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { start, stop, base } from "./harness";
let browser: Browser | undefined;
try {
  await start({ preview: true });
  browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_PATH || "/usr/bin/chromium",
    headless: true,
    args: ["--no-sandbox"],
  });
  const page = await browser.newPage({
    viewport: { width: 1440, height: 1000 },
  });
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(base);
  await page.getByText("INTERACTIVE WALKTHROUGH", { exact: false }).waitFor();
  await page.getByRole("button", { name: "2. Hear the story" }).click();
  await page.getByRole("button", { name: "Next example" }).click();
  await page
    .getByRole("heading", { name: "What made that difficult?" })
    .waitFor();
  await page.getByRole("button", { name: "3. Check the evidence" }).click();
  await page.getByRole("button", { name: /View source/ }).click();
  await page.getByText("Fictional example · first answer").waitFor();
  assert.equal((await page.request.get(base + "/api/health")).status(), 503);
  assert.equal(
    (
      await page.request.post(base + "/api/auth/signup", {
        data: {
          name: "Blocked",
          email: "no-data@example.test",
          password: "temporary-test-password",
        },
      })
    ).status(),
    503,
  );
  mkdirSync("test-results", { recursive: true });
  await page.screenshot({
    path: "test-results/vercel-preview.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
    true,
  );
  assert.deepEqual(errors, []);
  console.log(
    "Vercel-mode browser check passed: public walkthrough works without storage; real account/data operations fail closed. This is local deployment-mode validation, not a published Vercel deployment.",
  );
} catch (e) {
  console.error(e);
  process.exitCode = 1;
} finally {
  await browser?.close();
  await stop();
}
