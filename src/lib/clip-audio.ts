import { spawn } from "node:child_process";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import ffmpeg from "ffmpeg-static";
// Decode before contacting a provider: client-supplied duration metadata is not a duration limit.
export async function prepareClipAudio(bytes: Buffer) {
  const dir = await mkdtemp(path.join(tmpdir(), "echo-clip-audio-")),
    input = path.join(dir, "source");
  try {
    await writeFile(input, bytes, { mode: 0o600 });
    const pcm = await new Promise<Buffer>((resolve, reject) => {
      const child = spawn(
        ffmpeg!,
        [
          "-hide_banner",
          "-loglevel",
          "error",
          "-nostdin",
          "-threads",
          "1",
          "-protocol_whitelist",
          "file,pipe",
          "-i",
          input,
          "-vn",
          "-t",
          "301",
          "-ac",
          "1",
          "-ar",
          "16000",
          "-f",
          "s16le",
          "pipe:1",
        ],
        { stdio: ["ignore", "pipe", "ignore"] },
      );
      const chunks: Buffer[] = [];
      let length = 0,
        settled = false;
      const finish = (error?: Error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (error) {
          child.kill("SIGKILL");
          reject(error);
        } else resolve(Buffer.concat(chunks));
      };
      const timer = setTimeout(
        () => finish(Error("CLIP_AUDIO_TIMEOUT")),
        20000,
      );
      child.on("error", () => finish(Error("CLIP_AUDIO_UNREADABLE")));
      child.stdout.on("data", (b: Buffer) => {
        length += b.length;
        if (length > 302 * 32000) finish(Error("CLIP_AUDIO_TOO_LONG"));
        else chunks.push(b);
      });
      child.on("close", (code) =>
        finish(code === 0 ? undefined : Error("CLIP_AUDIO_UNREADABLE")),
      );
    });
    const durationMs = pcm.length / 32;
    if (durationMs < 100 || durationMs > 300000)
      throw Error("CLIP_AUDIO_DURATION");
    const header = Buffer.alloc(44);
    header.write("RIFF");
    header.writeUInt32LE(36 + pcm.length, 4);
    header.write("WAVEfmt ", 8);
    header.writeUInt32LE(16, 16);
    header.writeUInt16LE(1, 20);
    header.writeUInt16LE(1, 22);
    header.writeUInt32LE(16000, 24);
    header.writeUInt32LE(32000, 28);
    header.writeUInt16LE(2, 32);
    header.writeUInt16LE(16, 34);
    header.write("data", 36);
    header.writeUInt32LE(pcm.length, 40);
    return { bytes: Buffer.concat([header, pcm]), durationMs };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
