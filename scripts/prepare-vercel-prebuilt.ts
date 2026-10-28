import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
// The Vercel Next builder adds root dotenv files to filePathMap independently
// of Next's NFT exclusions. Production uses Vercel's configured runtime env.
// Keep ignored local files out of both the output and its upload metadata.
const root = path.resolve(".vercel/output/functions");
function localOnly(file: string) {
  return file
    .replaceAll("\\", "/")
    .split("/")
    .some(
      (part) =>
        part.startsWith(".env") ||
        [".data", "test-results", ".vercel"].includes(part),
    );
}
let removed = 0,
  configs = 0;
async function prepare(dir: string) {
  for (const item of await readdir(dir, { withFileTypes: true })) {
    const filename = path.join(dir, item.name);
    // Function aliases and linked node_modules are deliberately not traversed.
    if (item.isDirectory()) await prepare(filename);
    else if (item.isFile() && item.name === ".vc-config.json") {
      const config = JSON.parse(await readFile(filename, "utf8"));
      if (config.filePathMap) {
        for (const [source, target] of Object.entries(config.filePathMap))
          if (
            localOnly(source) ||
            (typeof target === "string" && localOnly(target))
          ) {
            delete config.filePathMap[source];
            removed++;
          }
        if (
          Object.entries(config.filePathMap).some(
            ([s, t]) => localOnly(s) || (typeof t === "string" && localOnly(t)),
          )
        )
          throw new Error("Local-only file remains in Vercel metadata.");
      }
      await writeFile(filename, JSON.stringify(config, null, 2) + "\n");
      configs++;
    } else if (localOnly(path.relative(root, filename))) {
      throw new Error(
        "Local-only file exists in the prebuilt output. Rebuild with the tracing exclusions.",
      );
    }
  }
}
await prepare(root);
if (!configs)
  throw new Error(
    "No built function configs found. Run vercel build --prod first.",
  );
console.log(
  `Checked ${configs} function configs; removed ${removed} local-only upload references.`,
);
