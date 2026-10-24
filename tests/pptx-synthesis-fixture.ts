import { randomUUID } from "node:crypto";
import {
  pptxTextSetup,
  pptxTextDB,
  pptxVerificationInput,
} from "./pptx-text-fixture";
import { pptxSynthesisPromptVersion } from "../src/lib/pptx-synthesis";
export async function pptxSynthesisSource(included = true) {
  const c = await pptxTextSetup();
  await c.person(
    c.ip + "/answer",
    "POST",
    { version: 1, requestId: randomUUID(), answer: "Synthetic closing answer" },
    c.h,
  );
  const r = await c.owner(c.textPath);
  await c.owner(c.textPath, "PUT", {
    ...pptxVerificationInput(r),
    includeInReports: included,
  });
  const a = (await c.owner(c.root + "/analysis", "POST", { mode: "manual" }))
    .analysis;
  return { ...c, a, endpoint: c.root + "/pptx-synthesis" };
}
export function syntheticPPTXSynthesis(a: any) {
  const e = a.pptxEvidence[0],
    p = e.passages[0];
  return {
    findings: [
      {
        title: "Synthetic draft instruction",
        description:
          "The selected excerpt instructs saving a draft before review.",
        citations: [
          {
            pptxId: e.pptxId,
            verificationVersion: e.verificationVersion,
            slide: p.slide,
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
    promptVersion: pptxSynthesisPromptVersion,
    generatedAt: new Date().toISOString(),
    reviewed: false,
  };
}
export async function seedPPTXSynthesis(c: any) {
  const synthesis = syntheticPPTXSynthesis(c.a),
    d = pptxTextDB();
  try {
    await d.execute({
      sql: "UPDATE documents SET data=? WHERE kind='analysis' AND id=?",
      args: [JSON.stringify({ ...c.a, pptxSynthesis: synthesis }), c.a.id],
    });
  } finally {
    d.close();
  }
  return synthesis;
}
