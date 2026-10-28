import { createRequire } from "node:module";
import { cpSync, mkdirSync, readFileSync } from "node:fs";
import path from "node:path";
const require = createRequire(import.meta.url),
  root = path.dirname(require.resolve("pdfjs-dist/package.json"));
const { version } = JSON.parse(
  readFileSync(path.join(root, "package.json"), "utf8"),
);
const target = path.resolve("public/pdfjs", version);
mkdirSync(target, { recursive: true });
for (const [from, to] of [
  ["build/pdf.worker.min.mjs", "pdf.worker.min.mjs"],
  ["cmaps", "cmaps"],
  ["standard_fonts", "standard_fonts"],
  ["wasm", "wasm"],
])
  cpSync(path.join(root, from), path.join(target, to), { recursive: true });
