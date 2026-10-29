import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { chromium, type Browser } from "playwright";
import { start, stop, base } from "./harness";
import { richerFixture } from "./richer-fixture";
let browser: Browser | undefined;
try {
  await start({ port: 3437 });
  const c = await richerFixture(),
    voice = await richerFixture(false, c);
  browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_PATH || "/usr/bin/chromium",
    args: [
      "--no-sandbox",
      "--use-fake-device-for-media-stream",
      "--use-fake-ui-for-media-stream",
    ],
  });
  const context = await browser.newContext({
      viewport: { width: 1100, height: 1000 },
      permissions: ["microphone"],
    }),
    p = await context.newPage(),
    errors: string[] = [];
  p.on("pageerror", (e) => errors.push(e.message));
  // Provider transport is mocked; actual guide progression, persistence and exports use the compiled server.
  let screenFrames = 0,
    rtcRequests = 0;
  await context.route("**/api/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith("/live-probe")) {
      const body = route.request().postDataJSON();
      assert.equal(body.aiConsent, true);
      assert.ok(body.image.startsWith("data:image/jpeg;base64,"));
      assert.ok(body.image.length < 130000);
      screenFrames++;
      return route.fulfill({
        json: {
          guidance: {
            question: "What do you see in the support area?",
            visibleContext: "A support heading (marked fixture).",
            uncertainty: "This is a synthetic screen guidance fixture.",
          },
        },
      });
    }
    if (path.endsWith("/realtime") && route.request().method() === "POST") {
      const n = ++rtcRequests;
      if (n === 1) await new Promise((r) => setTimeout(r, 700));
      return route.fulfill({
        json: {
          id: "mock-call-" + n,
          sdp: "v=0\r\nMARKED_RTC_ANSWER",
          expiresAt: Date.now() + 600000,
        },
      });
    }
    if (path.endsWith("/realtime/mock-call-1"))
      return route.abort("internetdisconnected");
    if (path.includes("/realtime/mock-call-"))
      return route.fulfill({ json: { stopped: true } });
    const r = await route.fetch();
    if (path.includes("/public/") || path.includes("/interviews/")) {
      if (r.headers()["content-type"]?.includes("application/json")) {
        const data = await r.json();
        data.ai = true;
        data.voice = true;
        return route.fulfill({ response: r, json: data });
      }
    }
    return route.fulfill({ response: r });
  });
  await p.addInitScript(() => {
    (0, eval)("globalThis.__name = value => value;");
    const w = window as any;
    w.rtcSent = [];
    w.rtcClosed = 0;
    w.rtcSteps = [];
    const originalMic = navigator.mediaDevices.getUserMedia.bind(
      navigator.mediaDevices,
    );
    navigator.mediaDevices.getUserMedia = async (...args) => {
      w.rtcSteps.push("microphone");
      try {
        const s = await originalMic(...args);
        w.rtcSteps.push("microphone-ready");
        return s;
      } catch (e) {
        w.rtcSteps.push(String(e));
        throw e;
      }
    };
    class Peer {
      connectionState = "new";
      localDescription: any;
      channel: any;
      constructor() {
        w.rtcSteps.push("peer");
      }
      addTrack() {}
      createDataChannel() {
        this.channel = {
          readyState: "open",
          send: (v: string) => w.rtcSent.push(JSON.parse(v)),
        };
        w.rtcEvent = (e: any) =>
          this.channel.onmessage?.({ data: JSON.stringify(e) });
        return this.channel;
      }
      async createOffer() {
        return { type: "offer", sdp: "v=0\r\nMARKED_BROWSER_OFFER" };
      }
      async setLocalDescription(v: any) {
        this.localDescription = v;
      }
      async setRemoteDescription() {
        w.rtcSteps.push("remote");
        this.connectionState = "connected";
        this.channel.onopen?.();
      }
      close() {
        w.rtcClosed++;
        this.channel.readyState = "closed";
      }
    }
    w.RTCPeerConnection = Peer;
    navigator.mediaDevices.getDisplayMedia = async () => {
      const canvas = document.createElement("canvas");
      canvas.width = 640;
      canvas.height = 360;
      const draw = () => {
        const ctx = canvas.getContext("2d")!;
        ctx.fillStyle = "white";
        ctx.fillRect(0, 0, 640, 360);
        ctx.fillStyle = "black";
        ctx.font = "32px sans-serif";
        ctx.fillText("SUPPORT · synthetic screen", 30, 100);
      };
      draw();
      const timer = setInterval(draw, 80),
        stream = canvas.captureStream(12);
      stream
        .getVideoTracks()[0]
        .addEventListener("ended", () => clearInterval(timer));
      return stream;
    };
  });
  await p.goto(base + "/s/" + voice.s.id);
  await p.getByRole("checkbox").check();
  await p.getByRole("button", { name: "Let’s begin", exact: true }).click();
  await p.getByLabel("Voice mode", { exact: true }).selectOption("streaming");
  const live = p.getByRole("region", { name: "Streaming voice · preview" });
  assert.equal(
    await live
      .getByRole("button", { name: "Start streaming voice", exact: true })
      .isEnabled(),
    false,
  );
  await live.getByRole("checkbox").check();
  const pendingOffer = p.waitForRequest(
    (r) => r.url().endsWith("/realtime") && r.method() === "POST",
  );
  await live
    .getByRole("button", { name: "Start streaming voice", exact: true })
    .click();
  await pendingOffer;
  const lateCleanup = p.waitForEvent("requestfailed", (r) =>
    r.url().endsWith("/realtime/mock-call-1"),
  );
  await live
    .getByRole("button", { name: "Stop streaming voice", exact: true })
    .click();
  await lateCleanup;
  assert.equal(
    await p.getByLabel("Voice mode", { exact: true }).isEnabled(),
    true,
  );
  await live
    .getByRole("button", { name: "Start streaming voice", exact: true })
    .click();
  try {
    await live
      .getByRole("status")
      .filter({ hasText: "Live voice connected" })
      .waitFor({ timeout: 5000 });
  } catch (e) {
    console.log(
      JSON.stringify({
        liveText: await live.innerText(),
        rtc: await p.evaluate(() => ({
          steps: (window as any).rtcSteps,
          sent: (window as any).rtcSent,
        })),
      }),
    );
    throw e;
  }
  assert.equal(
    await p.getByRole("button", { name: "Continue", exact: true }).isEnabled(),
    false,
  );
  assert.equal(
    await p.getByLabel("Voice mode", { exact: true }).isEnabled(),
    false,
  );
  await p.evaluate(() => {
    const w = window as any;
    w.rtcEvent({ type: "input_audio_buffer.speech_started" });
    w.rtcEvent({
      type: "input_audio_buffer.committed",
      item_id: "turn-one",
      previous_item_id: null,
    });
    w.rtcEvent({
      type: "conversation.item.input_audio_transcription.delta",
      item_id: "turn-one",
      delta: "A draft",
    });
    w.rtcEvent({
      type: "conversation.item.input_audio_transcription.completed",
      item_id: "turn-one",
      transcript: "I found a useful support page.",
    });
  });
  assert.equal(
    await p.getByLabel("Your answer", { exact: true }).inputValue(),
    "I found a useful support page.",
  );
  assert.ok(
    await p.evaluate(() =>
      (window as any).rtcSent.some((e: any) => e.type === "response.cancel"),
    ),
  );
  assert.ok(
    await p.evaluate(() =>
      (window as any).rtcSent.some(
        (e: any) => e.type === "output_audio_buffer.clear",
      ),
    ),
  );
  await live
    .getByRole("button", { name: "Stop streaming voice", exact: true })
    .click();
  assert.equal(await p.evaluate(() => (window as any).rtcClosed), 2);
  await p.getByRole("button", { name: "Continue", exact: true }).click();
  await p
    .getByText("Your perspective makes a difference.", { exact: true })
    .waitFor();

  await p.goto(base + "/s/" + c.s.id);
  await p.getByRole("checkbox").check();
  await p.getByRole("button", { name: "Let’s begin", exact: true }).click();
  await p
    .getByLabel(
      "I agree to record my selected screen or window and microphone narration for this task.",
      { exact: true },
    )
    .check();
  await p
    .getByRole("button", { name: "Share screen and microphone", exact: true })
    .click();
  const help = p.getByRole("region", {
    name: "Optional AI guidance",
    exact: true,
  });
  await help.waitFor();
  assert.equal(
    await help
      .getByRole("button", { name: "Ask about my current screen", exact: true })
      .isEnabled(),
    false,
  );
  assert.equal(screenFrames, 0);
  await help.getByRole("checkbox").check();
  await help
    .getByRole("button", { name: "Ask about my current screen", exact: true })
    .click();
  await help
    .getByText("What do you see in the support area?", { exact: true })
    .waitFor();
  assert.equal(screenFrames, 1);
  await help
    .getByRole("button", { name: "Return to the task", exact: true })
    .click();
  await help.getByText(/Return to the task instructions above/).waitFor();
  assert.equal(screenFrames, 1);
  await p
    .getByRole("button", { name: "Stop sharing and save", exact: true })
    .click();
  await help.waitFor({ state: "detached" });
  await p
    .getByRole("button", { name: "Share screen and microphone", exact: true })
    .waitFor();
  const timer = p.getByRole("region", {
    name: "Optional task timer",
    exact: true,
  });
  await timer
    .getByRole("button", { name: "Start task timer", exact: true })
    .click();
  await timer.getByRole("status").filter({ hasText: "running" }).waitFor();
  await p
    .getByLabel("Your answer", { exact: true })
    .fill("I could not find the support page.");
  assert.equal(
    await p.getByRole("button", { name: "Continue", exact: true }).isEnabled(),
    false,
  );
  await timer.getByRole("button", { name: "Pause timer", exact: true }).click();
  await timer.getByRole("status").filter({ hasText: "paused" }).waitFor();
  await p.reload();
  await timer.getByRole("status").filter({ hasText: "paused" }).waitFor();
  await timer
    .getByRole("button", { name: "Resume timer", exact: true })
    .click();
  await timer
    .getByLabel("Your task outcome", { exact: true })
    .selectOption("not_completed");
  assert.equal(
    await timer
      .getByRole("button", { name: "End task timer", exact: true })
      .isEnabled(),
    false,
  );
  await timer.getByRole("checkbox").check();
  await timer
    .getByRole("button", { name: "End task timer", exact: true })
    .click();
  await timer.getByRole("status").filter({ hasText: "ended" }).waitFor();
  await p
    .getByLabel("Your answer", { exact: true })
    .fill("I could not find the support page.");
  await p.getByRole("button", { name: "Continue", exact: true }).click();
  await p
    .getByText("Your perspective makes a difference.", { exact: true })
    .waitFor();
  await context.request.post(base + "/api/auth/login", {
    data: { email: c.email, password: "saved-library-password" },
  });
  await p.goto(base + `/?study=${c.s.id}&tab=visual`);
  const results = p.getByRole("region", { name: "Task control measures" });
  await results.getByText(/1 included ended attempts/).waitFor();
  await results.getByRole("checkbox").check();
  const pending = p.waitForEvent("download");
  await results
    .getByRole("button", {
      name: "Export reviewed task measures CSV",
      exact: true,
    })
    .click();
  assert.match((await pending).suggestedFilename(), /usability\.csv$/);
  await results.getByRole("button", { name: /^Inspect task source/ }).click();
  await p
    .getByRole("dialog")
    .getByText("I could not find the support page.", { exact: true })
    .waitFor();
  await p.getByRole("button", { name: "Close dialog", exact: true }).click();
  await p.setViewportSize({ width: 390, height: 844 });
  assert.ok(
    await p.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth + 1,
    ),
  );
  assert.deepEqual(errors, []);
  mkdirSync("test-results", { recursive: true });
  await p.screenshot({
    path: "test-results/richer-browser.png",
    fullPage: true,
  });
  writeFileSync(
    "test-results/richer-browser-evaluation.json",
    JSON.stringify(
      {
        passed: true,
        mockedRealtimeProvider: true,
        checks: [
          "explicit live-audio consent",
          "partial/final transcript review without guide advancement",
          "automatic cancellation/audio-buffer interruption",
          "transport cleanup",
          "task timer pause/resume/reload/outcome gates",
          "original-source inspection and reviewed CSV",
          "mobile layout",
        ],
        errors,
      },
      null,
      2,
    ),
  );
  console.log(
    "Richer interviewing browser checks passed; RTC transport/provider events are marked fixtures.",
  );
} finally {
  await browser?.close();
  await stop();
}
