import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import ffmpeg from "ffmpeg-static";
import { toneWav } from "./reporting-fixture";
import type { MediaClip } from "../src/lib/reporting";
const exec = promisify(execFile);
test(
  "renderer trims, orders and captions audio/screen clips into decodable MP4 and rejects unavailable ranges",
  { timeout: 60000 },
  async () => {
    const dir = mkdtempSync(join(tmpdir(), "echo-render-test-"));
    process.env.RESEARCH_DATA_DIR = dir;
    process.env.VERCEL = "";
    process.env.RESEARCH_STORAGE = "local";
    const { writeRecording } = await import("../src/lib/storage"),
      { renderReel, mp4Duration } = await import("../src/lib/render");
    try {
      const audio = randomUUID(),
        video = randomUUID();
      await writeRecording(audio, toneWav(), "audio/wav");
      const { stdout } = await exec(
        ffmpeg!,
        [
          "-hide_banner",
          "-loglevel",
          "error",
          "-f",
          "lavfi",
          "-i",
          "color=c=red:s=320x240:r=12",
          "-f",
          "lavfi",
          "-i",
          "sine=frequency=660:sample_rate=24000",
          "-t",
          "3",
          "-c:v",
          "libvpx",
          "-b:v",
          "150k",
          "-c:a",
          "libopus",
          "-f",
          "webm",
          "pipe:1",
        ],
        { encoding: "buffer", maxBuffer: 3 * 1024 * 1024 },
      );
      await writeRecording(video, stdout, "video/webm");
      const base = {
        id: randomUUID(),
        workspaceId: "w",
        studyId: "s",
        interviewId: "i",
        turnId: "t",
        name: "Fixture",
        quote: "Synthetic source quote",
        startMs: 200,
        endMs: 1200,
        caption: "Reviewed caption <literal> & context",
        reviewed: true,
        revisionId: "r",
        version: 1,
        createdAt: "2026-10-19",
      };
      const clips: MediaClip[] = [
        { ...base, mediaId: audio, kind: "audio" },
        {
          ...base,
          id: randomUUID(),
          mediaId: video,
          kind: "screen",
          startMs: 500,
          endMs: 1500,
        },
      ];
      const rendered = await renderReel(clips, AbortSignal.timeout(30000));
      assert.ok(Math.abs(rendered.durationMs - 2000) < 500);
      assert.ok(rendered.bytes.length < 3 * 1024 * 1024);
      assert.equal(mp4Duration(rendered.bytes), rendered.durationMs);
      assert.equal(rendered.segments[0].startMs, 0);
      assert.equal(rendered.segments[1].startMs, rendered.segments[0].endMs);
      assert.equal(rendered.segments[1].endMs, rendered.durationMs);
      const out = join(dir, "out.mp4");
      writeFileSync(out, rendered.bytes);
      await exec(ffmpeg!, ["-v", "error", "-i", out, "-f", "null", "-"]);
      const image = await exec(
        ffmpeg!,
        [
          "-v",
          "error",
          "-ss",
          "1.5",
          "-i",
          out,
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
        { encoding: "buffer" },
      );
      assert.ok(
        image.stdout[0] > image.stdout[1] * 1.5,
        "second clip retains the red screen source",
      );
      await assert.rejects(
        renderReel(
          [{ ...clips[0], startMs: 10000, endMs: 11000 }],
          AbortSignal.timeout(30000),
        ),
        /RENDER_SOURCE_RANGE|Command failed/,
      );
      const controller = new AbortController();
      controller.abort();
      await assert.rejects(renderReel(clips, controller.signal));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  },
);
