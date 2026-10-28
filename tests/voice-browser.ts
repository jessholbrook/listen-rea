import { chromium, type Browser } from "playwright";
import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { start, stop, client, base } from "./harness";
let browser: Browser | undefined;
try {
  await start();
  const owner = await client();
  await owner("auth/signup", "POST", {
    name: "Voice Tester",
    email: "voice@example.test",
    password: "voice-test-password",
  });
  let s = (await owner("studies", "POST", { title: "Voice flow fixture" }))
    .study;
  const guide = s.draft;
  guide.questions = guide.questions
    .slice(1, 3)
    .map((q: any) => ({ ...q, followUps: 0 }));
  s = (await owner("studies/" + s.id, "PUT", { guide, version: s.version }))
    .study;
  s = (
    await owner("studies/" + s.id + "/publish", "POST", { version: s.version })
  ).study;
  await owner("studies/" + s.id + "/fielding", "POST", { state: "active" });
  browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_PATH || "/usr/bin/chromium",
    headless: true,
    args: [
      "--no-sandbox",
      "--use-fake-ui-for-media-stream",
      "--use-fake-device-for-media-stream",
      "--autoplay-policy=no-user-gesture-required",
    ],
  });
  const ctx = await browser.newContext({
    permissions: ["microphone"],
    viewport: { width: 900, height: 1100 },
  });
  let transcripts = 0;
  const wav = Buffer.alloc(44 + 9600);
  wav.write("RIFF", 0);
  wav.writeUInt32LE(wav.length - 8, 4);
  wav.write("WAVEfmt ", 8);
  wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20);
  wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(16000, 24);
  wav.writeUInt32LE(32000, 28);
  wav.writeUInt16LE(2, 32);
  wav.writeUInt16LE(16, 34);
  wav.write("data", 36);
  wav.writeUInt32LE(9600, 40);
  await ctx.route("**/api/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    try {
      if (path.endsWith("/speech")) {
        await new Promise((r) => setTimeout(r, 700));
        await route.fulfill({
          status: 200,
          contentType: "audio/wav",
          body: wav,
        });
        return;
      }
      if (path.endsWith("/transcribe")) {
        transcripts++;
        if (transcripts > 1) await new Promise((r) => setTimeout(r, 1800));
        await route.fulfill({
          json: {
            text: "We used several customer interviews and compared the evidence in a shared document.",
          },
        });
        return;
      }
      const r = await route.fetch();
      if (path.includes("/public/") || path.includes("/interviews/")) {
        if (r.headers()["content-type"]?.includes("application/json")) {
          const data = await r.json();
          await route.fulfill({
            response: r,
            json: { ...data, ai: true, voice: true },
          });
          return;
        }
      }
      await route.fulfill({ response: r });
    } catch {
      /* Interrupted mock responses are expected when the participant cancels. */
    }
  });
  const page = await ctx.newPage();
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(base + "/s/" + s.id);
  await page.getByRole("checkbox").check();
  await page.getByRole("button", { name: "Let’s begin" }).click();
  await page.getByRole("heading", { name: guide.questions[0].text }).waitFor();
  await page.getByRole("checkbox").check();
  await page.getByRole("button", { name: "Start hands-free" }).click();
  await page.getByRole("button", { name: "Interrupt & answer" }).click();
  await page.getByRole("button", { name: /Stop recording/ }).waitFor();
  await page.waitForTimeout(1000);
  await page.getByRole("button", { name: /Stop recording/ }).click();
  await page.getByRole("heading", { name: guide.questions[1].text }).waitFor();
  await page.getByRole("button", { name: "Pause conversation" }).click();
  await page.getByText("Conversation paused.", { exact: false }).waitFor();
  // A canceled transcription must not advance; its recording survives refresh.
  await page.getByRole("button", { name: "Record an answer" }).click();
  await page.waitForTimeout(1000);
  await page.getByRole("button", { name: /Stop recording/ }).click();
  await page.getByRole("button", { name: "Cancel request" }).waitFor();
  await page.waitForTimeout(200);
  await page.getByRole("button", { name: "Cancel request" }).click();
  await page.getByText("Request canceled.", { exact: false }).waitFor();
  await page.waitForTimeout(1900);
  await page.reload();
  await page
    .getByText("Recovered your saved recording", { exact: false })
    .waitFor();
  assert.equal((await owner("studies/" + s.id)).interviews[0].turns.length, 1);
  assert.deepEqual(errors, []);
  mkdirSync("test-results", { recursive: true });
  await page.screenshot({
    path: "test-results/voice-recovery.png",
    fullPage: true,
  });
  await page.goto(base + "/demo");
  await page.getByRole("button", { name: "3. Check the evidence" }).click();
  await page.getByRole("button", { name: /View source/ }).click();
  await page.getByText("Fictional example · first answer").waitFor();
  await page.screenshot({
    path: "test-results/vercel-walkthrough.png",
    fullPage: true,
  });
  console.log(
    "Voice browser checks passed: explicit hands-free consent, read-aloud interruption, automatic answer submission, next-question handoff, pause, request cancellation, IndexedDB recovery, and walkthrough navigation. Provider responses and microphone are synthetic test fixtures.",
  );
} catch (e) {
  console.error(e);
  process.exitCode = 1;
} finally {
  await browser?.close();
  await stop();
}
