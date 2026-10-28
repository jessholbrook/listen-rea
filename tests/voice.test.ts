import test from "node:test";
import assert from "node:assert/strict";
import { newVoiceActivity, voiceActivity } from "../src/lib/voice";
import { providerFetch } from "../src/lib/provider-transport";
import { fetch, MockAgent } from "undici";
test("voice activity ends only after sustained speech followed by silence", () => {
  let state = newVoiceActivity(0);
  for (let t = 100; t <= 1000; t += 100)
    state = voiceActivity(state, 0.1, t).state;
  assert.equal(voiceActivity(state, 0, 2000).finish, false);
  assert.equal(voiceActivity(state, 0, 2600).finish, true);
  const silence = newVoiceActivity(0);
  assert.equal(voiceActivity(silence, 0, 21000).idle, true);
  assert.equal(voiceActivity(silence, 0, 21000).finish, false);
  let click = voiceActivity(newVoiceActivity(0), 0.1, 100).state;
  assert.equal(voiceActivity(click, 0, 5000).finish, false);
});
test("provider deadline cancels a stalled HTTP request and caller cancellation is honored", async () => {
  const mock = new MockAgent();
  mock.disableNetConnect();
  mock
    .get("https://api.openai.com")
    .intercept({ path: "/slow", method: "POST" })
    .reply(200, "ok")
    .delay(200);
  const transport = ((url, init) =>
    fetch(url, { ...init, dispatcher: mock })) as typeof fetch;
  try {
    await assert.rejects(
      providerFetch(
        "https://api.openai.com/slow",
        { method: "POST" },
        { timeoutMs: 25 },
        transport,
      ),
      (e) => e instanceof Error && e.name === "TimeoutError",
    );
    const c = new AbortController();
    c.abort();
    await assert.rejects(
      providerFetch(
        "https://api.openai.com/canceled",
        { method: "POST" },
        { timeoutMs: 1000, signal: c.signal },
        transport,
      ),
      (e) => e instanceof Error && e.name === "AbortError",
    );
  } finally {
    await mock.close();
  }
});
