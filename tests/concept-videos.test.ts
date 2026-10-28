import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { guideSchema } from "../src/lib/domain";
import { videoGuide, fixtureVideo } from "./concept-videos-fixture";
import {
  applyFields,
  validateFields,
  guideSource,
} from "../src/lib/localization";
import { translatedFields } from "./localization-fixture";
import { processConceptVideo } from "../src/lib/concept-video-process";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import ffmpeg from "ffmpeg-static";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
test("Video references require bounded accessible text; translations preserve IDs and stale fingerprints change", () => {
  const g = videoGuide([randomUUID(), randomUUID()]);
  assert.ok(guideSchema.safeParse(g).success);
  for (const patch of [
    { videoTranscript: "" },
    { videoTranscript: "x".repeat(6001) },
    { videoAssetId: "invalid" },
  ]) {
    const bad = structuredClone(g);
    Object.assign(bad.conceptTest!.concepts[0], patch);
    assert.equal(guideSchema.safeParse(bad).success, false);
  }
  for (const language of ["es", "fr"] as const) {
    const fields = translatedFields(g, language);
    validateFields(g, fields);
    const translated = guideSchema.parse(applyFields(g, fields));
    assert.equal(
      translated.conceptTest!.concepts[0].videoAssetId,
      g.conceptTest!.concepts[0].videoAssetId,
    );
    assert.match(
      translated.conceptTest!.concepts[0].videoTranscript!,
      language === "es" ? /^ES / : /^FR /,
    );
  }
  const before = guideSource(g);
  g.conceptTest!.concepts[0].videoTranscript = "Changed description.";
  assert.notEqual(guideSource(g), before);
});
test(
  "Video normalization produces decodable H264/AAC MP4 with preserved sample color/audio and rejects malformed, mismatched, oversized and long clips",
  { timeout: 90000 },
  async () => {
    const exec = promisify(execFile);
    const dir = await mkdtemp(path.join(tmpdir(), "video-verify-"));
    try {
      for (const format of ["mp4", "webm"] as const) {
        const raw = await fixtureVideo(format),
          out = await processConceptVideo(raw, "video/" + format);
        assert.ok(out.durationMs >= 900 && out.durationMs <= 1150);
        assert.ok(out.width <= 1280 && out.height <= 720);
        const file = path.join(dir, format + ".mp4");
        await writeFile(file, out.data);
        const frame = await exec(
          ffmpeg!,
          [
            "-hide_banner",
            "-loglevel",
            "error",
            "-i",
            file,
            "-frames:v",
            "1",
            "-vf",
            "scale=1:1",
            "-pix_fmt",
            "rgb24",
            "-f",
            "rawvideo",
            "pipe:1",
          ],
          { encoding: "buffer", maxBuffer: 256 * 1024 },
        );
        assert.ok(
          frame.stdout[0] > 220 && frame.stdout[1] < 20 && frame.stdout[2] < 20,
        );
        let details = "";
        try {
          await exec(ffmpeg!, ["-hide_banner", "-i", file]);
        } catch (e) {
          details = String((e as { stderr?: string }).stderr);
        }
        assert.match(details, /Video: h264/);
        assert.match(details, /Audio: aac/);
        const pcm = (
          await exec(
            ffmpeg!,
            [
              "-v",
              "error",
              "-i",
              file,
              "-vn",
              "-ac",
              "1",
              "-ar",
              "8000",
              "-f",
              "f32le",
              "pipe:1",
            ],
            { encoding: "buffer", maxBuffer: 256 * 1024 },
          )
        ).stdout;
        let energy = 0,
          crossings = 0,
          prior = 0;
        for (let n = 0; n + 4 <= pcm.length; n += 4) {
          const sample = pcm.readFloatLE(n);
          energy += sample * sample;
          if (prior < 0 && sample >= 0) crossings++;
          prior = sample;
        }
        assert.ok(Math.sqrt(energy / (pcm.length / 4)) > 0.02);
        assert.ok(
          crossings >= 400 && crossings <= 480,
          "The independently decoded tone retains its 440 Hz frequency.",
        );
      }
      await assert.rejects(
        processConceptVideo(Buffer.from("not-video"), "video/mp4"),
      );
      await assert.rejects(
        processConceptVideo(await fixtureVideo("mp4"), "video/webm"),
      );
      await assert.rejects(
        processConceptVideo(Buffer.alloc(3 * 1024 * 1024 + 1), "video/mp4"),
      );
      await assert.rejects(
        processConceptVideo(await fixtureVideo("mp4", 61), "video/mp4"),
        /60 seconds/,
      );
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  },
);
