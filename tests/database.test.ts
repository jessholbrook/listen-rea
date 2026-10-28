import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
test("hosted-compatible adapter preserves the initial SQLite schema and isolates concurrent transactions", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "fieldnotes-db-"));
  process.env.RESEARCH_DATA_DIR = dir;
  process.env.LIBSQL_URL = "";
  process.env.TURSO_DATABASE_URL = "";
  process.env.VERCEL = "";
  const original = new DatabaseSync(path.join(dir, "research.sqlite"));
  original.exec(
    "CREATE TABLE documents(kind TEXT,id TEXT,workspace_id TEXT,study_id TEXT,data TEXT,PRIMARY KEY(kind,id)); CREATE TABLE media(id TEXT PRIMARY KEY,interview_id TEXT,workspace_id TEXT,study_id TEXT,mime TEXT,bytes INTEGER,duration_ms INTEGER,created_at TEXT);",
  );
  original
    .prepare("INSERT INTO documents VALUES(?,?,?,?,?)")
    .run(
      "counter",
      "test",
      "ws",
      "test",
      JSON.stringify({ id: "test", workspaceId: "ws", value: 0 }),
    );
  original
    .prepare(
      "INSERT INTO media(id,interview_id,workspace_id,study_id,mime,bytes,duration_ms,created_at) VALUES(?,?,?,?,?,?,?,?)",
    )
    .run(
      "legacy-audio",
      "interview",
      "ws",
      "study",
      "audio/webm",
      100,
      1000,
      "2026-10-19",
    );
  original.close();
  const { db, get, put, transaction } = await import("../src/lib/db");
  try {
    assert.equal((await get<any>("counter", "test", "ws")).value, 0);
    assert.ok(
      (await db.prepare("PRAGMA table_info(media)").all()).some(
        (r) => r.name === "transcript",
      ),
    );
    const legacy = await db
      .prepare("SELECT kind,capture_id FROM media WHERE id=?")
      .get("legacy-audio");
    assert.equal(legacy?.kind, "audio");
    assert.equal(legacy?.capture_id, "");
    await Promise.all(
      Array.from({ length: 5 }, () =>
        transaction(async () => {
          const value = await get<any>("counter", "test", "ws");
          await new Promise((r) => setTimeout(r, 5));
          value.value++;
          await put("counter", value);
        }),
      ),
    );
    assert.equal((await get<any>("counter", "test", "ws")).value, 5);
    await assert.rejects(
      transaction(async () => {
        await put("counter", { id: "test", workspaceId: "ws", value: 100 });
        throw new Error("rollback");
      }),
      /rollback/,
    );
    assert.equal((await get<any>("counter", "test", "ws")).value, 5);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
