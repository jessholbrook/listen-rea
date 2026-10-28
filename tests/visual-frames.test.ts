import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import ffmpeg from "ffmpeg-static";
import { extractVisualFrames } from "../src/lib/visual-frames";
import { visualFixture } from "./visual-fixture";
test(
  "decoded sample timestamps and colors match an independently annotated screen-state fixture",
  { timeout: 60000 },
  async () => {
    const fixture = JSON.parse(
        readFileSync("tests/fixtures/visual-events.json", "utf8"),
      ),
      video = visualFixture(),
      frames = await extractVisualFrames(
        video,
        [500, 2000, 3500],
        AbortSignal.timeout(30000),
      );
    const results = [];
    for (const f of frames) {
      const state = fixture.states.find(
        (s: any) => f.atMs >= s.startMs && f.atMs < s.endMs,
      );
      assert.ok(state);
      assert.ok(
        Math.abs(f.atMs - f.requestMs) <= Math.ceil(1000 / fixture.fps),
      );
      const rgb = execFileSync(
        ffmpeg!,
        [
          "-v",
          "error",
          "-i",
          "pipe:0",
          "-vf",
          "crop=1:1:10:10:exact=1",
          "-f",
          "rawvideo",
          "-pix_fmt",
          "rgb24",
          "pipe:1",
        ],
        { input: f.jpeg },
      );
      assert.ok(
        state.headerColor.every(
          (c: number, n: number) => Math.abs(c - rgb[n]) < 15,
        ),
      );
      results.push({
        requestMs: f.requestMs,
        decodedMs: f.atMs,
        expectedHeading: state.heading,
        colorMatched: true,
      });
    }
    const repeated = (
      await extractVisualFrames(video, [2000], AbortSignal.timeout(10000))
    )[0];
    assert.equal(repeated.digest, frames[1].digest);
    assert.equal(repeated.atMs, frames[1].atMs);
    await assert.rejects(() =>
      extractVisualFrames(
        Buffer.from("invalid"),
        [500],
        AbortSignal.timeout(10000),
      ),
    );
    const controller = new AbortController();
    controller.abort();
    await assert.rejects(() =>
      extractVisualFrames(video, [500], controller.signal),
    );
    mkdirSync("test-results", { recursive: true });
    writeFileSync(
      "test-results/visual-frame-evaluation.json",
      JSON.stringify(
        {
          fixture: fixture.id,
          results,
          passed: true,
          limitations: fixture.unobserved,
        },
        null,
        2,
      ),
    );
    writeFileSync("test-results/visual-fixture.mp4", video);
    writeFileSync("test-results/visual-fixture-home.jpg", frames[0].jpeg);
    writeFileSync("test-results/visual-fixture-support.jpg", frames[1].jpeg);
  },
);
