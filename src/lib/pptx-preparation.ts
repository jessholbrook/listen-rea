import { spawn } from "node:child_process";
import path from "node:path";
import { createHash } from "node:crypto";
import { fail } from "./http";
import { pptxMime, pptxSnapshot } from "./participant-pptx";
const pptxMaxBytes = 3 * 1024 * 1024;
export async function pptxBytes(req: Request) {
  if (req.headers.get("content-type")?.split(";")[0] !== pptxMime)
    fail(400, "Upload an unencrypted PPTX.");
  if (Number(req.headers.get("content-length")) > pptxMaxBytes)
    fail(413, "PPTX uploads must be at most 3 MB.");
  const reader = req.body?.getReader();
  if (!reader) fail(400, "PPTX is empty.");
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.length;
    if (total > pptxMaxBytes) {
      await reader.cancel();
      fail(413, "PPTX uploads must be at most 3 MB.");
    }
    chunks.push(value);
  }
  const original = Buffer.concat(chunks),
    digest = createHash("sha256").update(original).digest("hex");
  const prepared = await preparePPTX(original);
  return { ...prepared, digest };
}
export async function preparePPTX(
  bytes: Buffer,
): Promise<{ data: Buffer; slides: number; characters: number }> {
  if (bytes.length > pptxMaxBytes)
    fail(413, "PPTX uploads must be at most 3 MB.");
  try {
    return await new Promise((resolve, reject) => {
      const child = spawn(
        process.execPath,
        [
          "--max-old-space-size=96",
          path.join(process.cwd(), "assets/prepare-pptx.cjs"),
        ],
        {
          stdio: ["pipe", "pipe", "ignore"],
          env: { PATH: process.env.PATH, NODE_ENV: process.env.NODE_ENV },
        },
      );
      let size = 0,
        settled = false;
      const output: Buffer[] = [];
      const finish = (
        error?: Error,
        value?: { data: Buffer; slides: number; characters: number },
      ) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        child.kill("SIGKILL");
        if (error) reject(error);
        else resolve(value!);
      };
      const timer = setTimeout(() => finish(Error("PPTX_TIMEOUT")), 8000);
      child.on("error", (e) => finish(e));
      child.stdin.on("error", () => {});
      child.stdout.on("data", (b) => {
        size += b.length;
        if (size > 5 * 1024 * 1024) finish(Error("PPTX_TOO_LARGE"));
        else output.push(b);
      });
      child.on("close", (code) => {
        if (settled) return;
        try {
          if (code !== 0) throw Error();
          const snapshot = pptxSnapshot.parse(
            JSON.parse(Buffer.concat(output).toString()),
          );
          const data = Buffer.from(JSON.stringify(snapshot));
          finish(undefined, {
            data,
            slides: snapshot.slides.length,
            characters: snapshot.slides.join("").length,
          });
        } catch {
          finish(Error("INVALID_PPTX"));
        }
      });
      child.stdin.end(bytes);
    });
  } catch {
    fail(
      400,
      "Upload a PPTX containing 1–100 slides with readable text and at most 200,000 text characters; encrypted, macro-enabled or malformed documents are not supported.",
    );
  }
}
