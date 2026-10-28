import ffmpeg from "ffmpeg-static";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import type { SampleFrame } from "./visual";
const exec = promisify(execFile);
export type VisualFrame = SampleFrame & { jpeg: Buffer };
export async function extractVisualFrames(
  bytes: Buffer,
  times: number[],
  signal: AbortSignal,
): Promise<VisualFrame[]> {
  if (!ffmpeg) throw new Error("VISUAL_UNAVAILABLE");
  signal.throwIfAborted();
  if (
    bytes.length > 3 * 1024 * 1024 ||
    !times.length ||
    times.length > 6 ||
    times.some((t) => !Number.isInteger(t) || t < 0 || t > 600000)
  )
    throw new Error("VISUAL_RANGE");
  const dir = await mkdtemp(path.join(tmpdir(), "echo-visual-"));
  try {
    const file = path.join(dir, "source");
    await writeFile(file, bytes, { mode: 0o600 });
    const frames: VisualFrame[] = [];
    for (const [n, requestMs] of times.entries()) {
      signal.throwIfAborted();
      const { stdout, stderr } = await exec(
        ffmpeg,
        [
          "-hide_banner",
          "-loglevel",
          "info",
          "-nostdin",
          "-threads",
          "1",
          "-filter_threads",
          "1",
          "-protocol_whitelist",
          "file,pipe",
          "-i",
          file,
          "-an",
          "-vf",
          `select=gte(t\\,${requestMs / 1000}),scale=w='min(960,iw)':h=-2,showinfo`,
          "-frames:v",
          "1",
          "-fps_mode",
          "vfr",
          "-q:v",
          "3",
          "-c:v",
          "mjpeg",
          "-threads",
          "1",
          "-f",
          "image2pipe",
          "pipe:1",
        ],
        { signal, timeout: 20000, maxBuffer: 1024 * 1024, encoding: "buffer" },
      );
      const match = stderr.toString().match(/\bpts_time:([\d.e+-]+)/),
        actual = match ? Number(match[1]) * 1000 : NaN,
        jpeg = Buffer.from(stdout);
      if (
        !Number.isFinite(actual) ||
        Math.abs(actual - requestMs) > 1000 ||
        jpeg.length < 16 ||
        jpeg.length > 350000 ||
        jpeg[0] !== 0xff ||
        jpeg[1] !== 0xd8
      )
        throw new Error("VISUAL_FRAME_UNAVAILABLE");
      frames.push({
        id: "frame-" + (n + 1),
        requestMs,
        atMs: Math.round(actual),
        digest: createHash("sha256").update(jpeg).digest("hex"),
        bytes: jpeg.length,
        jpeg,
      });
    }
    return frames;
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
