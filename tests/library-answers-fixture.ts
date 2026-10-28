import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { dataDirectory } from "./harness";
import { client } from "./image-review-fixture";
import { libraryAttachmentFixture } from "./library-attachments-fixture";
import type { Actor } from "../src/lib/domain";
export async function savedLibrarySetup(
  formats: ("image" | "pdf" | "docx" | "pptx")[] = ["pptx", "docx"],
) {
  const owner = await client(),
    email = randomUUID() + "@example.test";
  await owner("auth/signup", "POST", {
    name: "Saved library reviewer",
    email,
    password: "saved-library-password",
  });
  const fixtures = [];
  for (const format of formats)
    fixtures.push(await libraryAttachmentFixture(owner, format));
  process.env.RESEARCH_DATA_DIR = dataDirectory();
  process.env.RESEARCH_STORAGE = "local";
  for (const k of [
    "LIBSQL_URL",
    "LIBSQL_AUTH_TOKEN",
    "TURSO_DATABASE_URL",
    "TURSO_AUTH_TOKEN",
  ])
    process.env[k] = "";
  const local = await import("../src/lib/db");
  assert.equal(local.dataDir, dataDirectory());
  const row = await local.db
    .prepare("SELECT id,workspace_id FROM users WHERE email=?")
    .get(email);
  assert.ok(row);
  const actor: Actor = {
    id: String(row.id),
    workspaceId: String(row.workspace_id),
    name: "Saved library reviewer",
    email,
    role: "admin",
  };
  const { dispatchLibraryAttachments } =
    await import("../src/lib/library-attachments-server");
  let count = 0;
  const ask = async (changes: any = {}) => {
    const input = {
      question: "What does draft review show?",
      language: "en",
      saveDraft: true,
      requestId: randomUUID(),
      ...changes,
    };
    const r = await dispatchLibraryAttachments(
      new Request("http://localhost/api/library/attachments/qa", {
        method: "POST",
        body: JSON.stringify(input),
      }),
      ["library", "attachments", "qa"],
      actor,
      async (evidence) => {
        count++;
        return {
          answer: "SYNTHETIC_ORIGINAL_INTERPRETATION",
          citations: evidence
            .slice(0, 4)
            .map((h) => ({ evidenceId: h.id, quote: h.text })),
          model: "marked-provider-fixture",
          promptVersion: "marked-provider-fixture",
          generatedAt: new Date().toISOString(),
        };
      },
    );
    return { input, result: await r!.json() };
  };
  return { owner, fixtures, actor, local, ask, count: () => count, email };
}
