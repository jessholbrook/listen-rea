import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
test("screen object recovery adopts identical bytes after a lost commit and rejects an occupied ID", async () => {
  const dir = mkdtempSync(join(tmpdir(), "echo-screen-object-"));
  process.env.RESEARCH_DATA_DIR = dir;
  process.env.VERCEL = "";
  process.env.RESEARCH_STORAGE = "local";
  const { writeRecording, ensureRecording, readRecording, deleteRecording } =
    await import("../src/lib/storage");
  try {
    const id = randomUUID(),
      bytes = Buffer.from(
        "screen clip bytes from a previous interrupted upload",
      );
    await writeRecording(id, bytes, "video/webm");
    await ensureRecording(id, bytes, "video/webm");
    assert.deepEqual(await readRecording(id), bytes);
    await assert.rejects(
      ensureRecording(id, Buffer.from("different video"), "video/webm"),
      /MEDIA_CONFLICT/,
    );
    assert.deepEqual(await readRecording(id), bytes);
    await deleteRecording(id);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
