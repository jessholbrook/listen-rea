import ffmpeg from "ffmpeg-static";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { readRecording, maxRecordingBytes } from "./storage";
import { captionsVtt, type MediaClip } from "./reporting";
const exec = promisify(execFile);
export function mp4Duration(bytes: Buffer): number {
  function box(start: number, end: number): number | undefined {
    for (let at = start; at + 8 <= end;) {
      let size = bytes.readUInt32BE(at),
        head = 8;
      const type = bytes.toString("ascii", at + 4, at + 8);
      if (size === 1) {
        if (at + 16 > end) return;
        size = Number(bytes.readBigUInt64BE(at + 8));
        head = 16;
      }
      if (size === 0) size = end - at;
      if (size < head || at + size > end) return;
      if (type === "moov") {
        const value = box(at + head, at + size);
        if (value !== undefined) return value;
      }
      if (type === "mvhd") {
        const p = at + head;
        if (p + 24 > at + size) return;
        const v = bytes[p];
        const scale = bytes.readUInt32BE(p + (v === 1 ? 20 : 12));
        const duration =
          v === 1
            ? p + 32 <= at + size
              ? Number(bytes.readBigUInt64BE(p + 24))
              : 0
            : bytes.readUInt32BE(p + 16);
        return scale ? (duration * 1000) / scale : 0;
      }
      at += size;
    }
  }
  const ms = box(0, bytes.length);
  if (!ms || !Number.isFinite(ms)) throw new Error("RENDER_SOURCE_RANGE");
  return Math.round(ms);
}

async function boundedRead(id: string, signal: AbortSignal) {
  signal.throwIfAborted();
  return new Promise<Buffer>((resolve, reject) => {
    const abort = () => reject(new Error("RENDER_TIMEOUT"));
    signal.addEventListener("abort", abort, { once: true });
    readRecording(id)
      .then(resolve, reject)
      .finally(() => signal.removeEventListener("abort", abort));
  });
}
export async function renderReel(clips: MediaClip[], signal: AbortSignal) {
  if (!ffmpeg) throw new Error("RENDER_UNAVAILABLE");
  const dir = await mkdtemp(path.join(tmpdir(), "echo-render-"));
  try {
    const normalized: string[] = [];
    const segments: { clipId: string; startMs: number; endMs: number }[] = [];
    let expected = 0;
    for (let n = 0; n < clips.length; n++) {
      signal.throwIfAborted();
      const c = clips[n],
        duration = c.endMs - c.startMs;
      expected += duration;
      const input = path.join(dir, `source-${n}`),
        output = path.join(dir, `part-${n}.mp4`),
        text = path.join(dir, `caption-${n}.vtt`);
      await writeFile(input, await boundedRead(c.mediaId, signal), {
        mode: 0o600,
      });
      await writeFile(
        text,
        captionsVtt([{ startMs: 0, endMs: duration, caption: c.caption }]),
        { mode: 0o600 },
      );
      const fonts = path.join(process.cwd(), "assets");
      const base =
        "scale=854:480:force_original_aspect_ratio=decrease,pad=854:480:(ow-iw)/2:(oh-ih)/2:color=0x17201a,setsar=1,fps=12";
      const vf =
        base +
        (c.caption
          ? `,subtitles=filename=${text}:fontsdir=${fonts}:force_style='FontName=DejaVu Sans,FontSize=18,Alignment=2,MarginV=18,Outline=1,BorderStyle=3,BackColour=&H80000000'`
          : "");
      const args = [
        "-hide_banner",
        "-loglevel",
        "error",
        "-nostdin",
        "-filter_threads",
        "1",
      ];
      if (c.kind === "audio")
        args.push(
          "-f",
          "lavfi",
          "-i",
          "color=c=0x17201a:s=854x480:r=12",
          "-ss",
          String(c.startMs / 1000),
          "-protocol_whitelist",
          "file,pipe",
          "-i",
          input,
          "-map",
          "0:v:0",
          "-map",
          "1:a:0",
        );
      else
        args.push(
          "-ss",
          String(c.startMs / 1000),
          "-protocol_whitelist",
          "file,pipe",
          "-i",
          input,
          "-map",
          "0:v:0",
          "-map",
          "0:a:0",
        );
      args.push(
        "-t",
        String(duration / 1000),
        "-vf",
        vf,
        "-c:v",
        "libx264",
        "-preset",
        "ultrafast",
        "-profile:v",
        "baseline",
        "-pix_fmt",
        "yuv420p",
        "-b:v",
        "280k",
        "-maxrate",
        "320k",
        "-bufsize",
        "640k",
        "-threads",
        "1",
        "-c:a",
        "aac",
        "-b:a",
        "32k",
        "-ar",
        "24000",
        "-ac",
        "1",
        "-shortest",
        "-movflags",
        "+faststart",
        output,
      );
      await exec(ffmpeg, args, {
        signal,
        timeout: 90000,
        maxBuffer: 1024 * 1024,
      });
      const ms = mp4Duration(await readFile(output));
      if (Math.abs(ms - duration) > 250) throw new Error("RENDER_SOURCE_RANGE");
      const startMs = segments.at(-1)?.endMs || 0;
      segments.push({ clipId: c.id, startMs, endMs: startMs + ms });
      normalized.push(output);
    }
    const manifest = path.join(dir, "parts.txt"),
      out = path.join(dir, "reel.mp4");
    await writeFile(manifest, normalized.map((p) => `file '${p}'`).join("\n"), {
      mode: 0o600,
    });
    await exec(
      ffmpeg,
      [
        "-hide_banner",
        "-loglevel",
        "error",
        "-nostdin",
        "-f",
        "concat",
        "-safe",
        "0",
        "-i",
        manifest,
        "-c",
        "copy",
        "-movflags",
        "+faststart",
        out,
      ],
      { signal, timeout: 30000, maxBuffer: 1024 * 1024 },
    );
    const bytes = await readFile(out),
      durationMs = mp4Duration(bytes);
    if (bytes.length > maxRecordingBytes) throw new Error("RENDER_TOO_LARGE");
    if (Math.abs(durationMs - expected) > 500)
      throw new Error("RENDER_SOURCE_RANGE");
    if (segments.length) segments[segments.length - 1].endMs = durationMs;
    return { bytes, durationMs, segments };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
