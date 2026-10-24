import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import ffmpeg from "ffmpeg-static";
import { imageGuide } from "./concept-images-fixture";
const exec = promisify(execFile);
export async function fixtureVideo(
  format: "mp4" | "webm" = "mp4",
  seconds = 1,
  color = "red",
) {
  const dir = await mkdtemp(path.join(tmpdir(), "concept-video-fixture-"));
  try {
    const file = path.join(dir, "fixture." + format);
    await exec(
      ffmpeg!,
      [
        "-hide_banner",
        "-loglevel",
        "error",
        "-y",
        "-f",
        "lavfi",
        "-i",
        `color=c=${color}:s=320x180:r=12:d=${seconds}`,
        "-f",
        "lavfi",
        "-i",
        `sine=frequency=440:sample_rate=16000:duration=${seconds}`,
        "-threads",
        "1",
        "-c:v",
        format === "mp4" ? "libx264" : "libvpx-vp9",
        "-c:a",
        format === "mp4" ? "aac" : "libopus",
        ...(format === "mp4"
          ? ["-pix_fmt", "yuv420p", "-movflags", "+faststart"]
          : []),
        "-shortest",
        file,
      ],
      { timeout: 20000, maxBuffer: 256 * 1024 },
    );
    return await readFile(file);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
export function videoGuide(ids: string[] = []) {
  const g = imageGuide();
  g.conceptTest!.concepts.forEach((c, n) => {
    c.videoAssetId = ids[n] || null;
    c.videoTranscript =
      "A " +
      (n ? "blue" : "red") +
      " screen shows the concept. A short tone plays. No speech.";
  });
  return g;
}
