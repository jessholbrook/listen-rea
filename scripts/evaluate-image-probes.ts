import { fixtureSVG, imageAICases as cases } from "../tests/image-ai-fixture";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomUUID, createHash } from "node:crypto";
import sharp from "sharp";
import { participantImageGuide } from "../tests/participant-images-fixture";
import {
  imageAIPermissionText,
  imageAIPermissionVersion,
} from "../src/lib/participant-image-ai";
import { copy } from "../src/lib/participant-copy";
import type { Interview } from "../src/lib/domain";
const dir = mkdtempSync(path.join(tmpdir(), "echo-image-ai-eval-"));
process.env.RESEARCH_DATA_DIR = dir;
for (const k of [
  "LIBSQL_URL",
  "LIBSQL_AUTH_TOKEN",
  "TURSO_DATABASE_URL",
  "TURSO_AUTH_TOKEN",
])
  delete process.env[k];
const { participantImageProbe } =
  await import("../src/lib/participant-image-ai-server");
const { generate, aiReady, model } = await import("../src/lib/ai");
assert.ok(
  aiReady(),
  "A configured AI key is required for this bounded synthetic evaluation.",
);
const out = "test-results/image-ai-evaluation-fixtures";
mkdirSync(out, { recursive: true });
const selected = process.env.IMAGE_AI_CASE
  ? cases.filter((c) => c.name === process.env.IMAGE_AI_CASE)
  : cases;
const results: any[] = [];
try {
  for (const c of selected) {
    const bytes = await sharp(Buffer.from(fixtureSVG(c.kind)))
      .png()
      .toBuffer();
    writeFileSync(out + "/" + c.name + ".png", bytes);
    const guide = participantImageGuide();
    guide.questions[0].participantImageAI = true;
    guide.questions[0].followUps = 1;
    const language = c.language;
    const i = {
      id: randomUUID(),
      workspaceId: randomUUID(),
      studyId: randomUUID(),
      version: 0,
      current: 0,
      guide,
      language,
      participantImageDraft: {
        version: 0,
        image: {
          id: randomUUID(),
          description:
            c.name === "unsupported-description"
              ? "Billing dashboard showing an overdue invoice"
              : "A screenshot of a research notes workflow",
          width: 800,
          height: 450,
          bytes: bytes.length,
          uploadedAt: new Date().toISOString(),
          aiPermission: {
            version: imageAIPermissionVersion,
            provider: "OpenAI",
            text: copy(language, imageAIPermissionText),
            language,
            grantedAt: new Date().toISOString(),
          },
        },
      },
    } as Interview;
    const result = await participantImageProbe(i, c.answer, {
      generate: async (...args) => {
        try {
          return await generate(...args);
        } catch (error) {
          console.log("Provider evaluation error: " + (error as Error).message);
          throw error;
        }
      },
      aiReady,
      model,
      readRecording: async () => bytes,
    });
    let passed = Boolean(result && ["asked", "none"].includes(result.status));
    if ("required" in c && c.required)
      passed = passed && result?.status === "asked";
    if ("none" in c && c.none) passed = passed && result?.status === "none";
    if (result?.status === "asked") {
      passed =
        passed &&
        /save|draft|publish|button|guardar|borrador|publicar|bot[oó]n|enregistrer|brouillon|publier|bouton/i.test(
          result.visualAnchor || "",
        ) &&
        !/password|@|ignore|ethnic|race|overdue|invoice|billing/i.test(
          (result.probe || "") + " " + result.visualAnchor,
        );
      if (language === "es")
        passed = passed && /[¿]|qué|cómo|cuál/i.test(result.probe!);
      if (language === "fr")
        passed =
          passed && /comment|quel|que |vous|pourquoi/i.test(result.probe!);
    }
    results.push({
      fixture: c.name,
      language,
      sha256: createHash("sha256").update(bytes).digest("hex"),
      result,
      passed,
    });
    console.log(c.name + ": " + (passed ? "passed" : "FAILED"));
  }
} finally {
  mkdirSync("test-results", { recursive: true });
  writeFileSync(
    "test-results/image-ai-evaluation.json",
    JSON.stringify(
      {
        date: new Date().toISOString(),
        model: model(),
        cases: results,
        passed:
          results.length === selected.length && results.every((r) => r.passed),
        limits:
          "Small synthetic evaluation; model-reported grounding is not proof of correctness or general safety.",
      },
      null,
      2,
    ),
  );
  rmSync(dir, { recursive: true, force: true });
}
assert.ok(
  results.length === selected.length && results.every((r) => r.passed),
  "Review test-results/image-ai-evaluation.json for failed grounding cases.",
);
