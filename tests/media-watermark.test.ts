import test from "node:test";
import assert from "node:assert/strict";
import sharp from "sharp";
import {
  watermarkImage,
  watermarkVideo,
} from "../src/lib/media-watermark-process";
import { processConceptVideo } from "../src/lib/concept-video-process";
import { fixtureVideo } from "./concept-videos-fixture";
import { execFileSync } from "node:child_process";
import ffmpeg from "ffmpeg-static";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
test("Image watermark changes pixels in three separated label bands while preserving size, original bytes and pixels outside the marks", async () => {
  const input = await sharp({
      create: { width: 640, height: 360, channels: 3, background: "#226644" },
    })
      .png()
      .toBuffer(),
    original = Buffer.from(input),
    marked = await watermarkImage(input, 640, 360);
  const src = await sharp(input).removeAlpha().raw().toBuffer(),
    out = await sharp(marked).removeAlpha().raw().toBuffer();
  assert.deepEqual(input, original);
  assert.equal((await sharp(marked).metadata()).width, 640);
  for (const [top, bottom] of [
    [30, 85],
    [145, 210],
    [270, 325],
  ]) {
    let changed = 0;
    for (let y = top; y < bottom; y++)
      for (let x = 0; x < 640; x++)
        if (Math.abs(src[(y * 640 + x) * 3] - out[(y * 640 + x) * 3]) > 10)
          changed++;
    assert.ok(
      changed > 1000,
      "A visible label band must be burned into the image",
    );
  }
  assert.deepEqual(
    out.subarray(0, 640 * 20 * 3),
    src.subarray(0, 640 * 20 * 3),
  );
  assert.deepEqual(out.subarray(640 * 340 * 3), src.subarray(640 * 340 * 3));
});
test(
  "Video watermark survives decoded frames at separate playback times, preserves dimensions/duration and copies the original audio stream",
  { timeout: 90000 },
  async () => {
    const source = await processConceptVideo(
        await fixtureVideo("mp4", 1),
        "video/mp4",
      ),
      marked = await watermarkVideo(source.data, source.width, source.height);
    assert.ok(Math.abs(marked.durationMs - source.durationMs) < 100);
    const dir = await mkdtemp(path.join(tmpdir(), "watermark-verify-"));
    try {
      const a = path.join(dir, "source.mp4"),
        b = path.join(dir, "marked.mp4");
      await writeFile(a, source.data);
      await writeFile(b, marked.data);
      const decode = (file: string, time: number) =>
        execFileSync(
          ffmpeg!,
          [
            "-hide_banner",
            "-loglevel",
            "error",
            "-ss",
            String(time),
            "-i",
            file,
            "-frames:v",
            "1",
            "-f",
            "rawvideo",
            "-pix_fmt",
            "rgb24",
            "pipe:1",
          ],
          { maxBuffer: 4 * 1024 * 1024 },
        );
      for (const time of [0.15, 0.75]) {
        const plain = decode(a, time),
          out = decode(b, time);
        assert.equal(out.length, plain.length);
        assert.equal(out.length, source.width * source.height * 3);
        let changed = 0;
        for (
          let y = Math.floor(source.height * 0.36);
          y < source.height * 0.61;
          y++
        )
          for (let x = 0; x < source.width; x++) {
            const i = (y * source.width + x) * 3;
            if (Math.abs(out[i + 1] - plain[i + 1]) > 20) changed++;
          }
        assert.ok(
          changed > 300,
          "The mark must remain in later decoded frames",
        );
      }
      const audio = (file: string) =>
        execFileSync(
          ffmpeg!,
          [
            "-hide_banner",
            "-loglevel",
            "error",
            "-i",
            file,
            "-map",
            "0:a:0",
            "-f",
            "s16le",
            "pipe:1",
          ],
          { maxBuffer: 4 * 1024 * 1024 },
        );
      assert.deepEqual(audio(b), audio(a));
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  },
);
