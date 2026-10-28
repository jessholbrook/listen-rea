import { Response as ProviderResponse } from "undici";
import { recordingVideo } from "./library-recordings-fixture";
import test from "node:test";
import assert from "node:assert/strict";
import ffmpeg from "ffmpeg-static";
import { execFileSync } from "node:child_process";
import {
  extractImportAudio,
  inspectImportMedia,
} from "../src/lib/import-media";
import { transcribeExternalRecording } from "../src/lib/library-recordings-server";
import {
  recordingCreate,
  recordingReview,
  type LibraryRecording,
} from "../src/lib/library-recordings";
import { randomUUID } from "node:crypto";

test("video recording transcription decodes audio only and sends fixed WAV bytes/model/language without filenames, metadata or research fields", async () => {
  const bytes = recordingVideo(),
    signal = AbortSignal.timeout(15000);
  const duration = await inspectImportMedia(bytes, true, signal);
  assert.ok(duration >= 1000 && duration < 2000);
  const decoded = await extractImportAudio(bytes, signal);
  assert.equal(decoded.subarray(0, 4).toString(), "RIFF");
  assert.equal(decoded.subarray(8, 12).toString(), "WAVE");
  assert.ok(decoded.length < 100000);
  assert.equal(decoded.equals(bytes), false);
  const r: LibraryRecording = {
    ...recordingCreate.parse({
      requestId: randomUUID(),
      studyId: randomUUID(),
      title: "PRIVATE_RECORDING_TITLE",
      externalId: "PRIVATE_EXTERNAL_ID",
      language: "fr",
      permissionConfirmed: true,
      transcriptionPermission: true,
    }),
    id: randomUUID(),
    workspaceId: randomUUID(),
    inputHash: "hash",
    createdAt: "date",
    expiresAt: "date",
    version: 2,
    status: "uploaded",
    file: {
      id: randomUUID(),
      mime: "video/webm",
      bytes: bytes.length,
      digest: "digest",
      durationMs: duration,
    },
  };
  let used: any[] = [];
  const result = await transcribeExternalRecording(
    bytes,
    r,
    signal,
    async (route, body, multipart, passedSignal) => {
      assert.equal(route, "audio/transcriptions");
      assert.equal(multipart, true);
      assert.equal(passedSignal, signal);
      const form = body as any;
      assert.deepEqual([...form.keys()].sort(), ["file", "language", "model"]);
      assert.equal(form.get("language"), "fr");
      const audio = form.get("file");
      assert.equal(audio.name, "recording.wav");
      assert.equal(audio.type, "audio/wav");
      assert.equal(
        Buffer.from(await audio.arrayBuffer())
          .subarray(0, 4)
          .toString(),
        "RIFF",
      );
      return ProviderResponse.json({
        text: "Marked synthetic literal transcription of the source audio.",
      });
    },
    async (...args: any[]) => {
      used = args;
    },
  );
  assert.ok(result.text.includes("synthetic"));
  assert.equal(used[2], "library-recording-transcription");
  assert.equal(used[6], duration / 1000);
  assert.equal(JSON.stringify(used).includes("PRIVATE_"), false);
});
test("recording consent and review contracts reject forged originals, unsupported language, omitted attestation and oversized transcript edits", () => {
  const input = {
    requestId: randomUUID(),
    studyId: randomUUID(),
    title: "Recording",
    externalId: "id",
    language: "en",
    permissionConfirmed: true,
    transcriptionPermission: true,
  };
  assert.equal(recordingCreate.safeParse(input).success, true);
  for (const extra of [
    { permissionConfirmed: false },
    { transcriptionPermission: false },
    { language: "xx" },
    { fileId: randomUUID() },
  ])
    assert.equal(
      recordingCreate.safeParse({ ...input, ...extra }).success,
      false,
    );
  assert.equal(
    recordingReview.safeParse({
      version: 1,
      text: "A reviewed transcript",
      reviewed: true,
    }).success,
    true,
  );
  for (const extra of [
    { original: { text: "forged" } },
    { text: "x".repeat(150001) },
    { reviewed: undefined },
    { version: 0 },
  ])
    assert.equal(
      recordingReview.safeParse({
        version: 1,
        text: "A reviewed transcript",
        reviewed: true,
        ...extra,
      }).success,
      false,
    );
});

test("durable transcription sends only the next bounded audio interval and accounts for its actual duration", async () => {
  const { toneWav } = await import("./reporting-fixture"),
    bytes = toneWav(360000);
  for (const completed of [0, 1]) {
    let seconds = 0;
    const r = {
      language: "en",
      workspaceId: randomUUID(),
      studyId: randomUUID(),
      file: { durationMs: 360000 },
      job: {
        total: 2,
        completed: completed
          ? [
              {
                text: "Already saved step",
                model: "marked",
                generatedAt: new Date().toISOString(),
              },
            ]
          : [],
      },
    } as LibraryRecording;
    const expected = completed === 0 ? 300 : 60;
    await transcribeExternalRecording(
      bytes,
      r,
      AbortSignal.timeout(20000),
      async (_route, body) => {
        const audio = (body as any).get("file");
        assert.ok(audio.size >= expected * 32000);
        assert.ok(audio.size < expected * 32000 + 200);
        return ProviderResponse.json({ text: "MARKED_BOUNDED_AUDIO_INTERVAL" });
      },
      async (...args: any[]) => {
        seconds = args[6];
      },
    );
    assert.equal(seconds, expected);
  }
});
