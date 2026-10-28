import { randomUUID } from "node:crypto";
import {
  docxTextSetup,
  docxTextDB,
  docxVerificationInput,
} from "./docx-text-fixture";
import { docxSynthesisPromptVersion } from "../src/lib/docx-synthesis";
export async function docxSynthesisSource(included = true) {
  const c = await docxTextSetup();
  await c.person(
    c.ip + "/answer",
    "POST",
    { version: 1, requestId: randomUUID(), answer: "Synthetic closing answer" },
    c.h,
  );
  const r = await c.owner(c.textPath);
  await c.owner(c.textPath, "PUT", {
    ...docxVerificationInput(r),
    includeInReports: included,
  });
  const a = (await c.owner(c.root + "/analysis", "POST", { mode: "manual" }))
    .analysis;
  return { ...c, a, endpoint: c.root + "/docx-synthesis" };
}
export function syntheticDOCXSynthesis(a: any) {
  const e = a.docxEvidence[0],
    p = e.passages[0];
  return {
    findings: [
      {
        title: "Synthetic draft instruction",
        description:
          "The selected excerpt instructs saving a draft before review.",
        citations: [
          {
            docxId: e.docxId,
            verificationVersion: e.verificationVersion,
            paragraph: p.paragraph,
            start: p.start,
            end: p.end,
            quote: p.quote,
          },
        ],
      },
    ],
    limitations:
      "Selected excerpts omit full document context and independent verification.",
    model: "synthetic-fixture",
    promptVersion: docxSynthesisPromptVersion,
    generatedAt: new Date().toISOString(),
    reviewed: false,
  };
}
export async function seedDOCXSynthesis(c: any) {
  const synthesis = syntheticDOCXSynthesis(c.a),
    d = docxTextDB();
  try {
    await d.execute({
      sql: "UPDATE documents SET data=? WHERE kind='analysis' AND id=?",
      args: [JSON.stringify({ ...c.a, docxSynthesis: synthesis }), c.a.id],
    });
  } finally {
    d.close();
  }
  return synthesis;
}
