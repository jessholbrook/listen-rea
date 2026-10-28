import sharp from "sharp";
import ffmpeg from "ffmpeg-static";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { watermarkSvg } from "./media-watermark";
import { mp4Duration } from "./render";
import { fail } from "./http";
import { conceptImageMaxOutput } from "./concept-images";
import { conceptVideoMaxOutput } from "./concept-videos";
const exec = promisify(execFile);
export async function watermarkImage(
  bytes: Buffer,
  width: number,
  height: number,
) {
  const data = await sharp(bytes)
    .composite([{ input: watermarkSvg(width, height) }])
    .png({ compressionLevel: 9 })
    .toBuffer();
  if (data.length > conceptImageMaxOutput)
    fail(413, "The watermarked image exceeds 3 MB. Use a simpler image.");
  return data;
}
export async function watermarkVideo(
  bytes: Buffer,
  width: number,
  height: number,
) {
  if (!ffmpeg) fail(503, "Video processing is unavailable.");
  const dir = await mkdtemp(path.join(tmpdir(), "echo-watermark-"));
  try {
    const input = path.join(dir, "source.mp4"),
      overlay = path.join(dir, "mark.png"),
      output = path.join(dir, "marked.mp4");
    await writeFile(input, bytes, { mode: 0o600 });
    await writeFile(
      overlay,
      await sharp(watermarkSvg(width, height)).png().toBuffer(),
      { mode: 0o600 },
    );
    await exec(
      ffmpeg,
      [
        "-hide_banner",
        "-nostdin",
        "-y",
        "-protocol_whitelist",
        "file,pipe",
        "-f",
        "mov",
        "-enable_drefs",
        "0",
        "-use_absolute_path",
        "0",
        "-i",
        input,
        "-i",
        overlay,
        "-filter_complex_threads",
        "1",
        "-filter_complex",
        "[0:v:0][1:v:0]overlay=0:0:format=auto,format=yuv420p[v]",
        "-map",
        "[v]",
        "-map",
        "0:a:0?",
        "-threads",
        "2",
        "-sn",
        "-dn",
        "-c:v",
        "libx264",
        "-preset",
        "veryfast",
        "-crf",
        "25",
        "-maxrate",
        "1000k",
        "-bufsize",
        "2000k",
        "-c:a",
        "copy",
        "-map_metadata",
        "-1",
        "-map_chapters",
        "-1",
        "-movflags",
        "+faststart",
        output,
      ],
      { timeout: 45000, maxBuffer: 512 * 1024 },
    );
    const data = await readFile(output);
    if (data.length > conceptVideoMaxOutput)
      fail(
        413,
        "The watermarked video exceeds 8 MB. Use a shorter or simpler clip.",
      );
    return { data, durationMs: mp4Duration(data) };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
