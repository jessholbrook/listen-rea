import ffmpeg from "ffmpeg-static";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { mp4Duration } from "./render";
import {
  conceptVideoMaxInput,
  conceptVideoMaxOutput,
  conceptVideoMaxMs,
} from "./concept-videos";
import { fail } from "./http";
const exec = promisify(execFile);
export async function processConceptVideo(bytes: Buffer, mime: string) {
  if (bytes.length > conceptVideoMaxInput)
    fail(413, "Concept videos must be at most 3 MB.");
  const mp4 = bytes.length >= 12 && bytes.toString("ascii", 4, 8) === "ftyp",
    webm = bytes.subarray(0, 4).toString("hex") === "1a45dfa3";
  if (!((mime === "video/mp4" && mp4) || (mime === "video/webm" && webm)))
    fail(400, "Upload an MP4 or WebM video matching its file type.");
  if (!ffmpeg) fail(503, "Video processing is unavailable.");
  const dir = await mkdtemp(path.join(tmpdir(), "echo-concept-video-"));
  try {
    const input = path.join(dir, "source"),
      output = path.join(dir, "video.mp4");
    await writeFile(input, bytes, { mode: 0o600 });
    const source = [
      "-hide_banner",
      "-nostdin",
      "-protocol_whitelist",
      "file,pipe",
      "-f",
      mp4 ? "mov" : "matroska,webm",
      ...(mp4 ? ["-enable_drefs", "0", "-use_absolute_path", "0"] : []),
      "-i",
      input,
    ];
    let info = "";
    try {
      await exec(ffmpeg, source, { timeout: 10000, maxBuffer: 256 * 1024 });
    } catch (e) {
      info = String((e as { stderr?: string }).stderr || "");
    }
    const dims = /Video:[^\n]*?\b(\d{2,5})x(\d{2,5})\b/.exec(info),
      duration = /Duration: (\d+):(\d+):(\d+(?:\.\d+)?)/.exec(info);
    if (!dims) fail(400, "The file needs a decodable video track.");
    if (Number(dims[1]) * Number(dims[2]) > 16000000)
      fail(400, "Video frames must be at most 16 million pixels.");
    if (
      duration &&
      (Number(duration[1]) * 3600 +
        Number(duration[2]) * 60 +
        Number(duration[3])) *
        1000 >
        conceptVideoMaxMs + 50
    )
      fail(400, "Concept videos must be at most 60 seconds.");
    await exec(
      ffmpeg,
      [
        ...source,
        "-y",
        "-threads",
        "2",
        "-filter_threads",
        "1",
        "-map",
        "0:v:0",
        "-map",
        "0:a:0?",
        "-sn",
        "-dn",
        "-t",
        "61",
        "-vf",
        "scale=1280:720:force_original_aspect_ratio=decrease:force_divisible_by=2,setsar=1,fps=24",
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
        "-pix_fmt",
        "yuv420p",
        "-c:a",
        "aac",
        "-b:a",
        "64k",
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
    const data = await readFile(output),
      durationMs = mp4Duration(data);
    if (durationMs > conceptVideoMaxMs + 50)
      fail(400, "Concept videos must be at most 60 seconds.");
    if (data.length > conceptVideoMaxOutput)
      fail(
        413,
        "The prepared video exceeds 8 MB. Use a shorter or simpler clip.",
      );
    // Read the dimensions of the normalized track, rather than trusting upload metadata.
    let normalized = "";
    try {
      await exec(ffmpeg, ["-hide_banner", "-nostdin", "-i", output], {
        timeout: 10000,
        maxBuffer: 256 * 1024,
      });
    } catch (e) {
      normalized = String((e as { stderr?: string }).stderr || "");
    }
    const size = /Video:[^\n]*?\b(\d{2,5})x(\d{2,5})\b/.exec(normalized);
    if (!size) fail(400, "The prepared video could not be verified.");
    return {
      data,
      width: Number(size[1]),
      height: Number(size[2]),
      durationMs,
    };
  } catch (e) {
    if ((e as { status?: number }).status) throw e;
    fail(
      400,
      "The video could not be processed. Use a shorter, valid MP4 or WebM clip.",
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
