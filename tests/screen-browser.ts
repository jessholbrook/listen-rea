import { chromium, type Browser, type Page } from "playwright";
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { start, stop, base } from "./harness";
let browser: Browser | undefined, debug: Page | undefined;
try {
  await start();
  browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_PATH || "/usr/bin/chromium",
    headless: true,
    args: [
      "--no-sandbox",
      "--use-fake-device-for-media-stream",
      "--use-fake-ui-for-media-stream",
    ],
  });
  const context = await browser.newContext({
      viewport: { width: 1440, height: 1000 },
      permissions: ["microphone"],
    }),
    page = await context.newPage(),
    errors: string[] = [];
  debug = page;
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("dialog", (d) => d.accept());
  await context.request.post(base + "/api/auth/signup", {
    data: {
      name: "Screen Browser",
      email: "screen-browser@example.test",
      password: "screen-browser-password",
    },
  });
  let s = (
    await (
      await context.request.post(base + "/api/studies", {
        data: { title: "Desktop usability browser" },
      })
    ).json()
  ).study;
  s.draft.questions = [
    {
      ...s.draft.questions[1],
      text: "Find the support page, then describe what happened.",
      followUps: 0,
    },
  ];
  s = (
    await (
      await context.request.put(base + `/api/studies/${s.id}`, {
        data: { guide: s.draft, version: s.version },
      })
    ).json()
  ).study;
  await page.goto(base + `/?study=${s.id}&tab=guide`);
  await page
    .getByLabel("Usability task with optional screen recording")
    .check();
  await page
    .getByLabel("Task website (optional HTTPS link)")
    .fill("https://example.com/support");
  await page.getByLabel("Recording limit (seconds)").fill("30");
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  await page.getByText("Draft saved", { exact: true }).waitFor();
  s = (await (await context.request.get(base + `/api/studies/${s.id}`)).json())
    .study;
  s = (
    await (
      await context.request.post(base + `/api/studies/${s.id}/publish`, {
        data: { version: s.version },
      })
    ).json()
  ).study;
  await context.request.post(base + `/api/studies/${s.id}/fielding`, {
    data: { state: "active" },
  });
  const pc = await browser.newContext({
    permissions: ["microphone"],
    viewport: { width: 1200, height: 950 },
  });
  async function installCapture(p: Page) {
    await p.evaluate(`(() => {
      const original = navigator.mediaDevices;
      const media = { getUserMedia: original.getUserMedia.bind(original) };
      Object.defineProperty(navigator, "mediaDevices", {
        value: media,
        configurable: true,
      });
      window.denyCapture = true;
      Object.defineProperty(media, "getDisplayMedia", {
        configurable: true,
        value: async () => {
          if (window.denyCapture)
            throw new DOMException("Declined", "NotAllowedError");
          const canvas = document.createElement("canvas");
          canvas.width = 640;
          canvas.height = 360;
          const ctx = canvas.getContext("2d");
          let n = 0;
          const timer = setInterval(() => {
            ctx.fillStyle = n++ % 2 ? "#bed3a5" : "#dbe6ce";
            ctx.fillRect(0, 0, 640, 360);
            ctx.fillStyle = "#234329";
            ctx.font = "32px sans-serif";
            ctx.fillText("Synthetic task screen " + n, 30, 160);
          }, 100);
          const stream = canvas.captureStream(10);
        window.syntheticVideoTrack = stream.getVideoTracks()[0];
          stream
            .getVideoTracks()[0]
            .addEventListener("ended", () => clearInterval(timer));
          return stream;
        },
      });
    })()`);
  }
  const p = await pc.newPage();
  debug = p;
  p.on("pageerror", (e) => errors.push(e.message));
  p.on("dialog", (d) => d.accept());
  let interruptStart = true;
  await p.route("**/interviews/*/captures", async (route) => {
    if (route.request().method() === "POST" && interruptStart) {
      interruptStart = false;
      const response = await route.fetch();
      await p.evaluate(() => {
        (window as any).syntheticVideoTrack.stop();
      });
      await route.fulfill({ response });
    } else await route.continue();
  });
  let failUpload = true,
    fixtureSaved = false;
  await p.route("**/captures/*/clips", async (route) => {
    const bytes = route.request().postDataBuffer();
    if (bytes && !fixtureSaved) {
      mkdirSync("test-results", { recursive: true });
      writeFileSync("test-results/screen-fixture.webm", bytes);
      const h = route.request().headers();
      writeFileSync(
        "test-results/screen-fixture.json",
        JSON.stringify({
          durationMs: Number(h["x-recording-duration"]),
          offsetMs: Number(h["x-clip-offset"]),
          mime: h["content-type"],
        }),
      );
      fixtureSaved = true;
    }
    if (failUpload)
      await route.fulfill({
        status: 503,
        contentType: "application/json",
        body: JSON.stringify({
          error: "Synthetic connection failure; retry saved clips.",
        }),
      });
    else await route.continue();
  });
  await p.goto(base + `/s/${s.id}`);
  await installCapture(p);
  await p.getByRole("checkbox").check();
  await p.getByRole("button", { name: "Let’s begin" }).click();
  const share = p.getByRole("button", {
    name: "Share screen and microphone",
    exact: true,
  });
  await share.waitFor();
  assert.equal(await share.isDisabled(), true);
  await p
    .getByLabel(
      "I agree to record my selected screen or window and microphone narration for this task.",
    )
    .check();
  assert.equal(await p.evaluate(() => (window as any).denyCapture), true);
  await share.click();
  await p.getByText(/Sharing or microphone permission was declined/).waitFor();
  await p.evaluate(() => {
    (window as any).denyCapture = false;
  });
  await share.click();
  await p
    .getByText(
      "Sharing ended before recording started. Please share again when ready.",
      { exact: true },
    )
    .waitFor();
  await share.click();
  await p
    .getByRole("button", { name: "Stop sharing and save", exact: true })
    .waitFor();
  await p
    .getByRole("textbox", { name: "Your answer" })
    .fill("I found the support page after looking in the footer.");
  assert.equal(
    await p.getByRole("button", { name: "Continue", exact: true }).isDisabled(),
    true,
  );
  await p
    .getByText("Synthetic connection failure; retry saved clips.", {
      exact: true,
    })
    .waitFor({ timeout: 25000 });
  failUpload = false;
  await p.reload();
  await installCapture(p);
  await p
    .getByRole("button", {
      name: "Retry saved clips and close previous session",
      exact: true,
    })
    .click();
  await p.getByText("1 clips saved", { exact: true }).waitFor();
  const session = await p.evaluate(
    (id) => JSON.parse(localStorage.getItem("study-session:" + id)!),
    s.id,
  );
  let captures = (
    await (
      await pc.request.get(base + `/api/interviews/${session.id}/captures`, {
        headers: { "x-interview-token": session.token },
      })
    ).json()
  ).captures;
  assert.equal(captures[0].status, "interrupted");
  assert.equal(captures[0].clips.length, 1);
  const recordedSessionId = captures[0].id;
  await p.evaluate(() => {
    (window as any).denyCapture = false;
  });
  await p
    .getByLabel(
      "I agree to record my selected screen or window and microphone narration for this task.",
    )
    .check();
  await share.click();
  await p
    .getByRole("button", { name: "Stop sharing and save", exact: true })
    .waitFor();
  await p.waitForTimeout(1200);
  await p
    .getByRole("button", { name: "Stop sharing and save", exact: true })
    .click();
  await p.getByText("2 clips saved", { exact: true }).waitFor();
  await p
    .getByRole("textbox", { name: "Your answer" })
    .fill("I found the support page after looking in the footer.");
  await p.getByRole("button", { name: "Continue", exact: true }).click();
  await p
    .getByRole("heading", { name: "Your perspective makes a difference." })
    .waitFor();
  debug = page;
  await page.goto(base + `/?study=${s.id}&tab=responses`);
  await page
    .getByRole("button", { name: "View transcript", exact: true })
    .click();
  const playback = page.getByRole("region", {
    name: "Screen recording playback",
  });
  await playback
    .getByRole("heading", { name: "Task screen recordings" })
    .waitFor();
  await playback
    .getByLabel("Recording session", { exact: true })
    .selectOption(recordedSessionId);
  await playback.locator("video").evaluate(async (v: HTMLVideoElement) => {
    await v.play();
  });
  await page.waitForTimeout(350);
  assert.ok(
    await playback
      .locator("video")
      .evaluate((v: HTMLVideoElement) => v.currentTime > 0),
  );
  await playback.locator("video").evaluate((v: HTMLVideoElement) => v.pause());
  await playback.getByLabel("Session timeline", { exact: true }).fill("1000");
  await page.waitForTimeout(150);
  assert.ok(
    await playback
      .locator("video")
      .evaluate((v: HTMLVideoElement) => Math.abs(v.currentTime - 1) < 0.3),
  );
  assert.equal(
    await playback
      .getByLabel("Recording session", { exact: true })
      .locator("option")
      .count(),
    3,
  );
  await page.screenshot({
    path: "test-results/screen-playback-desktop.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({
    path: "test-results/screen-playback-mobile.png",
    fullPage: true,
  });
  assert.ok(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  );
  const unsupported = await browser.newContext({
    viewport: { width: 390, height: 844 },
  });
  async function disableCapture(u: Page) {
    await u.evaluate(() => {
      const original = navigator.mediaDevices;
      Object.defineProperty(navigator, "mediaDevices", {
        value: { getUserMedia: original.getUserMedia.bind(original) },
        configurable: true,
      });
    });
  }
  const u = await unsupported.newPage();
  await u.goto(base + `/s/${s.id}`);
  await disableCapture(u);
  await u.getByRole("checkbox").check();
  await u.getByRole("button", { name: "Let’s begin" }).click();
  await u.getByText(/Screen recording is unavailable here/).waitFor();
  await u
    .getByRole("textbox", { name: "Your answer" })
    .fill("I continued without recording on this device.");
  await u.getByRole("button", { name: "Continue", exact: true }).click();
  await u
    .getByRole("heading", { name: "Your perspective makes a difference." })
    .waitFor();
  assert.deepEqual(errors, []);
  console.log(
    "Screen browser passed: task configuration, explicit consent, denial, muxed screen/mic capture, interrupted upload recovery, new-session permission, playback/seek, mobile and unsupported fallback. Display source and microphone are synthetic fixtures.",
  );
} catch (e) {
  mkdirSync("test-results", { recursive: true });
  await debug?.screenshot({
    path: "test-results/screen-failure.png",
    fullPage: true,
  });
  console.error((await debug?.locator("body").innerText())?.slice(-5000));
  console.error(e);
  process.exitCode = 1;
} finally {
  await browser?.close();
  await stop();
}
