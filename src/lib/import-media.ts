import ffmpeg from "ffmpeg-static";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
const exec = promisify(execFile);
export async function inspectImportMedia(
  bytes: Buffer,
  video: boolean,
  signal: AbortSignal,
  maxDurationMs = 600000,
) {
  if (!ffmpeg) throw new Error("IMPORT_MEDIA_UNAVAILABLE");
  const dir = await mkdtemp(path.join(tmpdir(), "echo-import-"));
  try {
    const file = path.join(dir, "source");
    await writeFile(file, bytes, { mode: 0o600 });
    const result = await exec(
      ffmpeg,
      [
        "-v",
        "error",
        "-nostdin",
        "-threads",
        "1",
        "-protocol_whitelist",
        "file,pipe",
        "-i",
        file,
        ...(video ? ["-map", "0:v:0"] : []),
        "-map",
        "0:a:0",
        "-progress",
        "pipe:1",
        "-f",
        "null",
        "-",
      ],
      { signal, timeout: 60000, maxBuffer: 1024 * 1024 },
    );
    const durations = [...result.stdout.matchAll(/out_time_us=(\d+)/g)].map(
        (m) => Number(m[1]) / 1000,
      ),
      durationMs = Math.round(Math.max(0, ...durations));
    if (durationMs < 100 || durationMs > maxDurationMs)
      throw new Error("IMPORT_MEDIA_DURATION");
    return durationMs;
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

// Decode only audio into bounded mono PCM. Video frames and file metadata never reach the provider.
export async function extractImportAudio(
  bytes: Buffer,
  signal: AbortSignal,
  startMs = 0,
  durationMs = 600000,
) {
  if (!ffmpeg) throw Error("IMPORT_MEDIA_UNAVAILABLE");
  const dir = await mkdtemp(path.join(tmpdir(), "echo-transcribe-"));
  try {
    const source = path.join(dir, "source"),
      output = path.join(dir, "audio.wav");
    await writeFile(source, bytes, { mode: 0o600 });
    await exec(
      ffmpeg,
      [
        "-v",
        "error",
        "-nostdin",
        "-threads",
        "1",
        "-protocol_whitelist",
        "file,pipe",
        "-ss",
        String(startMs / 1000),
        "-i",
        source,
        "-map",
        "0:a:0",
        "-vn",
        "-ac",
        "1",
        "-ar",
        "16000",
        "-c:a",
        "pcm_s16le",
        "-t",
        String(durationMs / 1000),
        output,
      ],
      { signal, timeout: 60000, maxBuffer: 1024 * 1024 },
    );
    const audio = await (await import("node:fs/promises")).readFile(output);
    if (audio.length > 20 * 1024 * 1024 || audio.length < 44)
      throw Error("IMPORT_AUDIO_SIZE");
    return audio;
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

export function matchesImportMedia(bytes: Buffer, mime: string) {
  return mime.endsWith("/webm")
    ? bytes.subarray(0, 4).toString("hex") === "1a45dfa3"
    : mime.endsWith("/mp4")
      ? bytes.subarray(4, 8).toString() === "ftyp"
      : mime === "audio/ogg"
        ? bytes.subarray(0, 4).toString() === "OggS"
        : bytes.subarray(0, 4).toString() === "RIFF" &&
          bytes.subarray(8, 12).toString() === "WAVE";
}
