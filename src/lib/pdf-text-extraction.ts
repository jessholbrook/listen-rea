import { spawn } from "node:child_process";
import path from "node:path";
import { z } from "zod";
import { fail } from "./http";
export const extractedPages = z
  .array(z.string().max(20000))
  .min(1)
  .max(20)
  .refine((p) => p.reduce((n, s) => n + s.length, 0) <= 200000);
export async function extractPDFText(bytes: Buffer): Promise<string[]> {
  if (bytes.length > 3 * 1024 * 1024) fail(413, "PDF is too large to extract.");
  try {
    return await new Promise((resolve, reject) => {
      const child = spawn(
        process.execPath,
        [
          "--max-old-space-size=128",
          path.join(process.cwd(), "assets/extract-pdf-text.mjs"),
        ],
        {
          stdio: ["pipe", "pipe", "ignore"],
          env: { PATH: process.env.PATH, NODE_ENV: process.env.NODE_ENV },
        },
      );
      let size = 0,
        settled = false;
      const output: Buffer[] = [];
      const finish = (error?: Error, pages?: string[]) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        child.kill("SIGKILL");
        if (error) reject(error);
        else resolve(pages!);
      };
      const timer = setTimeout(() => finish(Error("TIMEOUT")), 15000);
      child.on("error", (e) => finish(e));
      child.stdin.on("error", () => {});
      child.stdout.on("data", (b) => {
        size += b.length;
        if (size > 1500000) finish(Error("LIMIT"));
        else output.push(b);
      });
      child.on("close", (code) => {
        if (settled) return;
        try {
          if (code !== 0) throw Error();
          finish(
            undefined,
            extractedPages.parse(JSON.parse(Buffer.concat(output).toString())),
          );
        } catch {
          finish(Error("EXTRACTION"));
        }
      });
      child.stdin.end(bytes);
    });
  } catch {
    fail(
      422,
      "Text extraction is unavailable for this PDF or exceeds the text limits. Review its pages visually.",
    );
  }
}
