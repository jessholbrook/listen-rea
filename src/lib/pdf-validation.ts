import { spawn } from "node:child_process";
import path from "node:path";
import { createHash } from "node:crypto";
import { fail } from "./http";
import { participantPDFMaxBytes } from "./participant-pdfs";
export async function pdfBytes(req: Request) {
  if (req.headers.get("content-type")?.split(";")[0] !== "application/pdf")
    fail(400, "Upload a static, unencrypted PDF.");
  if (Number(req.headers.get("content-length")) > participantPDFMaxBytes)
    fail(413, "PDF uploads must be at most 3 MB.");
  const reader = req.body?.getReader();
  if (!reader) fail(400, "PDF is empty.");
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.length;
    if (total > participantPDFMaxBytes) {
      await reader.cancel();
      fail(413, "PDF uploads must be at most 3 MB.");
    }
    chunks.push(value);
  }
  const original = Buffer.concat(chunks),
    digest = createHash("sha256").update(original).digest("hex");
  const prepared = await normalizePDF(original);
  return { ...prepared, digest };
}
export async function normalizePDF(
  bytes: Buffer,
): Promise<{ data: Buffer; pages: number }> {
  if (bytes.length > participantPDFMaxBytes)
    fail(413, "PDF uploads must be at most 3 MB.");
  try {
    return await new Promise((resolve, reject) => {
      const child = spawn(
        process.execPath,
        [
          "--max-old-space-size=96",
          path.join(process.cwd(), "assets/validate-pdf.cjs"),
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
        value?: { data: Buffer; pages: number },
      ) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        child.kill("SIGKILL");
        if (error) reject(error);
        else resolve(value!);
      };
      const timer = setTimeout(() => finish(Error("PDF_TIMEOUT")), 8000);
      child.on("error", (e) => finish(e));
      child.stdin.on("error", () => {});
      child.stdout.on("data", (b) => {
        size += b.length;
        if (size > 5 * 1024 * 1024) finish(Error("PDF_TOO_LARGE"));
        else output.push(b);
      });
      child.on("close", (code) => {
        if (settled) return;
        try {
          if (code !== 0) throw Error();
          const r = JSON.parse(Buffer.concat(output).toString());
          const data = Buffer.from(r.data, "base64");
          if (
            !Number.isInteger(r.pages) ||
            r.pages < 1 ||
            r.pages > 20 ||
            data.length > participantPDFMaxBytes ||
            !data.subarray(0, 5).equals(Buffer.from("%PDF-"))
          )
            throw Error();
          finish(undefined, { data, pages: r.pages });
        } catch {
          finish(Error("INVALID_PDF"));
        }
      });
      child.stdin.end(bytes);
    });
  } catch {
    fail(
      400,
      "Upload a static, unencrypted PDF with 1–20 pages and no form fields.",
    );
  }
}
