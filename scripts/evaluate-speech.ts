import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { start, stop, client, base } from "../tests/harness";
import { providerRequest } from "../src/lib/ai";
if (!process.env.RESEARCH_AI_KEY) {
  console.error("RESEARCH_AI_KEY is required.");
  process.exit(2);
}
const checks: unknown[] = [];
try {
  await start({ live: true });
  const owner = await client(),
    participant = await client();
  await owner("auth/signup", "POST", {
    name: "Speech Evaluation",
    email: "speech@example.test",
    password: "speech-evaluation-password",
  });
  let s = (
    await owner("studies", "POST", { title: "Synthetic speech fixture" })
  ).study;
  const g = s.draft;
  g.questions = [{ ...g.questions[1], followUps: 0 }];
  s = (await owner("studies/" + s.id, "PUT", { guide: g, version: s.version }))
    .study;
  s = (
    await owner("studies/" + s.id + "/publish", "POST", { version: s.version })
  ).study;
  await owner("studies/" + s.id + "/fielding", "POST", { state: "active" });
  const started = await participant("public/" + s.id, "POST", {
      consent: true,
    }),
    i = started.interview,
    headers = { "x-interview-token": started.token };
  let t = Date.now();
  console.log("Generating synthetic speech…");
  const speech = await providerRequest("audio/speech", {
    model: process.env.RESEARCH_SPEECH_MODEL || "gpt-4o-mini-tts",
    voice: "coral",
    input: "We found the customer feedback in our shared research notebook.",
    response_format: "wav",
  });
  const audio = await speech.arrayBuffer();
  checks.push({
    check: "Live speech synthesis",
    passed: true,
    elapsedMs: Date.now() - t,
    audioBytes: audio.byteLength,
  });
  const upload = await fetch(base + "/api/interviews/" + i.id + "/recording", {
    method: "POST",
    headers: {
      ...headers,
      "content-type": "audio/wav",
      "x-recording-consent": "yes",
      "x-recording-duration": "5000",
    },
    body: audio,
  });
  assert.equal(upload.status, 200);
  const { audioId } = await upload.json();
  t = Date.now();
  console.log("Transcribing the saved synthetic recording…");
  const transcript = await participant(
    "interviews/" + i.id + "/transcribe",
    "POST",
    { audioId },
    headers,
  );
  assert.equal(transcript.status, 200, JSON.stringify(transcript));
  assert.match(transcript.text, /feedback|notebook/i);
  checks.push({
    check: "Stored recording → live transcription",
    passed: true,
    elapsedMs: Date.now() - t,
    text: transcript.text,
  });
  const retry = await participant(
    "interviews/" + i.id + "/transcribe",
    "POST",
    { audioId },
    headers,
  );
  assert.equal(retry.cached, true);
  const usage = (await owner("me")).usage;
  assert.equal(
    usage
      .filter((u: any) => u.operation === "transcription")
      .reduce((n: number, u: any) => n + Number(u.requests), 0),
    1,
  );
  checks.push({
    check: "Transcription retry is cached with one provider call",
    passed: true,
  });
  t = Date.now();
  console.log("Checking the participant read-aloud route…");
  const read = await fetch(base + "/api/interviews/" + i.id + "/speech", {
    method: "POST",
    headers,
  });
  assert.equal(read.status, 200);
  assert.ok((await read.arrayBuffer()).byteLength > 100);
  checks.push({
    check: "Participant live read-aloud endpoint",
    passed: true,
    elapsedMs: Date.now() - t,
  });
  console.log(
    "Live speech, transcription, cached retry and read-aloud checks passed.",
  );
} catch (e) {
  checks.push({
    check: "Speech evaluation stopped",
    passed: false,
    error: (e as Error).message,
  });
  console.error("Speech evaluation failed:", (e as Error).message);
  process.exitCode = 1;
} finally {
  mkdirSync("test-results", { recursive: true });
  writeFileSync(
    "test-results/live-speech-evaluation.json",
    JSON.stringify(
      { date: new Date().toISOString(), syntheticAudio: true, checks },
      null,
      2,
    ),
  );
  await stop();
}
