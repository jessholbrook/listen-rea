import { spawn } from "node:child_process";
import path from "node:path";
import { createHash } from "node:crypto";
import { fail } from "./http";
import { docxMime, docxSnapshot } from "./participant-docx";
const docxMaxBytes = 3 * 1024 * 1024;
export async function docxBytes(req: Request) {
  if (req.headers.get("content-type")?.split(";")[0] !== docxMime)
    fail(400, "Upload an unencrypted DOCX.");
  if (Number(req.headers.get("content-length")) > docxMaxBytes)
    fail(413, "DOCX uploads must be at most 3 MB.");
  const reader = req.body?.getReader();
  if (!reader) fail(400, "DOCX is empty.");
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.length;
    if (total > docxMaxBytes) {
      await reader.cancel();
      fail(413, "DOCX uploads must be at most 3 MB.");
    }
    chunks.push(value);
  }
  const original = Buffer.concat(chunks),
    digest = createHash("sha256").update(original).digest("hex");
  const prepared = await prepareDOCX(original);
  return { ...prepared, digest };
}
export async function prepareDOCX(
  bytes: Buffer,
): Promise<{ data: Buffer; paragraphs: number; characters: number }> {
  if (bytes.length > docxMaxBytes)
    fail(413, "DOCX uploads must be at most 3 MB.");
  try {
    return await new Promise((resolve, reject) => {
      const child = spawn(
        process.execPath,
        [
          "--max-old-space-size=96",
          path.join(process.cwd(), "assets/prepare-docx.cjs"),
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
        value?: { data: Buffer; paragraphs: number; characters: number },
      ) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        child.kill("SIGKILL");
        if (error) reject(error);
        else resolve(value!);
      };
      const timer = setTimeout(() => finish(Error("DOCX_TIMEOUT")), 8000);
      child.on("error", (e) => finish(e));
      child.stdin.on("error", () => {});
      child.stdout.on("data", (b) => {
        size += b.length;
        if (size > 5 * 1024 * 1024) finish(Error("DOCX_TOO_LARGE"));
        else output.push(b);
      });
      child.on("close", (code) => {
        if (settled) return;
        try {
          if (code !== 0) throw Error();
          const snapshot = docxSnapshot.parse(
            JSON.parse(Buffer.concat(output).toString()),
          );
          const data = Buffer.from(JSON.stringify(snapshot));
          finish(undefined, {
            data,
            paragraphs: snapshot.paragraphs.length,
            characters: snapshot.paragraphs.join("").length,
          });
        } catch {
          finish(Error("INVALID_DOCX"));
        }
      });
      child.stdin.end(bytes);
    });
  } catch {
    fail(
      400,
      "Upload a DOCX containing 1–2,000 readable body paragraphs and at most 200,000 text characters; encrypted, macro-enabled or malformed documents are not supported.",
    );
  }
}
